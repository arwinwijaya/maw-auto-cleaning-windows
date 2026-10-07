'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { createServer } = require('../server.js');

function request(server, method, pathname, body = null) {
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
