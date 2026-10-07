'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { analyze, percentOf, makeDisplayMapper } = require('../lib/analyzer.js');
const { NodeRegistry, nodeId } = require('../lib/tree-registry.js');
const { classify } = require('../lib/classifier.js');

function writeTree(root, files) {
  for (const [rel, size] of files) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.alloc(size));
  }
}

test('walkDir aggregates recursively and classifies display paths', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-walk-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  writeTree(base, [
    ['A/a1.bin', 3000],
    ['A/deep/a2.log', 1000],
    ['B/b1.txt', 500],
    ['root.md', 100],
  ]);

  const result = await analyze(base, { timeoutMs: 30000 });
  assert.equal(result.totals.sizeBytes, 4600);
  assert.equal(result.totals.fileCount, 4);
  assert.equal(result.partial, false);
  assert.equal(result.cancelled, false);

  const byName = Object.fromEntries(result.root.children.map((c) => [c.name, c]));
  assert.equal(byName.A.sizeBytes, 4000);
  assert.equal(byName.A.fileCount, 2);
  assert.equal(byName.A.subfolderCount, 1);

  // Extension summary ordered by size desc.
  assert.deepEqual(result.extensions.map((r) => r.extension), ['.bin', '.log', '.txt', '.md']);
});

test('analyze reports zero totals for an empty root', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-empty-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const result = await analyze(base, { timeoutMs: 30000 });
  assert.equal(result.totals.sizeBytes, 0);
  assert.equal(result.totals.fileCount, 0);
  assert.equal(result.partial, false);
  assert.deepEqual(result.root.children, []);
});

test('analyze rejects a missing root with ENOENT', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-missing-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const missing = path.join(base, 'does-not-exist');

  // Baseline behavior: analyze() rejects at the root lstat with ENOENT.
  // server.js lines 183-187 maps that rejection to session error 'not_found';
  // this unit test intentionally characterizes analyze(), not the server.
  await assert.rejects(analyze(missing, { timeoutMs: 30000 }), (error) => {
    assert.equal(error.code, 'ENOENT');
    return true;
  });
});

test('analyze maps real mount paths onto Windows display paths', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-map-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  writeTree(base, [[path.join('Users', 'x', 'AppData', 'Local', 'Temp', 'a.tmp'), 64]]);

  const result = await analyze(base, { displayRoot: 'C:\\', timeoutMs: 30000 });
  assert.equal(result.root.displayPath, 'C:\\');
  assert.match(result.root.children[0].displayPath, /^C:\\Users/);
  assert.ok(!result.root.displayPath.includes('/mnt'));

  const tempNode = result.root.children[0].children[0].children[0].children[0].children[0];
  assert.match(tempNode.displayPath, /AppData\\Local\\Temp$/);
  assert.equal(classify(tempNode.displayPath).risk, 'safe-cache');
});

test('makeDisplayMapper joins relative segments with backslashes', () => {
  const map = makeDisplayMapper('/mnt/c', 'C:\\');
  assert.equal(map('/mnt/c'), 'C:\\');
  assert.equal(map('/mnt/c/Users/x'), 'C:\\Users\\x');
  // Paths outside the mapped root fall back to a plain display path.
  assert.ok(!map('/elsewhere').startsWith('C:'));
});

test('analyze is cancelled via AbortSignal and marks partial', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-cancel-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  writeTree(base, [
    ['A/1.bin', 10],
    ['B/2.bin', 10],
  ]);

  const controller = new AbortController();
  controller.abort();
  const result = await analyze(base, { signal: controller.signal, timeoutMs: 30000 });
  assert.equal(result.cancelled, true);
  assert.equal(result.partial, true);
});

test('analyze times out and marks the root partial', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-timeout-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  writeTree(base, [['a.bin', 8]]);

  let nowValue = 1000;
  const result = await analyze(base, {
    timeoutMs: 10,
    now: () => nowValue,
    onProgress: () => { nowValue += 100; },
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.partial, true);
});

test('symlinks are skipped, never followed', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-link-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  writeTree(base, [
    ['real/inner.bin', 500],
  ]);
  try {
    fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), 'dir');
  } catch {
    t.skip('symlinks not permitted in this environment');
    return;
  }

  const result = await analyze(base, { timeoutMs: 30000 });
  assert.equal(result.totals.sizeBytes, 500);
  assert.ok(!result.root.children.some((c) => c.name === 'link'));
});

test('a hanging filesystem call cannot outlive the deadline', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-hang-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  writeTree(base, [['a.bin', 8]]);

  // readdir never resolves; only the deadline race should let analyze finish.
  const hangingFs = {
    lstat: fs.promises.lstat.bind(fs.promises),
    readdir: () => new Promise(() => {}),
  };

  let nowValue = 0;
  const result = await analyze(base, {
    fs: hangingFs,
    timeoutMs: 25,
    now: () => (nowValue += 30),
  });
  assert.equal(result.partial, true);
  assert.equal(result.root.reason, 'timeout');
});

test('a hanging filesystem call is released immediately on abort', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-hang-abort-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  writeTree(base, [['a.bin', 8]]);

  const controller = new AbortController();
  const hangingFs = {
    lstat: fs.promises.lstat.bind(fs.promises),
    readdir: () => new Promise(() => {}),
  };
  setTimeout(() => controller.abort(), 20);

  const started = Date.now();
  const result = await analyze(base, {
    fs: hangingFs,
    signal: controller.signal,
    timeoutMs: 60000,
  });
  assert.ok(Date.now() - started < 5000, 'abort must not wait for the hung call');
  assert.equal(result.cancelled, true);
  assert.equal(result.root.reason, 'aborted');
});

