'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { createServer } = require('../server.js');

function request(server, method, pathname, body = null, extraHeaders = {}) {
  const addr = server.address();
  const port = addr.port;
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        'content-type': 'application/json',
        ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        ...extraHeaders,
      },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(chunks); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json || chunks });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('HTTP API progressive scan and cancellation', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-http-live-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  // Create fast.txt (100 bytes) and slow/slow.txt (200 bytes)
  fs.mkdirSync(path.join(base, 'slow'), { recursive: true });
  fs.writeFileSync(path.join(base, 'fast.txt'), Buffer.alloc(100));
  fs.writeFileSync(path.join(base, 'slow', 'slow.txt'), Buffer.alloc(200));

  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const realReaddir = fs.promises.readdir.bind(fs.promises);
  const gatingFs = {
    lstat: fs.promises.lstat.bind(fs.promises),
    readdir: async (p, opts) => {
      if (String(p).endsWith(`${path.sep}slow`)) {
        await slowGate;
        return realReaddir(p, opts);
      }
      const entries = await realReaddir(p, opts);
      // Deterministic order: fast.txt attaches before the gated slow dir.
      return [...entries].sort((a, b) => a.name.localeCompare(b.name));
    },
  };

  const roots = [{ id: 'test-root', name: 'Test Root', path: base, displayPath: 'C:\\Test' }];
  const server = createServer({ scanRoots: JSON.stringify(roots), fs: gatingFs });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  // 1. Resolve the server-issued root id, then start a scan for it.
  const rootsRes = await request(server, 'GET', '/api/roots');
  assert.equal(rootsRes.status, 200);
  const rootId = rootsRes.body.roots[0].id;

  const startRes = await request(server, 'POST', '/api/scans', { rootId });
  assert.equal(startRes.status, 202);
  const scanId = startRes.body.scanId;

  // 2. Poll until fast.txt is attached to the live root (slow still blocked).
  let treeRes = null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    treeRes = await request(server, 'GET', `/api/scans/${scanId}/tree/root`);
    if (treeRes.body.children && treeRes.body.children.some((c) => c.name === 'fast.txt')) break;
    await new Promise((r) => setTimeout(r, 25));
  }

  assert.equal(treeRes.status, 200);
  assert.equal(treeRes.body.status, 'scanning');
  assert.equal(treeRes.body.partial, true);

  const childrenNames = treeRes.body.children.map((c) => c.name);
  assert.ok(childrenNames.includes('fast.txt'), `completed fast.txt must appear in root children; got ${childrenNames}`);
  // Live totals must reflect the completed sibling (100 bytes), not zero.
  assert.equal(treeRes.body.parent.sizeBytes, 100);
  assert.equal(treeRes.body.parent.fileCount, 1);
  assert.equal(treeRes.body.driveTotalBytes, 100);

  // 3. Cancel while the sibling read is still held open.
  const cancelRes = await request(server, 'POST', `/api/scans/${scanId}/cancel`);
  assert.equal(cancelRes.status, 202);
  assert.equal(cancelRes.body.status, 'cancelling');

  // Cancellation must not wait for the hung readdir: poll to a terminal state.
  let statusRes = null;
  const cancelDeadline = Date.now() + 5000;
  while (Date.now() < cancelDeadline) {
    statusRes = await request(server, 'GET', `/api/scans/${scanId}/status`);
    if (statusRes.body.status !== 'scanning') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(statusRes.body.status, 'cancelled');

  releaseSlow(); // Unblock so the process exits cleanly.
});

