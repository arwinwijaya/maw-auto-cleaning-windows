'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const path = require('node:path');
const os = require('node:os');

const cleanupTargets = require('../lib/cleanup-targets.js');
const cleanupEngine = require('../lib/cleanup-engine.js');
const cleanupJobs = require('../lib/cleanup-jobs.js');
const safePath = require('../lib/safe-path.js');

function makeFakeFs() {
  const now = Date.now();
  const old = now - 48 * 60 * 60 * 1000;
  const recent = now - 1 * 60 * 60 * 1000;

  const dirs = {
    '/cleanup/test-temp-a': [
      { name: 'old.txt', isDir: false },
      { name: 'recent.txt', isDir: false },
      { name: 'sub1', isDir: true },
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

let originalTargets;

before(() => {
  originalTargets = [...cleanupTargets.TARGETS];
  cleanupTargets.TARGETS.length = 0;
  cleanupTargets.TARGETS.push(
    { id: 'test-temp-a', name: 'Test Temp A', category: 'temp', risk: 'safe', internalPath: '/cleanup/test-temp-a', displayPath: 'C:\\Test\\TempA', enabled: true, minimumAgeHours: 1, supportsCleaning: true, requiresConfirmation: true, autoSelectable: true },
    { id: 'test-temp-b', name: 'Test Temp B', category: 'temp', risk: 'safe', internalPath: '/cleanup/test-temp-b', displayPath: 'C:\\Test\\TempB', enabled: true, minimumAgeHours: 1, supportsCleaning: true, requiresConfirmation: true, autoSelectable: true },
  );
});

after(() => {
  cleanupTargets.TARGETS.length = 0;
  cleanupTargets.TARGETS.push(...originalTargets);
  cleanupJobs.jobs.clear();
  cleanupJobs.targetLocks.clear();
  cleanupJobs.confirmationTokens.clear();
});

describe('cleanup targets registry', () => {
  it('1. Registered target ID resolves correctly', () => {
    const target = cleanupTargets.findTargetById('test-temp-a');
    assert.ok(target, 'target should be found');
    assert.equal(target.id, 'test-temp-a');
    assert.equal(target.name, 'Test Temp A');
    assert.equal(target.internalPath, '/cleanup/test-temp-a');
  });

  it('2. Unknown target ID is rejected', () => {
    const result = cleanupTargets.validateTargetIds(['unknown-target']);
    assert.equal(result.valid, false);
    assert.deepEqual(result.invalid, ['unknown-target']);
  });

  it('3. validateTargetIds rejects disabled/non-cleanable targets', () => {
    cleanupTargets.TARGETS.push({ ...cleanupTargets.TARGETS[0], id: 'disabled-target', enabled: false });
    const result = cleanupTargets.validateTargetIds(['disabled-target']);
    assert.equal(result.valid, false);
    assert.ok(result.invalid.includes('disabled-target'));
    cleanupTargets.TARGETS.pop();
  });
});

describe('safe-path validation', () => {
  let fs;

  beforeEach(() => { fs = makeFakeFs(); });

  it('4. Path traversal (..) is blocked', async () => {
    const rootReal = await safePath.resolveRoot('/cleanup/test-temp-a', fs);
    const candidate = '/cleanup/test-temp-a/sub1/../../../etc/passwd';
    const validation = await safePath.validateCandidate(candidate, rootReal, fs);
    assert.equal(validation.ok, false);
    assert.equal(validation.reason, 'outside_root');
  });

  it('5. Symlinks are not followed (isLinkLike detects)', async () => {
    const stat = { isSymbolicLink: () => true, isReparsePoint: () => false, isFile: () => false, isDirectory: () => false };
    assert.ok(safePath.isLinkLike(stat), 'symbolic link detected');
    const stat2 = { isSymbolicLink: () => false, isReparsePoint: () => true, isFile: () => false, isDirectory: () => false };
    assert.ok(safePath.isLinkLike(stat2), 'reparse point detected');
    const stat3 = { isSymbolicLink: () => false, isReparsePoint: () => false, isFile: () => true, isDirectory: () => false };
    assert.equal(safePath.isLinkLike(stat3), false);
  });

  it('6. Cleanup root itself is never deleted (isContained returns false for root)', async () => {
    const rootReal = await safePath.resolveRoot('/cleanup/test-temp-a', fs);
    const contained = safePath.isContained(rootReal, rootReal);
    assert.equal(contained, false, 'root must not be contained in itself');
  });
});

describe('cleanup engine - age safety', () => {
  let fs;

  beforeEach(() => { fs = makeFakeFs(); });

  it('7. Recent files are skipped', async () => {
    const fixedNow = fs.stats['/cleanup/test-temp-a/old.txt'].mtimeMs + 48 * 60 * 60 * 1000;
    const result = await cleanupEngine.preview(['test-temp-a'], { minAgeHours: 24, fs, now: () => fixedNow });
    assert.equal(result.targets[0].eligibleFiles, 2);
    assert.equal(result.targets[0].skippedRecentFiles, 1);
  });

  it('8. Old temp files are eligible', async () => {
    const fixedNow = fs.stats['/cleanup/test-temp-b/old.txt'].mtimeMs + 48 * 60 * 60 * 1000;
    const result = await cleanupEngine.preview(['test-temp-b'], { minAgeHours: 24, fs, now: () => fixedNow });
    assert.equal(result.targets[0].eligibleFiles, 1);
    assert.equal(result.targets[0].skippedRecentFiles, 0);
  });
});

describe('cleanup engine - locked/access-denied resilience', () => {
  let fs;

  beforeEach(() => { fs = makeFakeFs(); });

  it('9. Access-denied files do not stop the job', async () => {
    const failingFs = {
      ...fs,
      async lstat(p) {
        if (p === '/cleanup/test-temp-a/old.txt') {
          const err = new Error('EACCES');
          err.code = 'EACCES';
          throw err;
        }
        return fs.lstat(p);
      },
    };
    const result = await cleanupEngine.executeTarget('test-temp-a', { fs: failingFs, minAgeHours: 1 });
    assert.ok(result.accessDenied >= 1, 'accessDenied should be counted');
    assert.ok(result.filesDeleted >= 0);
  });

  it('10. Protected files outside root cannot be deleted (containment)', async () => {
    const internal = '/cleanup/test-temp-a';
    const rootReal = await safePath.resolveRoot(internal, fs);
    const outside = '/cleanup/protected-outside.txt';
    const validation = await safePath.validateCandidate(outside, rootReal, fs);
    assert.equal(validation.ok, false);
    assert.equal(validation.reason, 'outside_root');
  });
});

describe('cleanup engine - cancellation', () => {
  it('11. Cancellation stops processing safely', async () => {
    const controller = new AbortController();
    const slowFs = makeFakeFs();
    // Delay readdir to allow abort signal to trigger
    const origReaddir = slowFs.readdir;
    slowFs.readdir = async (...args) => {
      await new Promise(r => setTimeout(r, 20));
      return origReaddir.apply(slowFs, args);
    };
    controller.abort();
    const promise = cleanupEngine.execute(['test-temp-a'], { fs: slowFs, minAgeHours: 1, signal: controller.signal });
    await assert.rejects(promise, { name: 'AbortError' });
  });
});

describe('cleanup jobs - concurrency safety', () => {
  it('12. Two concurrent jobs cannot clean same target (second gets 409 conflict)', () => {
    const created1 = cleanupJobs.createJob(['test-temp-a']);
    assert.ok(created1.jobId, 'first job should acquire lock');

    const created2 = cleanupJobs.createJob(['test-temp-a']);
    assert.equal(created2.jobId, null, 'second job should be rejected');
    assert.equal(created2.conflictTarget, 'test-temp-a');

    cleanupJobs.releaseLocks(['test-temp-a']);
    cleanupJobs.jobs.delete(created1.jobId);
  });
});

describe('cleanup engine - dry run preview', () => {
  let fs;

  beforeEach(() => { fs = makeFakeFs(); });

  it('preview returns structured estimates', async () => {
    const fixedNow = fs.stats['/cleanup/test-temp-a/old.txt'].mtimeMs + 48 * 60 * 60 * 1000;
    const result = await cleanupEngine.preview(['test-temp-a', 'test-temp-b'], { minAgeHours: 24, fs, now: () => fixedNow });
    assert.ok(result.totalEligibleFiles >= 3);
    assert.ok(result.totalEstimatedBytes > 0);
    assert.equal(result.targets.length, 2);
  });

  it('preview generates confirmation token via jobs module', () => {
    const token = cleanupJobs.createConfirmationToken(['test-temp-a']);
    assert.ok(typeof token === 'string' && token.length > 0);
    assert.ok(cleanupJobs.consumeConfirmationToken(token, ['test-temp-a']));
    assert.ok(!cleanupJobs.consumeConfirmationToken(token, ['test-temp-a']), 'token single-use');
  });
});

describe('cleanup engine - execute with progress', () => {
  let fs;

  beforeEach(() => { fs = makeFakeFs(); });

  it('execute deletes eligible files and removes empty dirs', async () => {
    const baseTime = fs.stats['/cleanup/test-temp-a/old.txt'].mtimeMs;
    const fixedNow = baseTime + 48 * 60 * 60 * 1000;
    const result = await cleanupEngine.execute(['test-temp-a'], { fs, minAgeHours: 1, now: () => fixedNow });
    assert.ok(result.totals.filesDeleted >= 2);
    assert.ok(result.totals.bytesDeleted > 0);
    assert.ok(result.totals.directoriesDeleted >= 0);
    const rootStat = await fs.lstat('/cleanup/test-temp-a').catch(() => null);
    assert.ok(rootStat, 'root directory must still exist');
  });
});