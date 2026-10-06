'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs').promises;

const { createServer, start, scanAll, walkFolder } = require('../server.js');
const cleanupTargets = require('../lib/cleanup-targets.js');
const cleanupEngine = require('../lib/cleanup-engine.js');
const cleanupJobs = require('../lib/cleanup-jobs.js');

const TEST_PORT = 0; // dynamic
const HOST = '127.0.0.1';

// ---- Fake filesystem for clean determinism ----
function makeFakeFs() {
  const now = Date.now();
  const old = now - 48 * 60 * 60 * 1000;
  const recent = now - 1 * 60 * 60 * 1000;

  const dirs = {
    '/cleanup/test-temp-a': [
      { name: 'old.txt', isDir: false },
      { name: 'recent.txt', isDir: false },
      { name: 'sub1', isDir: true },
      { name: 'Cookies', isDir: false }, // protected basename
    ],
    '/cleanup/test-temp-a/sub1': [
      { name: 'old2.txt', isDir: false },
      { name: 'sub2', isDir: true },
    ],
    '/cleanup/test-temp-a/sub1/sub2': [],
    '/cleanup/test-temp-b': [
      { name: 'old.txt', isDir: false },
    ],
  };

  const stats = {
    '/cleanup/test-temp-a': { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false, isReparsePoint: () => false },
    '/cleanup/test-temp-a/old.txt': { size: 1024, mtimeMs: old, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, isReparsePoint: () => false },
    '/cleanup/test-temp-a/recent.txt': { size: 512, mtimeMs: recent, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, isReparsePoint: () => false },
    '/cleanup/test-temp-a/Cookies': { size: 2048, mtimeMs: old, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, isReparsePoint: () => false },
    '/cleanup/test-temp-a/sub1': { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false, isReparsePoint: () => false },
    '/cleanup/test-temp-a/sub1/old2.txt': { size: 2048, mtimeMs: old, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, isReparsePoint: () => false },
    '/cleanup/test-temp-a/sub1/sub2': { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false, isReparsePoint: () => false },
    '/cleanup/test-temp-b': { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false, isReparsePoint: () => false },
    '/cleanup/test-temp-b/old.txt': { size: 4096, mtimeMs: old, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, isReparsePoint: () => false },
  };

  return {
    dirs,
    stats,
    async readdir(targetPath, _opts) {
      const normalized = path.posix.normalize(targetPath);
      if (!Object.prototype.hasOwnProperty.call(dirs, normalized)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return dirs[normalized].map(item => ({
        name: item.name,
        isDirectory: () => item.isDir,
        isFile: () => !item.isDir,
        isSymbolicLink: () => false,
        isReparsePoint: () => false,
      }));
    },
    async lstat(targetPath) {
      const normalized = path.posix.normalize(targetPath);
      if (!Object.prototype.hasOwnProperty.call(stats, normalized)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return stats[normalized];
    },
    async stat(targetPath) {
      return this.lstat(targetPath);
    },
    async realpath(targetPath) {
      return path.posix.normalize(targetPath);
    },
    async unlink(targetPath) {
      const normalized = path.posix.normalize(targetPath);
      delete stats[normalized];
      const parent = path.posix.dirname(normalized);
      if (dirs[parent]) {
        dirs[parent] = dirs[parent].filter(item => path.posix.join(parent, item.name) !== normalized);
      }
    },
    async rmdir(targetPath) {
      const normalized = path.posix.normalize(targetPath);
      if (!Object.prototype.hasOwnProperty.call(dirs, normalized)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      if (dirs[normalized].length > 0) {
        const err = new Error('ENOTEMPTY');
        err.code = 'ENOTEMPTY';
        throw err;
      }
      delete dirs[normalized];
      const parent = path.posix.dirname(normalized);
      if (dirs[parent]) {
        dirs[parent] = dirs[parent].filter(item => path.posix.join(parent, item.name) !== normalized);
      }
    },
  };
}

// ---- HTTP helpers ----
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function request(server, method, path, body, extraHeaders = {}) {
  const address = server.address();
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  const options = {
    hostname: HOST,
    port: address.port,
    path,
    method,
    headers,
  };
  if (body !== undefined) options.headers['content-length'] = Buffer.byteLength(JSON.stringify(body));

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`${method} ${path} timed out`)));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---- Test setup: replace registry with test targets ----
let originalTargets = [];
let activeFs;
// Proxy so each test can swap in a fresh fake filesystem while the server,
// which captured `cleanupOptions` once at construction, keeps using it.
const fakeFsProxy = {
  readdir: (...args) => activeFs.readdir(...args),
  lstat: (...args) => activeFs.lstat(...args),
  stat: (...args) => activeFs.stat(...args),
  realpath: (...args) => activeFs.realpath(...args),
  unlink: (...args) => activeFs.unlink(...args),
  rmdir: (...args) => activeFs.rmdir(...args),
};

before(() => {
  originalTargets = [...cleanupTargets.TARGETS];
  cleanupTargets.TARGETS.length = 0;
  cleanupTargets.TARGETS.push(
    { id: 'test-temp-a', name: 'Test Temp A', category: 'temp', risk: 'safe', internalPath: '/cleanup/test-temp-a', displayPath: 'C:\\Test\\TempA', enabled: true, minimumAgeHours: 1, supportsCleaning: true, requiresConfirmation: true, autoSelectable: true },
    { id: 'test-temp-b', name: 'Test Temp B', category: 'temp', risk: 'safe', internalPath: '/cleanup/test-temp-b', displayPath: 'C:\\Test\\TempB', enabled: true, minimumAgeHours: 1, supportsCleaning: true, requiresConfirmation: true, autoSelectable: true },
  );
  activeFs = makeFakeFs();
  cleanupJobs.jobs.clear();
  cleanupJobs.targetLocks.clear();
  cleanupJobs.confirmationTokens.clear();
});

after(() => {
  cleanupTargets.TARGETS.length = 0;
  cleanupTargets.TARGETS.push(...originalTargets);
  cleanupJobs.jobs.clear();
  cleanupJobs.targetLocks.clear();
  cleanupJobs.confirmationTokens.clear();
});

// ---- API Integration Tests ----
describe('cleanup API integration', () => {
  let server;
  let serverPort;

  before(async () => {
    server = await listen(createServer({
      whitelistRoots: [], // no scan roots needed
      cleanupOptions: { fs: fakeFsProxy },
      auditFile: '/tmp/test-cleanup-audit.jsonl',
    }));
    serverPort = server.address().port;
  });

  after(async () => {
    await closeServer(server);
  });

  it('GET /api/cleanup/targets returns registered cleanable targets', async () => {
    const { status, body } = await request(server, 'GET', '/api/cleanup/targets');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.targets));
    assert.equal(body.targets.length, 2);
    assert.ok(body.targets.some(t => t.id === 'test-temp-a'));
    assert.ok(body.targets.every(t => !('internalPath' in t)), 'internalPath must not be exposed');
  });

  it('POST /api/cleanup/preview with unknown target returns 400', async () => {
    const { status, body } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['unknown-target'] });
    assert.equal(status, 400);
    assert.equal(body.error, 'Target tidak dikenal atau tidak aktif.');
    assert.ok(body.invalidTargets.includes('unknown-target'));
  });

  it('POST /api/cleanup/preview with physical path returns 400', async () => {
    const { status, body } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['C:\\Windows'] });
    assert.equal(status, 400);
    assert.equal(body.error, 'Target tidak dikenal atau tidak aktif.');
  });

  it('POST /api/cleanup/preview returns estimates + token', async () => {
    activeFs = makeFakeFs();
    const { status, body } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['test-temp-a', 'test-temp-b'] });
    assert.equal(status, 200);
    assert.ok(body.confirmationToken);
    assert.equal(body.eligibleFiles, 3); // old.txt, old2.txt in a + old.txt in b = 3
    assert.equal(body.skippedRecentFiles, 1); // recent.txt in a
    assert.equal(body.skippedProtectedFiles, 1); // Cookies in a
    assert.ok(body.estimatedBytes > 0);
  });

  it('POST /api/cleanup/preview respects CSRF (Origin mismatch -> 403)', async () => {
    const { status } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['test-temp-a'] }, { 'Origin': 'http://evil.example' });
    assert.equal(status, 403);
  });

  it('POST /api/cleanup/preview with invalid JSON returns 400', async () => {
    const address = server.address();
    const req = http.request({ hostname: HOST, port: address.port, path: '/api/cleanup/preview', method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      let d = ''; res.on('data', c => d+=c); res.on('end', () => { assert.equal(res.statusCode, 400); });
    });
    req.end('{bad');
  });

  it('POST /api/cleanup/jobs without token returns 400', async () => {
    const { status, body } = await request(server, 'POST', '/api/cleanup/jobs', { targets: ['test-temp-a'] });
    assert.equal(status, 400);
    assert.match(body.error, /confirmation token/i);
  });

  it('POST /api/cleanup/jobs with wrong token returns 403', async () => {
    const { status, body } = await request(server, 'POST', '/api/cleanup/jobs', { targets: ['test-temp-a'], confirmationToken: 'invalid-token' });
    assert.equal(status, 403);
    assert.match(body.error, /token/i);
  });

  it('POST /api/cleanup/jobs with valid token creates job (202)', async () => {
    const { body: preview } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['test-temp-a'] });
    const { status, body } = await request(server, 'POST', '/api/cleanup/jobs', { targets: ['test-temp-a'], confirmationToken: preview.confirmationToken });
    assert.equal(status, 202);
    assert.ok(body.jobId);
  });

  it('GET /api/cleanup/jobs/:id returns progress and final result', async () => {
    activeFs = makeFakeFs();
    const { body: preview } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['test-temp-a'] });
    const { body: job } = await request(server, 'POST', '/api/cleanup/jobs', { targets: ['test-temp-a'], confirmationToken: preview.confirmationToken });
    const jobId = job.jobId;

    // Poll until completion
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 50));
      const { status, body: jobStatus } = await request(server, 'GET', `/api/cleanup/jobs/${jobId}`);
      assert.equal(status, 200);
      if (jobStatus.status === 'completed') {
        assert.ok(jobStatus.result);
        assert.equal(jobStatus.result.totals.filesDeleted, 2); // old.txt + old2.txt
        assert.ok(jobStatus.result.totals.bytesDeleted > 0);
        assert.equal(jobStatus.result.totals.protected, 1); // Cookies protected
        assert.equal(jobStatus.result.totals.skippedRecent, 1); // recent.txt
        break;
      }
    }
  });

  it('Cancellation stops job and releases lock', async () => {
    activeFs = makeFakeFs();
    const originalReaddir = activeFs.readdir;
    activeFs.readdir = async (...args) => { await new Promise(resolve => setTimeout(resolve, 100)); return originalReaddir(...args); };
    const { body: preview } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['test-temp-b'] });
    const { body: job } = await request(server, 'POST', '/api/cleanup/jobs', { targets: ['test-temp-b'], confirmationToken: preview.confirmationToken });
    const jobId = job.jobId;

    // Give it a moment to start, then cancel
    await new Promise(r => setTimeout(r, 10));
    const { status: cancelStatus } = await request(server, 'POST', `/api/cleanup/jobs/${jobId}/cancel`);
    assert.equal(cancelStatus, 200);

    const { status, body: jobStatus } = await request(server, 'GET', `/api/cleanup/jobs/${jobId}`);
    assert.equal(status, 200);
    assert.equal(jobStatus.status, 'cancelled');
  });

  it('Concurrent job on same target returns 409', async () => {
    activeFs = makeFakeFs();
    const originalReaddir = activeFs.readdir;
    activeFs.readdir = async (...args) => { await new Promise(resolve => setTimeout(resolve, 100)); return originalReaddir(...args); };
    // Two previews taken while the target is still free (preview itself also
    // returns 409 once a target is locked, so both tokens must exist first).
    const { body: preview1 } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['test-temp-a'] });
    const { body: preview2 } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['test-temp-a'] });

    const { body: job1 } = await request(server, 'POST', '/api/cleanup/jobs', { targets: ['test-temp-a'], confirmationToken: preview1.confirmationToken });
    assert.ok(job1.jobId, 'first job acquires the lock');

    const { status, body: job2 } = await request(server, 'POST', '/api/cleanup/jobs', { targets: ['test-temp-a'], confirmationToken: preview2.confirmationToken });
    assert.equal(status, 409);
    assert.equal(job2.error, 'Target is currently being cleaned.');
    assert.equal(job2.targetId, 'test-temp-a');

    // Let job1 finish before the next test.
    await new Promise(r => setTimeout(r, 200));
  });

  it('Preview token is single-use (replay rejected)', async () => {
    // The Concurrent test left test-temp-a locked (same as in production); we
    // need the lock released before this assertion can run. In prod this is
    // naturally serialized by the UI polling, so wait rather than force one.
    await waitUntilAvailable(server, ['test-temp-a']);
    activeFs = makeFakeFs();
    const { body: preview } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['test-temp-a'] });
    const first = await request(server, 'POST', '/api/cleanup/jobs', { targets: ['test-temp-a'], confirmationToken: preview.confirmationToken });
    assert.equal(first.status, 202, 'first use of the token must succeed');

    const { status } = await request(server, 'POST', '/api/cleanup/jobs', { targets: ['test-temp-a'], confirmationToken: preview.confirmationToken });
    assert.equal(status, 403, 'replaying the same token must be rejected');
  });

  it('Audit log contains no filenames or contents', async () => {
    activeFs = makeFakeFs();
    const auditPath = '/tmp/test-cleanup-audit.jsonl';
    await fs.rm(auditPath, { force: true }).catch(() => {});
    const { body: preview } = await request(server, 'POST', '/api/cleanup/preview', { targets: ['test-temp-a'] });
    await request(server, 'POST', '/api/cleanup/jobs', { targets: ['test-temp-a'], confirmationToken: preview.confirmationToken });
    await new Promise(r => setTimeout(r, 200));

    const content = await fs.readFile(auditPath, 'utf8').catch(() => '');
    assert.ok(content.length > 0);
    const audit = JSON.parse(content.trim().split('\n')[0]);
    assert.ok(audit.timestamp);
    assert.ok(audit.targetIds);
    assert.ok(typeof audit.filesDeleted === 'number');
    assert.ok(typeof audit.bytesReclaimed === 'number');
    assert.ok(!('files' in audit), 'no per-file listing');
    assert.ok(!('contents' in audit), 'no file contents');
  });
});

async function waitUntilAvailable(server, targetIds) {
  for (let i = 0; i < 50; i++) {
    const { status } = await request(server, 'POST', '/api/cleanup/preview', { targets: targetIds });
    if (status !== 409) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Target still locked after timeout');
}

// ---- Engine behavior tests (already in cleanup.test.js but add one more) ----
describe('cleanup engine extra safety', () => {
  it('engine preview never includes internalPath in response', async () => {
    const fsStub = makeFakeFs();
    const result = await cleanupEngine.preview(['test-temp-a'], { fs: fsStub, minAgeHours: 1 });
    assert.ok(!result.targets.some(t => 'internalPath' in t), 'internalPath must not leak');
  });

  it('engine execute never deletes root directory', async () => {
    const fsStub = makeFakeFs();
    await cleanupEngine.execute(['test-temp-a'], { fs: fsStub, minAgeHours: 1 });
    const rootStat = await fsStub.lstat('/cleanup/test-temp-a').catch(() => null);
    assert.ok(rootStat && rootStat.isDirectory(), 'root must persist');
  });
});