test('HTTP API configured unavailable root remains listed and reports not_found on scan', async (t) => {
  const missingPath = path.join(os.tmpdir(), `dua-missing-root-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  
  const scanRoots = JSON.stringify([{
    name: 'Missing',
    path: missingPath,
    displayPath: 'M:\\'
  }]);
  
  const server = createServer({ scanRoots });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  // 1. GET /api/roots returns 200 and includes the configured missing root (no preflight existence check).
  const rootsRes = await request(server, 'GET', '/api/roots');
  assert.equal(rootsRes.status, 200);
  const missingRoot = rootsRes.body.roots.find((r) => r.path === missingPath || r.displayPath === 'M:\\');
  assert.ok(missingRoot, 'configured missing root must be listed in /api/roots');
  assert.equal(missingRoot.name, 'Missing');
  assert.equal(missingRoot.displayPath, 'M:\\');

  // 2. Resolve the server-issued root id, then start a scan for it.
  const rootId = missingRoot.id;
  const startRes = await request(server, 'POST', '/api/scans', { rootId });
  assert.equal(startRes.status, 202);
  const scanId = startRes.body.scanId;

  // 3. Poll until status === 'error' and error === 'not_found'.
  let statusRes = null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    statusRes = await request(server, 'GET', `/api/scans/${scanId}/status`);
    if (statusRes.body.status === 'error') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.status, 'error');
  assert.equal(statusRes.body.error, 'not_found');
});

test('HTTP API treemap works during active scan and rejects unknown node selector', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-treemap-live-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  fs.writeFileSync(path.join(base, 'file.txt'), Buffer.alloc(150));

  let releaseWalk;
  const walkGate = new Promise((resolve) => { releaseWalk = resolve; });
  const realReaddir = fs.promises.readdir.bind(fs.promises);
  const gatingFs = {
    lstat: fs.promises.lstat.bind(fs.promises),
    readdir: async (p, opts) => {
      await walkGate;
      return realReaddir(p, opts);
    },
  };

  const roots = [{ id: 'test-root', name: 'Test Root', path: base, displayPath: 'C:\\Test' }];
  const server = createServer({ scanRoots: JSON.stringify(roots), fs: gatingFs });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  const rootsRes = await request(server, 'GET', '/api/roots');
  const rootId = rootsRes.body.roots[0].id;

  const startRes = await request(server, 'POST', '/api/scans', { rootId });
  const scanId = startRes.body.scanId;

  // 1. Request treemap while scan is active (status === 'scanning').
  const treemapRes = await request(server, 'GET', `/api/scans/${scanId}/treemap?node=root`);
  assert.equal(treemapRes.status, 200);
  assert.equal(treemapRes.body.status, 'scanning');
  assert.equal(treemapRes.body.partial, true);

  // 2. Request treemap with invalid/unknown node id -> 404 Node tidak ditemukan.
  const badNodeRes = await request(server, 'GET', `/api/scans/${scanId}/treemap?node=nonexistent-id-12345`);
  assert.equal(badNodeRes.status, 404);
  assert.equal(badNodeRes.body.error, 'Node tidak ditemukan.');

  releaseWalk();
});

test('HTTP API rejects a client-supplied filesystem path as a root selector', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-path-reject-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const roots = [{ id: 'test-root', name: 'Test Root', path: base, displayPath: 'C:\\Test' }];
  const server = createServer({ scanRoots: JSON.stringify(roots) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  // A raw filesystem path must never be accepted in place of a server-issued id.
  for (const rootId of [base, 'C:\\Windows\\System32', '\\\\server\\share']) {
    const res = await request(server, 'POST', '/api/scans', { rootId });
    assert.equal(res.status, 400, `path selector ${rootId} must be rejected`);
    assert.equal(res.body.error, 'Root tidak dikenal.');
  }

  // An arbitrary path used as a tree node selector must also be rejected.
  const rootsRes = await request(server, 'GET', '/api/roots');
  const startRes = await request(server, 'POST', '/api/scans', { rootId: rootsRes.body.roots[0].id });
  assert.equal(startRes.status, 202);
  const scanId = startRes.body.scanId;
  const nodeRes = await request(server, 'GET', `/api/scans/${scanId}/tree/${encodeURIComponent('C:\\Windows\\System32')}`);
  assert.equal(nodeRes.status, 404);
  assert.equal(nodeRes.body.error, 'Node tidak ditemukan.');
});

test('HTTP API rejects cross-origin state-changing request', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-http-origin-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const roots = [{ id: 'test-root', name: 'Test Root', path: base, displayPath: 'C:\\Test' }];
  const server = createServer({ scanRoots: JSON.stringify(roots) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  const res = await request(server, 'POST', '/api/scans', { rootId: 'test-root' }, { origin: 'http://evil.example' });

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'Origin tidak diizinkan.');
});
