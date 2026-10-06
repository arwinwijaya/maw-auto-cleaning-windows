'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const {
  HOST,
  DEFAULT_SCAN_TIMEOUT_MS,
  createServer,
  scanAll,
  start,
  walkFolder,
  resolveTimeoutMs,
  getWhitelist,
} = require('../server.js');

const TEST_FOLDERS = [
  'Local\\Temp',
  'Windows\\Temp',
  'Windows\\Prefetch',
  '$Recycle.Bin',
  'SoftwareDistribution\\Download',
];

function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function fakeStat(kind, size = 0) {
  return {
    size,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir' || kind === 'reparse-dir',
    isSymbolicLink: () => kind === 'symlink' || kind === 'junction',
    isReparsePoint: () => kind === 'reparse-dir',
  };
}

function dirent(name) {
  return { name };
}

function createFsStub({ dirs = {}, stats = {}, errors = {} }) {
  const calls = {
    readdir: [],
    lstat: [],
    stat: [],
  };

  const fsStub = {
    calls,
    async readdir(targetPath) {
      calls.readdir.push(targetPath);
      const error = errors[`readdir:${targetPath}`];
      if (error) throw error;
      if (!Object.prototype.hasOwnProperty.call(dirs, targetPath)) {
        throw makeError('ENOENT');
      }
      return dirs[targetPath].map(dirent);
    },
    async lstat(targetPath) {
      calls.lstat.push(targetPath);
      const error = errors[`lstat:${targetPath}`];
      if (error) throw error;
      if (!Object.prototype.hasOwnProperty.call(stats, targetPath)) {
        throw makeError('ENOENT');
      }
      return stats[targetPath];
    },
    async stat(targetPath) {
      calls.stat.push(targetPath);
      throw new Error(`fs.stat must not be called for ${targetPath}`);
    },
  };

  return fsStub;
}

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

async function request(server, method, requestPath) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST,
      port: address.port,
      path: requestPath,
      method,
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let body = data;
        try { body = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`${method} ${requestPath} timed out`));
    });
    req.end();
  });
}

