'use strict';

const path = require('node:path');
const nodeFs = require('node:fs').promises;
const { resolveRoot, resolveCandidate, isContained, validateCandidate, isLinkLike, toDisplayPath } = require('./safe-path.js');
const { getInternalPath, getDisplayPath } = require('./cleanup-targets.js');

/**
 * Default minimum age enforced by the backend (spec "AGE SAFETY").
 * Files younger than this are skipped even if the target's configured age is lower.
 */
const SERVER_MIN_AGE_HOURS = 24;
const SERVER_MIN_AGE_MS = SERVER_MIN_AGE_HOURS * 60 * 60 * 1000;

/**
 * Protected basenames that must never be deleted even inside an allowlisted root.
 * (spec "BROWSER CACHE" — cookies, history, passwords, etc.)
 */
const PROTECTED_BASENAMES = new Set([
  'Cookies',
  'Cookies-journal',
  'History',
  'History-journal',
  'Login Data',
  'Login Data-journal',
  'Bookmarks',
  'Bookmarks.bak',
  'Preferences',
  'Web Data',
  'Web Data-journal',
  'Local State',
  'Login Data For Account',
  'Sessions',
  'Login Data',
  'Shortcuts',
  'Shortcuts-journal',
  'Visited Links',
  'Top Sites',
  'Top Sites-journal',
  'desktop.ini',
  'thumbs.db',
]);

/**
 * Protected directory basenames that must never be deleted or traversed.
 */
const PROTECTED_DIR_BASENAMES = new Set([
  '.git',
  'node_modules',
  '.svn',
  '.hg',
  '.bzr',
]);

/**
 * Determine if a file is protected by basename.
 * @param {string} basename
 * @returns {boolean}
 */
function isProtectedBasename(basename) {
  return PROTECTED_BASENAMES.has(basename);
}

/**
 * Determine if a directory is protected by basename.
 * @param {string} basename
 * @returns {boolean}
 */
function isProtectedDirBasename(basename) {
  return PROTECTED_DIR_BASENAMES.has(basename);
}

/**
 * Normalize options for the engine.
 * @param {object} opts
 * @returns {object}
 */
function normalizeOptions(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const fsApi = opts.fs || nodeFs;
  const minAgeHours = Math.max(
    SERVER_MIN_AGE_HOURS,
    Number(opts.minAgeHours) || SERVER_MIN_AGE_HOURS,
  );
  return {
    now,
    fsApi,
    minAgeHours,
    minAgeMs: minAgeHours * 60 * 60 * 1000,
    signal: opts.signal,
    onProgress: opts.onProgress || (() => {}),
    maxDepth: opts.maxDepth ?? 50,
  };
}

/**
 * Check if operation should abort.
 * @param {AbortSignal} signal
 * @throws {Error} with name 'AbortError' if aborted.
 */