test('percentOf rounds to one decimal and guards zero totals', () => {
  assert.equal(percentOf(3000, 4600), 65.2);
  assert.equal(percentOf(5, 0), 0);
});

test('node registry issues stable opaque ids resolved by id only', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-reg-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  writeTree(base, [['A/deep/x.bin', 7]]);

  const result = await analyze(base, { timeoutMs: 30000 });
  const registry = new NodeRegistry();
  const walk = (node) => {
    registry.register(node);
    for (const child of node.children || []) walk(child);
  };
  walk(result.root);

  assert.equal(registry.size, 4);
  const child = result.root.children[0];
  assert.equal(registry.get(child.id), child);
  assert.equal(registry.get('nope'), null);
  assert.equal(nodeId('same'), nodeId('same'));
  assert.notEqual(nodeId('a'), nodeId('b'));
});

test('progressive: completed sibling is visible in the live root before others finish', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-live-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  // Layout: root/{fast.txt, slow/slow.txt}. The slow sibling's readdir hangs
  // until released, while the fast file completes immediately.
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
      // Deterministic order: files (fast.txt) before the gated dir (slow).
      return [...entries].sort((a, b) => a.name.localeCompare(b.name));
    },
  };

  let liveRoot = null;
  let sawFastInLiveTree = false;
  let resolveFast = null;
  const fastAttached = new Promise((resolve) => { resolveFast = resolve; });
  const done = analyze(base, {
    fs: gatingFs,
    timeoutMs: 30000,
    concurrency: 1, // Serialize: fast.txt attaches before slow blocks the walk.
    onRoot: (root) => { liveRoot = root; },
    onChild: (parent, child) => {
      if (child && child.name === 'fast.txt') {
        if (liveRoot && liveRoot.children.some((c) => c.name === 'fast.txt')) {
          sawFastInLiveTree = true;
        }
        resolveFast();
      }
    },
  });

  // Wait until the fast sibling attaches while slow is still gated.
  await Promise.race([
    fastAttached,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for fast.txt')), 5000)),
  ]);
  assert.ok(liveRoot, 'root must be published before the scan finishes');
  assert.ok(
    liveRoot.children.some((c) => c.name === 'fast.txt'),
    `completed sibling must be attached live; got [${liveRoot.children.map((c) => c.name)}]`,
  );
  assert.ok(sawFastInLiveTree, 'onChild must fire as children complete');

  releaseSlow();
  const result = await done;
  assert.equal(result.totals.sizeBytes, 300);
  assert.equal(result.partial, false);
});

test('permission errors on a child directory are skipped and mark the subtree access_denied', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dua-perm-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(path.join(base, 'ok.txt'), Buffer.alloc(42));
  fs.mkdirSync(path.join(base, 'denied'), { recursive: true });

  // Characterization of baseline behavior (lib/analyzer.js walkDir catch, ~L139):
  // a readdir that reports EACCES/EPERM marks that node partial with
  // reason 'access_denied', counts one skip, and the walk continues.
  for (const code of ['EACCES', 'EPERM']) {
    const realReaddir = fs.promises.readdir.bind(fs.promises);
    const deniedFs = {
      lstat: fs.promises.lstat.bind(fs.promises),
      readdir: async (p, opts) => {
        if (String(p).endsWith(`${path.sep}denied`)) {
          throw Object.assign(new Error(`${code}: permission denied`), { code });
        }
        return realReaddir(p, opts);
      },
    };

    const result = await analyze(base, { fs: deniedFs, timeoutMs: 30000 });

    // The unreadable entry is published as a partial node whose contents were skipped.
    const denied = result.root.children.find((c) => c.name === 'denied');
    assert.ok(denied, `${code}: denied entry must be published as a node`);
    assert.equal(denied.partial, true, `${code}: denied subtree is partial`);
    assert.equal(denied.reason, 'access_denied', `${code}: denied subtree reason`);
    assert.equal(denied.children.length, 0, `${code}: denied contents must not be read`);

    // The readable sibling still aggregates and the scan completes without crashing.
    assert.ok(result.root.children.some((c) => c.name === 'ok.txt'), `${code}: readable sibling remains`);
    assert.equal(result.totals.sizeBytes, 42, `${code}: readable bytes still counted`);
    assert.equal(result.totals.fileCount, 1, `${code}: readable files still counted`);

    // The access error propagates partial/access_denied to the root and counts one skip.
    assert.equal(result.partial, true, `${code}: scan is partial`);
    assert.equal(result.root.reason, 'access_denied', `${code}: root reason`);
    assert.equal(result.skipped, 1, `${code}: exactly one entry skipped`);
  }
});

test('progressive: hung root lstat still produces a partial tree instead of hanging', async (t) => {
  const hangingFs = {
    lstat: () => new Promise(() => {}),
    readdir: () => new Promise(() => {}),
  };
  let rootSeen = null;
  const result = await analyze('/hung/root', {
    fs: hangingFs,
    timeoutMs: 50,
    now: (() => { let n = 0; return () => (n += 100); })(),
    onRoot: (root) => { rootSeen = root; },
  });
  assert.equal(result.partial, true);
  assert.equal(result.timedOut, true);
  assert.ok(rootSeen && rootSeen.partial, 'empty partial root must still be published');
});