describe('server', () => {
  it('GET /api/scan returns 5 entries with ready status (happy path)', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-cleaning-server-'));
    const whitelistRoots = TEST_FOLDERS.map((name) => ({
      name,
      path: path.join(tmpRoot, ...name.split('\\')),
    }));

    try {
      for (const folder of whitelistRoots) {
        await fs.mkdir(folder.path, { recursive: true });
      }
      await fs.writeFile(path.join(whitelistRoots[0].path, 'file1.txt'), 'hello');
      await fs.writeFile(path.join(whitelistRoots[1].path, 'log.txt'), 'log');
      await fs.mkdir(path.join(whitelistRoots[3].path, 'S-1-5-21-123'), { recursive: true });
      await fs.writeFile(path.join(whitelistRoots[3].path, 'S-1-5-21-123', 'trash.txt'), 'deleted');
      await fs.writeFile(path.join(whitelistRoots[4].path, 'update.exe'), 'binary');

      const server = await listen(createServer({ whitelistRoots }));
      try {
        const { status, body } = await request(server, 'GET', '/api/scan');
        assert.equal(status, 200);
        assert.equal(body.entries.length, 5);
        assert.equal(body.partial, false);
        assert.match(body.scannedAt, /^\d{4}-\d{2}-\d{2}T/);

        for (const entry of body.entries) {
          assert.equal(typeof entry.name, 'string');
          assert.equal(typeof entry.path, 'string');
          assert.equal(typeof entry.fileCount, 'number');
          assert.equal(typeof entry.sizeBytes, 'number');
          assert.equal(typeof entry.sizeHuman, 'string');
          assert.equal(entry.status, 'ready');
        }
      } finally {
        await closeServer(server);
      }
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('rejects delete routes and applies 404 before method 405 for unknown API paths', async () => {
    const server = await listen(createServer({ whitelistRoots: [] }));
    try {
      const postDelete = await request(server, 'POST', '/api/delete');
      assert.equal(postDelete.status, 404);
      assert.equal(typeof postDelete.body.error, 'string');
      assert.match(postDelete.body.error, /tidak ditemukan/i);

      const deleteScan = await request(server, 'DELETE', '/api/scan');
      assert.equal(deleteScan.status, 405);
      assert.equal(typeof deleteScan.body.error, 'string');
      assert.match(deleteScan.body.error, /metode/i);

      const deleteDelete = await request(server, 'DELETE', '/api/delete');
      assert.equal(deleteDelete.status, 404);
      assert.equal(typeof deleteDelete.body.error, 'string');
      assert.match(deleteDelete.body.error, /tidak ditemukan/i);
    } finally {
      await closeServer(server);
    }
  });

  it('returns HTTP 200, access_denied entries, and top-level partial when every folder is denied', async () => {
    const whitelistRoots = TEST_FOLDERS.map((name) => ({ name, path: `C:\\Denied\\${name}` }));
    const fsStub = {
      async lstat() { throw makeError('EACCES'); },
    };
    const server = await listen(createServer({ whitelistRoots, fs: fsStub }));

    try {
      const { status, body } = await request(server, 'GET', '/api/scan');
      assert.equal(status, 200);
      assert.equal(body.partial, true);
      assert.equal(body.entries.length, 5);
      assert.deepEqual(body.entries.map((entry) => entry.status), Array(5).fill('access_denied'));
      assert(body.entries.every((entry) => entry.fileCount === 0 && entry.sizeBytes === 0));
    } finally {
      await closeServer(server);
    }
  });

  it('Partial entry includes reason field (timeout) [R16]', async () => {
    const first = 'C:\\Scan\\first';
    const second = 'C:\\Scan\\second';
    const third = 'C:\\Scan\\third';
    let time = 0;
    const fsStub = createFsStub({
      dirs: { [first]: [], [second]: [] },
      stats: { [first]: fakeStat('dir'), [second]: fakeStat('dir') },
    });
    const originalReaddir = fsStub.readdir;
    fsStub.readdir = async (target) => {
      const entries = await originalReaddir(target);
      if (target === second) time = 30_000;
      return entries;
    };
    const now = () => time;

    const server = await listen(createServer({
      whitelistRoots: [
        { name: 'first', path: first },
        { name: 'second', path: second },
        { name: 'third', path: third },
      ],
      fs: fsStub,
      now,
      timeoutMs: 30_000,
    }));

    try {
      const { status, body } = await request(server, 'GET', '/api/scan');
      assert.equal(status, 200);
      assert.equal(body.partial, true);
      assert.equal(body.entries[0].status, 'ready');
      assert.equal(body.entries[1].status, 'partial');
      assert.equal(body.entries[1].fileCount, 0);
      assert.equal(body.entries[1].sizeBytes, 0);
      assert.equal(body.entries[1].reason, 'timeout');
      assert.equal(body.entries[2].status, 'partial');
      assert.equal(body.entries[2].fileCount, 0);
      assert.equal(body.entries[2].sizeBytes, 0);
      assert.equal(body.entries[2].reason, 'timeout');
    } finally {
      await closeServer(server);
    }
  });

  it('enforces the total 30s timeout and marks unfinished folders partial with zero totals', async () => {
    const first = 'C:\\Scan\\first';
    const second = 'C:\\Scan\\second';
    const third = 'C:\\Scan\\third';
    let time = 0;
    const fsStub = createFsStub({
      dirs: { [first]: [], [second]: [] },
      stats: { [first]: fakeStat('dir'), [second]: fakeStat('dir') },
    });
    const originalReaddir = fsStub.readdir;
    fsStub.readdir = async (target) => {
      const entries = await originalReaddir(target);
      if (target === second) time = 30_000;
      return entries;
    };
    const now = () => time;

    const body = await scanAll({
      whitelistRoots: [
        { name: 'first', path: first },
        { name: 'second', path: second },
        { name: 'third', path: third },
      ],
      fs: fsStub,
      now,
      timeoutMs: 30_000,
    });

    assert.equal(body.partial, true);
    assert.equal(body.entries[0].status, 'ready');
    assert.equal(body.entries[1].status, 'partial');
    assert.equal(body.entries[1].fileCount, 0);
    assert.equal(body.entries[1].sizeBytes, 0);
    assert.equal(body.entries[2].status, 'partial');
    assert.equal(body.entries[2].fileCount, 0);
    assert.equal(body.entries[2].sizeBytes, 0);
  });

  it('exports and binds to 127.0.0.1 only', async () => {
    assert.equal(HOST, '127.0.0.1');
    assert.equal(resolveTimeoutMs({}), DEFAULT_SCAN_TIMEOUT_MS);
    assert.equal(resolveTimeoutMs({ timeoutMs: 1234 }), 1234);
    const server = await start({ port: 0, whitelistRoots: [] });
    try {
      assert.equal(server.address().address, '127.0.0.1');
    } finally {
      await closeServer(server);
    }
  });

  it('skips access-denied files and keeps the folder ready when skips are <= 10%', async () => {
    const root = 'C:\\Temp\\ready-with-one-skip';
    const files = Array.from({ length: 10 }, (_, index) => `file-${index}.tmp`);
    const locked = 'locked.tmp';
    const stats = Object.fromEntries(files.map((name) => [path.join(root, name), fakeStat('file', 1)]));
    const fsStub = createFsStub({
      dirs: { [root]: [...files, locked] },
      stats,
      errors: { [`lstat:${path.join(root, locked)}`]: makeError('EPERM') },
    });

    const result = await walkFolder(root, {
      fs: fsStub,
      now: () => 0,
      startedAt: 0,
      timeoutMs: 30_000,
    });

    assert.equal(result.fileCount, 10);
    assert.equal(result.sizeBytes, 10);
    assert.equal(result.skipped, 1);
    assert.equal(result.partial, false);
    assert.equal(fsStub.calls.stat.length, 0);
  });

  it('skips ENOENT files that vanish mid-walk without crashing', async () => {
    const root = 'C:\\Temp\\vanished';
    const kept = path.join(root, 'kept.tmp');
    const vanished = path.join(root, 'vanished.tmp');
    const fsStub = createFsStub({
      dirs: { [root]: ['kept.tmp', 'vanished.tmp'] },
      stats: { [kept]: fakeStat('file', 7) },
      errors: { [`lstat:${vanished}`]: makeError('ENOENT') },
    });

    const result = await walkFolder(root, {
      fs: fsStub,
      now: () => 0,
      startedAt: 0,
      timeoutMs: 30_000,
    });

    assert.equal(result.fileCount, 1);
    assert.equal(result.sizeBytes, 7);
    assert.equal(result.skipped, 1);
    assert.equal(fsStub.calls.stat.length, 0);
  });

  it('Skipped files partial includes count [R16]', async () => {
    const root = 'C:\\Temp\\skipped-reason';
    const files = Array.from({ length: 100 }, (_, index) => `file-${index}.tmp`);
    const locked = Array.from({ length: 15 }, (_, index) => `locked-${index}.tmp`);
    const stats = {
      [root]: fakeStat('dir'),
      ...Object.fromEntries(files.map((name) => [path.join(root, name), fakeStat('file', 1)])),
    };
    const errors = Object.fromEntries(
      locked.map((name) => [`lstat:${path.join(root, name)}`, makeError('EPERM')]),
    );
    const fsStub = createFsStub({
      dirs: { [root]: [...files, ...locked] },
      stats,
      errors,
    });

    const body = await scanAll({
      whitelistRoots: [{ name: 'Windows\\Temp', path: root }],
      fs: fsStub,
      now: () => 0,
      timeoutMs: 30_000,
    });

    assert.equal(body.partial, true);
    assert.equal(body.entries[0].status, 'partial');
    assert.equal(body.entries[0].fileCount, 100);
    assert.equal(body.entries[0].reason, 'skipped=15');
  });

  it('marks a folder partial when skipped files are more than 10% of counted files', async () => {
    const root = 'C:\\Temp\\too-many-skips';
    const files = Array.from({ length: 5 }, (_, index) => `file-${index}.tmp`);
    const skipped = 'skipped.tmp';
    const stats = {
      [root]: fakeStat('dir'),
      ...Object.fromEntries(files.map((name) => [path.join(root, name), fakeStat('file', 1)])),
    };
    const fsStub = createFsStub({
      dirs: { [root]: [...files, skipped] },
      stats,
      errors: { [`lstat:${path.join(root, skipped)}`]: makeError('EACCES') },
    });

    const body = await scanAll({
      whitelistRoots: [{ name: 'Windows\\Temp', path: root }],
      fs: fsStub,
      now: () => 0,
      timeoutMs: 30_000,
    });

    assert.equal(body.partial, true);
    assert.equal(body.entries[0].status, 'partial');
    assert.equal(body.entries[0].fileCount, 5);
    assert.equal(body.entries[0].sizeBytes, 5);
  });

  it('Access denied partial includes reason [R16]', async () => {
    const root = 'C:\\Temp\\denied-folder';
    const fsStub = createFsStub({
      dirs: {},
      stats: {},
      errors: { [`lstat:${root}`]: makeError('EACCES') },
    });

    const body = await scanAll({
      whitelistRoots: [{ name: 'Windows\\Temp', path: root }],
      fs: fsStub,
      now: () => 0,
      timeoutMs: 30_000,
    });

    assert.equal(body.partial, true);
    assert.equal(body.entries[0].status, 'access_denied');
    assert.equal(body.entries[0].reason, 'access_denied');
  });

  it('does not follow symlink or junction targets and does not count target size', async () => {
    const root = 'C:\\Temp\\links';
    const link = path.join(root, 'junction-to-large-target');
    const ownFile = path.join(root, 'own.tmp');
    const targetFile = path.join(link, 'large-target.bin');
    const fsStub = createFsStub({
      dirs: {
        [root]: ['junction-to-large-target', 'own.tmp'],
        [link]: ['large-target.bin'],
      },
      stats: {
        [link]: fakeStat('junction'),
        [ownFile]: fakeStat('file', 3),
        [targetFile]: fakeStat('file', 999_999),
      },
    });

    const result = await walkFolder(root, {
      fs: fsStub,
      now: () => 0,
      startedAt: 0,
      timeoutMs: 30_000,
    });

    assert.equal(result.fileCount, 1);
    assert.equal(result.sizeBytes, 3);
    assert(!fsStub.calls.readdir.includes(link), 'must not recurse into the junction target');
    assert.equal(fsStub.calls.stat.length, 0);
  });

  it('skips generic reparse-point directories before they can be followed', async () => {
    const root = 'C:\\Temp\\reparse';
    const reparseDir = path.join(root, 'reparse-target');
    const targetFile = path.join(reparseDir, 'target.bin');
    const fsStub = createFsStub({
      dirs: {
        [root]: ['reparse-target'],
        [reparseDir]: ['target.bin'],
      },
      stats: {
        [reparseDir]: fakeStat('reparse-dir'),
        [targetFile]: fakeStat('file', 123_456),
      },
    });

    const result = await walkFolder(root, {
      fs: fsStub,
      now: () => 0,
      startedAt: 0,
      timeoutMs: 30_000,
    });

    assert.equal(result.fileCount, 0);
    assert.equal(result.sizeBytes, 0);
    assert(!fsStub.calls.readdir.includes(reparseDir), 'must not recurse into reparse targets');
  });

  it('skips typed reparse-point directories before they can be followed', async () => {
    const root = 'C:\\Temp\\typed-reparse';
    const reparseDir = path.join(root, 'reparse-target');
    const readdirCalls = [];
    const fsStub = {
      async readdir(dir) {
        readdirCalls.push(dir);
        if (dir === root) {
          return [{
            name: 'reparse-target',
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          }];
        }
        return [{
          name: 'target.bin',
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
        }];
      },
      async lstat(file) {
        if (file === reparseDir) {
          return fakeStat('reparse-dir');
        }
        return fakeStat('file', 50);
      },
    };

    const result = await walkFolder(root, {
      fs: fsStub,
      now: () => 0,
      startedAt: 0,
      timeoutMs: 30_000,
    });

    assert.equal(result.fileCount, 0);
    assert.equal(result.sizeBytes, 0);
    assert(!readdirCalls.includes(reparseDir), 'must never readdir into reparse directory');
  });

  it('detects deadline after all started lstats settle', async () => {
    const root = 'C:\\Temp\\deadline-after-lstats';
    const names = ['a.tmp', 'b.tmp'];
    let calls = 0;
    let time = 0;
    const fsStub = {
      async readdir() {
        return names.map((name) => ({
          name,
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
        }));
      },
      async lstat() {
        calls += 1;
        if (calls === names.length) time = 35_000;
        return fakeStat('file', 10);
      },
    };

    const result = await walkFolder(root, {
      fs: fsStub,
      now: () => time,
      startedAt: 0,
      timeoutMs: 30_000,
    });

    assert.equal(calls, names.length, 'all started lstats should settle');
    assert.equal(result.timedOut, true);
    assert.equal(result.partial, true);
  });

  it('returns at the strict deadline while readdir remains pending', async () => {
    const root = 'C:\\Temp\\never-settles';
    const never = new Promise(() => {});
    let calls = 0;
    const result = await walkFolder(root, {
      fs: {
        async readdir() {
          calls += 1;
          return never;
        },
      },
      now: () => 0,
      startedAt: 0,
      timeoutMs: 10,
    });

    assert.equal(calls, 1);
    assert.deepEqual(result, {
      fileCount: 0,
      sizeBytes: 0,
      skipped: 0,
      timedOut: true,
      partial: true,
    });
  });

  it('treats a late-settling operation as timedOut even if the timer has not fired', async () => {
    const root = 'C:\\Temp\\late-settle';
    let time = 0;
    const result = await walkFolder(root, {
      fs: {
        async readdir() {
          time = 40_000; // settle after the 30s deadline
          return [];
        },
      },
      now: () => time,
      startedAt: 0,
      timeoutMs: 30_000,
    });

    assert.equal(result.timedOut, true);
    assert.equal(result.partial, true);
  });

  it('returns partial when the root lstat hangs past the deadline', async () => {
    const root = 'C:\\Temp\\hanging-root';
    const never = new Promise(() => {});
    const body = await scanAll({
      whitelistRoots: [{ name: 'Hang', path: root }],
      fs: { async lstat() { return never; } },
      now: () => 0,
      timeoutMs: 10,
    });

    assert.equal(body.entries[0].status, 'partial');
    assert.equal(body.entries[0].reason, 'timeout');
  });

  it('starts no new filesystem work after the deadline fires', async () => {
    const first = 'C:\\Temp\\first';
    const second = 'C:\\Temp\\second';
    const readdirCalls = [];
    const never = new Promise(() => {});
    const fsStub = {
      async readdir(target) {
        readdirCalls.push(target);
        return target === first ? never : [];
      },
      async lstat() {
        return fakeStat('dir');
      },
    };

    const body = await scanAll({
      whitelistRoots: [
        { name: 'First', path: first },
        { name: 'Second', path: second },
      ],
      fs: fsStub,
      now: () => 0,
      timeoutMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(readdirCalls, [first], 'second folder must not start after timeout');
    assert.equal(body.entries[0].status, 'partial');
    assert.equal(body.entries[1].status, 'partial');
  });

  it('GET /api/scan/stream streams progress folder events and terminates with event: done', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sse-stream-'));
    const first = path.join(tmpRoot, 'first');
    const second = path.join(tmpRoot, 'second');
    await fs.mkdir(first, { recursive: true });
    await fs.mkdir(second, { recursive: true });
    await fs.writeFile(path.join(first, 'a.tmp'), '0123456789');
    await fs.writeFile(path.join(second, 'b.tmp'), '01234567890123456789');
    const whitelistRoots = [
      { name: 'first', path: first },
      { name: 'second', path: second },
    ];

    const server = await listen(createServer({ whitelistRoots }));
    try {
      const address = server.address();
      const rawData = await new Promise((resolve, reject) => {
        let buf = '';
        const req = http.request({
          hostname: HOST,
          port: address.port,
          path: '/api/scan/stream',
          method: 'GET',
          headers: { accept: 'text/event-stream' },
        }, (res) => {
          assert.equal(res.statusCode, 200);
          assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            buf += chunk;
            if (buf.includes('event: done')) {
              req.destroy();
              resolve(buf);
            }
          });
          res.on('end', () => resolve(buf));
        });
        req.on('error', (err) => {
          if (buf.includes('event: done')) resolve(buf);
          else reject(err);
        });
        req.end();
      });

      assert.match(rawData, /event: folder\ndata: /);
      assert.match(rawData, /event: done\ndata: /);
      const doneMatch = rawData.match(/event: done\ndata: (.+)/);
      assert.ok(doneMatch, 'must contain done event data');
      const finalPayload = JSON.parse(doneMatch[1]);
      assert.equal(finalPayload.entries.length, 2);
      assert.equal(finalPayload.partial, false);
      assert.equal(typeof finalPayload.scannedAt, 'string');
    } finally {
      await closeServer(server);
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('GET /api/scan/stream cleans up and stops the stream on client disconnect', async () => {
    let readdirCount = 0;
    const never = new Promise(() => {});
    const fsStub = {
      async lstat() { return fakeStat('dir'); },
      async readdir() {
        readdirCount += 1;
        return never;
      },
    };
    const whitelistRoots = [{ name: 'Hang', path: 'C:\\Hang' }];
    const server = await listen(createServer({ whitelistRoots, fs: fsStub }));
    const errors = [];
    const onUncaught = (error) => errors.push(error);
    process.on('uncaughtException', onUncaught);
    try {
      const address = server.address();
      let receivedDone = false;
      let responseBody = '';
      await new Promise((resolve) => {
        const req = http.request({
          hostname: HOST,
          port: address.port,
          path: '/api/scan/stream',
          method: 'GET',
        }, (res) => {
          assert.equal(res.statusCode, 200);
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            responseBody += chunk;
            if (responseBody.includes('event: done')) receivedDone = true;
          });
          setTimeout(() => {
            req.destroy();
            resolve();
          }, 20);
        });
        req.on('error', () => resolve());
        req.end();
      });

      // Give the server time to observe the socket close and settle the stream.
      await new Promise((resolve) => setTimeout(resolve, 60));

      assert.equal(readdirCount, 1, 'disconnect must not restart or repeat folder work');
      assert.equal(receivedDone, false, 'aborted stream must not emit a terminal done event');
      assert.deepEqual(errors, [], 'client disconnect must not surface uncaught errors');

      // The server must stay healthy for other clients after the abort.
      const health = await request(server, 'GET', '/favicon.svg');
      assert.equal(health.status, 200, 'server must keep serving after a stream abort');
    } finally {
      process.off('uncaughtException', onUncaught);
      await closeServer(server);
    }
  });

  it('rejects reparse-point or symlink roots as not_found', async () => {
    const root = 'C:\\Temp\\reparse-root';
    const fsStub = createFsStub({
      dirs: { [root]: [] },
      stats: { [root]: fakeStat('reparse-dir') },
    });

    const body = await scanAll({
      whitelistRoots: [{ name: 'Root', path: root }],
      fs: fsStub,
      now: () => 0,
      timeoutMs: 30_000,
    });

    assert.equal(body.entries[0].status, 'not_found');
  });

  it('reason key is absent for ready/not_found entries', async () => {
    const root = 'C:\\Temp\\ready-no-reason';
    const files = ['a.tmp', 'b.tmp'];
    const fsStub = createFsStub({
      dirs: { [root]: [...files] },
      stats: {
        [root]: fakeStat('dir'),
        [path.join(root, 'a.tmp')]: fakeStat('file', 1),
        [path.join(root, 'b.tmp')]: fakeStat('file', 2),
      },
    });

    const body = await scanAll({
      whitelistRoots: [
        { name: 'Windows\\Temp', path: root },
        { name: 'Missing', path: 'C:\\Temp\\missing-no-reason' },
      ],
      fs: fsStub,
      now: () => 0,
      timeoutMs: 30_000,
    });

    assert.equal(body.entries[0].status, 'ready');
    assert(!('reason' in body.entries[0]), 'reason must be absent for ready');
    assert.equal(body.entries[1].status, 'not_found');
    assert(!('reason' in body.entries[1]), 'reason must be absent for not_found');
  });

  it('Given D: roots raise ENOENT and C: root exists When scanAll() runs Then D: entries are not_found and C: stays ready', async () => {
    const cRoot = 'C:\\Temp\\multi-drive-ready';
    const dTemp = 'D:\\Temp';
    const dProgramFiles = 'D:\\Program Files';
    const cFile = path.join(cRoot, 'keep.tmp');

    // The stub throws ENOENT for any path absent from `stats`, so both D: roots
    // are missing while the C: root resolves to a real directory.
    const fsStub = createFsStub({
      dirs: { [cRoot]: ['keep.tmp'] },
      stats: {
        [cRoot]: fakeStat('dir'),
        [cFile]: fakeStat('file', 5),
      },
    });

    const body = await scanAll({
      whitelistRoots: [
        { name: 'Local\\Temp', path: cRoot, group: 'temp' },
        { name: 'D:\\Temp', path: dTemp, group: 'temp' },
        { name: 'D:\\Program Files', path: dProgramFiles, group: 'app' },
      ],
      fs: fsStub,
      now: () => 0,
      timeoutMs: 30_000,
    });

    assert.equal(body.entries.length, 3, 'every whitelist root must still produce an entry');

    const cEntry = body.entries.find((entry) => entry.path === cRoot);
    assert.ok(cEntry, 'C: entry must exist');
    assert.equal(cEntry.status, 'ready', 'C: must remain ready even when D: is absent');
    assert.equal(cEntry.fileCount, 1);
    assert.equal(cEntry.sizeBytes, 5);

    for (const dPath of [dTemp, dProgramFiles]) {
      const entry = body.entries.find((candidate) => candidate.path === dPath);
      assert.ok(entry, `${dPath} entry must exist`);
      assert.equal(entry.status, 'not_found', `${dPath} must be not_found`);
      assert.equal(entry.fileCount, 0);
      assert.equal(entry.sizeBytes, 0);
    }

    assert.equal(body.partial, false, 'missing roots must not mark the scan partial');
  });

  it('walks typed dirents concurrently within a bound without changing totals', async () => {
    const root = 'C:\\Temp\\concurrent';
    const child = path.join(root, 'child');
    const files = Array.from({ length: 64 }, (_, i) => `file-${i}.tmp`);
    let active = 0;
    let peak = 0;
    const statPaths = [];
    const fsStub = {
      async readdir(dir) {
        if (dir === child) return [{ name: 'nested.tmp', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }];
        return [
          ...files.map((name) => ({ name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false })),
          { name: 'child', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
        ];
      },
      async lstat(file) {
        statPaths.push(file);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        return fakeStat('file', file.endsWith('nested.tmp') ? 7 : 2);
      },
    };
    const result = await walkFolder(root, { fs: fsStub, now: () => 0, startedAt: 0, timeoutMs: 30_000 });
    assert.deepEqual(result, { fileCount: 65, sizeBytes: 135, skipped: 0, timedOut: false, partial: false });
    assert(peak > 1, 'lstat must overlap (sequential walker fails)');
    assert(peak <= 32, 'lstat must never exceed the worker limit');
    assert(statPaths.length === 66, '65 file lstats + 1 typed-directory reparse lstat');
    assert(statPaths.includes(child), 'typed directory is lstated once for reparse-point safety');
  });

  it('returns partial without filesystem calls when the deadline already expired', async () => {
    let calls = 0;
    const fsStub = { async readdir() { calls += 1; throw Error('must not read'); }, async lstat() { calls += 1; throw Error('must not stat'); } };
    const result = await walkFolder('C:\\Temp\\expired', {
      fs: fsStub, now: () => 30_000, startedAt: 0, timeoutMs: 30_000,
    });
    assert.deepEqual(result, { fileCount: 0, sizeBytes: 0, skipped: 0, timedOut: true, partial: true });
    assert.equal(calls, 0);
  });

  it('resolves the scan timeout from env and options', async () => {
    const previous = process.env.SCAN_TIMEOUT_MS;
    try {
      process.env.SCAN_TIMEOUT_MS = '180000';
      assert.equal(resolveTimeoutMs({}), 180000);
      assert.equal(resolveTimeoutMs({ timeoutMs: 1234 }), 1234);
      process.env.SCAN_TIMEOUT_MS = 'not-a-number';
      assert.equal(resolveTimeoutMs({}), DEFAULT_SCAN_TIMEOUT_MS);
    } finally {
      if (previous === undefined) delete process.env.SCAN_TIMEOUT_MS;
      else process.env.SCAN_TIMEOUT_MS = previous;
    }
  });

  it('terminates symlink/junction loops by never recursing into the link', async () => {
    const root = 'C:\\Temp\\loop';
    const loop = path.join(root, 'loop-back');
    const fsStub = createFsStub({
      dirs: {
        [root]: ['loop-back'],
        [loop]: ['loop-back'],
      },
      stats: { [loop]: fakeStat('junction') },
    });

    const result = await walkFolder(root, {
      fs: fsStub,
      now: () => 0,
      startedAt: 0,
      timeoutMs: 30_000,
    });

    assert.equal(result.fileCount, 0);
    assert.equal(result.sizeBytes, 0);
    assert.deepEqual(fsStub.calls.readdir, [root]);
  });

  it('CSP header present on all responses [R13]', async () => {
    const server = await listen(createServer({ whitelistRoots: [] }));
    try {
      const pathsToTest = ['/', '/app.js', '/api/scan'];

      for (const p of pathsToTest) {
        const { headers } = await request(server, 'GET', p);

        assert.ok(headers['content-security-policy'], 'CSP header missing for ' + p);
        assert.match(headers['content-security-policy'], /default-src 'self'/, 'CSP default-src');
        assert.match(headers['content-security-policy'], /script-src 'self'/, 'CSP script-src');
        assert.match(headers['content-security-policy'], /connect-src 'self'/, 'CSP connect-src');
        assert.equal(headers['x-content-type-options'], 'nosniff', 'nosniff');
        assert.equal(headers['referrer-policy'], 'no-referrer', 'no-referrer');
        assert.equal(headers['x-frame-options'], 'DENY', 'DENY');
      }
    } finally {
      await closeServer(server);
    }
  });

  it('CSP declares inline-style allowance [R14]', async () => {
    const server = await listen(createServer({ whitelistRoots: [] }));
    try {
      const { headers } = await request(server, 'GET', '/');
      assert.ok(headers['content-security-policy'], 'CSP missing');
      assert.match(headers['content-security-policy'], /style-src 'self' 'unsafe-inline'/, 'style-src must include unsafe-inline');
    } finally {
      await closeServer(server);
    }
  });

  // ---------------------------------------------------------------------------
  // Cycle 1: Favicon served correctly [R12]
  // ---------------------------------------------------------------------------
  describe('R12: favicon served correctly', () => {
    it('GET /favicon.svg returns 200, image/svg+xml, and CSP header', async () => {
      const server = await listen(createServer({ whitelistRoots: [] }));
      try {
        const { status, headers } = await request(server, 'GET', '/favicon.svg');
        assert.equal(status, 200, 'favicon should return 200');
        assert.equal(headers['content-type'], 'image/svg+xml', 'content-type must be image/svg+xml');
        assert.ok(headers['content-security-policy'], 'CSP header must be present on favicon');
        assert.match(headers['content-security-policy'], /default-src 'self'/, 'CSP default-src');
      } finally {
        await closeServer(server);
      }
    });
  });

  it('Given profile resolution used fallback When getWhitelist builds Local\\Temp entry Then entry carries fallback: true', async () => {
    const previousRoots = process.env.SCAN_ROOTS;
    const previousMount = process.env.SCAN_HOST_MOUNT;
    const previousFixture = process.env.TEST_FIXTURE_ROOT;
    delete process.env.SCAN_ROOTS;
    delete process.env.SCAN_HOST_MOUNT;
    delete process.env.TEST_FIXTURE_ROOT;

    try {
      // Inject a resolution that failed and fell back to C:\Temp.
      const roots = await getWhitelist({
        resolveUserPaths: async () => ({
          localAppData: null,
          temp: 'C:\\Temp',
          usedFallback: true,
        }),
      });
      const localTemp = roots.find((folder) => folder.name === 'Local\\Temp');
      assert.ok(localTemp, 'Local\\Temp entry exists');
      assert.equal(localTemp.path, 'C:\\Temp');
      assert.equal(localTemp.fallback, true);
    } finally {
      if (previousRoots === undefined) delete process.env.SCAN_ROOTS;
      else process.env.SCAN_ROOTS = previousRoots;
      if (previousMount === undefined) delete process.env.SCAN_HOST_MOUNT;
      else process.env.SCAN_HOST_MOUNT = previousMount;
      if (previousFixture === undefined) delete process.env.TEST_FIXTURE_ROOT;
      else process.env.TEST_FIXTURE_ROOT = previousFixture;
    }
  });
});