function checkAbort(signal) {
  if (signal?.aborted) {
    const err = new Error('cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Shared traversal that yields file records for both preview and execute.
 *
 * @param {string} internalPath - Container path for this target.
 * @param {object} options - { now, fsApi, minAgeMs, signal, onProgress, maxDepth }
 * @returns {Promise<{ files: Array<{path:string,size:number,mtimeMs:number}>, dirs: string[], skippedRecent: number, skippedProtected: number, accessDenied: number }>}
 */
async function traverseTarget(internalPath, options) {
  const { now, fsApi, minAgeMs, signal, onProgress, maxDepth } = normalizeOptions(options);
  const startMs = now();
  const rootReal = await resolveRoot(internalPath, fsApi);

  const files = [];
  const dirs = [rootReal]; // root is first; we will not delete it
  let skippedRecent = 0;
  let skippedProtected = 0;
  let accessDenied = 0;

  // Stack for iterative DFS: entries are { path, depth, isDir }
  const stack = [{ path: rootReal, depth: 0, isDir: true }];

  while (stack.length > 0) {
    checkAbort(signal);

    const current = stack.pop();
    if (current.depth > maxDepth) continue;

    let entries;
    try {
      entries = await fsApi.readdir(current.path, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        accessDenied += 1;
      } else if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        // gone or not a dir
      }
      continue;
    }

    for (const dirent of entries) {
      checkAbort(signal);

      const fullPath = path.posix.join(current.path, dirent.name);

      // Symlink / reparse point protection
      if (isLinkLike(dirent)) {
        // We don't follow; we don't count it; we don't delete it.
        continue;
      }

      // Protected directory name — never traverse or delete
      if (dirent.isDirectory() && isProtectedDirBasename(dirent.name)) {
        skippedProtected += 1;
        continue;
      }

      let stat;
      try {
        stat = await fsApi.lstat(fullPath);
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EPERM') {
          accessDenied += 1;
        }
        continue;
      }

      // Re-check link-like after lstat (some fs only expose it here)
      if (isLinkLike(stat)) {
        continue;
      }

      if (stat.isDirectory()) {
        // Validate containment before descending (defense against mount escapes)
        const realDir = await resolveCandidate(fullPath, fsApi);
        if (!realDir || !isContained(realDir, rootReal)) {
          continue;
        }
        dirs.push(realDir);
        stack.push({ path: realDir, depth: current.depth + 1, isDir: true });
        continue;
      }

      if (!stat.isFile()) continue;

      // Age filter
      if (now() - stat.mtimeMs < minAgeMs) {
        skippedRecent += 1;
        continue;
      }

      // Protected file by basename
      if (isProtectedBasename(dirent.name)) {
        skippedProtected += 1;
        continue;
      }

      // Final containment validation before adding to deletable set
      const realFile = await resolveCandidate(fullPath, fsApi);
      if (!realFile || !isContained(realFile, rootReal)) {
        continue;
      }

      files.push({
        path: realFile,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }

    // Progress callback every ~100 files/dirs
    if (onProgress && (files.length + dirs.length) % 100 === 0) {
      onProgress({ filesScanned: files.length, dirsScanned: dirs.length });
    }
  }

  onProgress?.({ filesScanned: files.length, dirsScanned: dirs.length });

  return { files, dirs, skippedRecent, skippedProtected, accessDenied };
}

/**
 * Dry-run preview for a single target.
 * @param {string} targetId
 * @param {object} options
 * @returns {Promise<{ target: object, eligibleFiles: number, eligibleDirectories: number, estimatedBytes: number, skippedRecentFiles: number, skippedProtectedFiles: number }>}
 */
async function previewTarget(targetId, options) {
  const internalPath = getInternalPath(targetId);
  if (!internalPath) {
    throw new Error(`Unknown target: ${targetId}`);
  }
  const { files, dirs, skippedRecent, skippedProtected, accessDenied } =
    await traverseTarget(internalPath, options);

  // eligibleDirectories excludes the root itself
  const eligibleDirectories = Math.max(0, dirs.length - 1);

  let estimatedBytes = 0;
  for (const f of files) estimatedBytes += f.size;

  return {
    targetId,
    eligibleFiles: files.length,
    eligibleDirectories,
    estimatedBytes,
    skippedRecentFiles: skippedRecent,
    skippedProtectedFiles: skippedProtected,
    accessDenied,
  };
}

/**
 * Dry-run preview for multiple targets.
 * @param {string[]} targetIds
 * @param {object} options
 * @returns {Promise<{ targets: Array<object>, totalEligibleFiles: number, totalEligibleDirectories: number, totalEstimatedBytes: number, totalSkippedRecent: number, totalSkippedProtected: number }>}
 */
async function preview(targetIds, options) {
  const results = [];
  let totalEligibleFiles = 0;
  let totalEligibleDirectories = 0;
  let totalEstimatedBytes = 0;
  let totalSkippedRecent = 0;
  let totalSkippedProtected = 0;

  for (const id of targetIds) {
    const res = await previewTarget(id, options);
    results.push(res);
    totalEligibleFiles += res.eligibleFiles;
    totalEligibleDirectories += res.eligibleDirectories;
    totalEstimatedBytes += res.estimatedBytes;
    totalSkippedRecent += res.skippedRecentFiles;
    totalSkippedProtected += res.skippedProtectedFiles;
  }

  return {
    targets: results,
    totalEligibleFiles,
    totalEligibleDirectories,
    totalEstimatedBytes,
    totalSkippedRecent,
    totalSkippedProtected,
  };
}

/**
 * Delete a single file with detailed outcome classification.
 * spec "LOCKED FILE HANDLING": failure never terminates the job.
 *
 * @param {string} filePath
 * @param {object} fsApi
 * @returns {Promise<'deleted'|'skipped_recent'|'skipped_locked'|'access_denied'|'failed'|'protected'>}
 */
async function deleteFile(filePath, fsApi) {
  try {
    await fsApi.unlink(filePath);
    return 'deleted';
  } catch (err) {
    if (err.code === 'ENOENT') return 'skipped_locked'; // gone before we got there
    if (err.code === 'EBUSY' || err.code === 'ETXTBSY' || err.code === 'EACCES' || err.code === 'EPERM') {
      // EBUSY/ETXTBSY on Windows means in-use; EACCES/EPERM is permission
      return err.code === 'EBUSY' || err.code === 'ETXTBSY' ? 'skipped_locked' : 'access_denied';
    }
    return 'failed';
  }
}

/**
 * Remove empty child directories bottom-up.
 * NEVER removes the root itself.
 * @param {string[]} dirs - All directories from traverse (root first).
 * @param {string} rootReal - Real path of root.
 * @param {object} fsApi
 * @returns {Promise<number>} Count of removed directories.
 */
async function removeEmptyDirs(dirs, rootReal, fsApi) {
  let removed = 0;
  // Sort deepest first (longest path first)
  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  for (const dir of sorted) {
    if (dir === rootReal) continue; // never delete root
    try {
      await fsApi.rmdir(dir);
      removed += 1;
    } catch (err) {
      if (err.code === 'ENOTEMPTY' || err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EPERM') {
        // Expected: not empty, already gone, or no permission
      }
    }
  }
  return removed;
}

/**
 * Execute cleanup for a single target.
 * @param {string} targetId
 * @param {object} options
 * @returns {Promise<{ targetId: string, filesDeleted: number, bytesDeleted: number, directoriesDeleted: number, skippedRecent: number, skippedLocked: number, accessDenied: number, failed: number, protected: number, durationMs: number }>}
 */
async function executeTarget(targetId, options) {
  const internalPath = getInternalPath(targetId);
  if (!internalPath) {
    throw new Error(`Unknown target: ${targetId}`);
  }
  const { now, fsApi, minAgeMs, signal, onProgress, maxDepth } = normalizeOptions(options);
  const startMs = now();
  const rootReal = await resolveRoot(internalPath, fsApi);

  let filesDeleted = 0;
  let bytesDeleted = 0;
  let skippedRecent = 0;
  let skippedLocked = 0;
  let accessDenied = 0;
  let failed = 0;
  let protectedCount = 0;

  const stack = [{ path: rootReal, depth: 0, isDir: true }];
  const allDirs = [rootReal];

  while (stack.length > 0) {
    checkAbort(signal);

    const current = stack.pop();
    if (current.depth > maxDepth) continue;

    let entries;
    try {
      entries = await fsApi.readdir(current.path, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'EACCES' || err.code === 'EPERM') accessDenied += 1;
      continue;
    }

    for (const dirent of entries) {
      checkAbort(signal);

      const fullPath = path.posix.join(current.path, dirent.name);

      // Symlink / reparse point protection
      if (isLinkLike(dirent)) continue;

      // Protected directory
      if (dirent.isDirectory() && isProtectedDirBasename(dirent.name)) {
        protectedCount += 1;
        continue;
      }

      let stat;
      try {
        stat = await fsApi.lstat(fullPath);
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EPERM') accessDenied += 1;
        continue;
      }

      if (isLinkLike(stat)) continue;

      if (stat.isDirectory()) {
        const realDir = await resolveCandidate(fullPath, fsApi);
        if (!realDir || !isContained(realDir, rootReal)) continue;
        allDirs.push(realDir);
        stack.push({ path: realDir, depth: current.depth + 1, isDir: true });
        continue;
      }

      if (!stat.isFile()) continue;

      // Age filter
      if (now() - stat.mtimeMs < minAgeMs) {
        skippedRecent += 1;
        continue;
      }

      // Protected file by basename
      if (isProtectedBasename(dirent.name)) {
        protectedCount += 1;
        continue;
      }

      // Final containment check before deletion
      const realFile = await resolveCandidate(fullPath, fsApi);
      if (!realFile || !isContained(realFile, rootReal)) continue;

      const outcome = await deleteFile(realFile, fsApi);
      switch (outcome) {
        case 'deleted':
          filesDeleted += 1;
          bytesDeleted += stat.size;
          break;
        case 'skipped_locked':
          skippedLocked += 1;
          break;
        case 'access_denied':
          accessDenied += 1;
          break;
        case 'failed':
          failed += 1;
          break;
        default:
          // skipped_recent (shouldn't happen here) or protected
          break;
      }
    }

    if (onProgress && filesDeleted % 50 === 0) {
      onProgress({ filesDeleted, bytesDeleted });
    }
  }

  // Remove empty child directories
  const directoriesDeleted = await removeEmptyDirs(allDirs, rootReal, fsApi);

  const durationMs = now() - startMs;

  return {
    targetId,
    filesDeleted,
    bytesDeleted,
    directoriesDeleted,
    skippedRecent,
    skippedLocked,
    accessDenied,
    failed,
    protected: protectedCount,
    durationMs,
  };
}

/**
 * Execute cleanup for multiple targets sequentially.
 * @param {string[]} targetIds
 * @param {object} options
 * @returns {Promise<{ results: Array<object>, totals: object }>}
 */
async function execute(targetIds, options) {
  const results = [];
  const totals = {
    filesDeleted: 0,
    bytesDeleted: 0,
    directoriesDeleted: 0,
    skippedRecent: 0,
    skippedLocked: 0,
    accessDenied: 0,
    failed: 0,
    protected: 0,
    durationMs: 0,
  };

  for (const id of targetIds) {
    checkAbort(options?.signal);
    const res = await executeTarget(id, options);
    results.push(res);
    totals.filesDeleted += res.filesDeleted;
    totals.bytesDeleted += res.bytesDeleted;
    totals.directoriesDeleted += res.directoriesDeleted;
    totals.skippedRecent += res.skippedRecent;
    totals.skippedLocked += res.skippedLocked;
    totals.accessDenied += res.accessDenied;
    totals.failed += res.failed;
    totals.protected += res.protected;
  }
  totals.durationMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  return { results, totals };
}

/**
 * Human-readable byte format for audit logs.
 * @param {number} bytes
 * @returns {string}
 */
function sizeHuman(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${v} ${units[i]}` : `${v.toFixed(1)} ${units[i]}`;
}

module.exports = {
  traverseTarget,
  preview,
  previewTarget,
  execute,
  executeTarget,
  deleteFile,
  removeEmptyDirs,
  sizeHuman,
  SERVER_MIN_AGE_HOURS,
  SERVER_MIN_AGE_MS,
  PROTECTED_BASENAMES,
  PROTECTED_DIR_BASENAMES,
  isProtectedBasename,
  isProtectedDirBasename,
  normalizeOptions,
};