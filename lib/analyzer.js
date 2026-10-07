'use strict';

const fsPromises = require('node:fs').promises;
const path = require('node:path');
const { mapLimit } = require('./concurrency.js');
const { nodeId, NodeRegistry } = require('./tree-registry.js');
const { classify } = require('./classifier.js');

const DEFAULT_SCAN_TIMEOUT_MS = 10 * 60_000;

/**
 * @typedef {object} ScanNode
 * @property {string} id           Stable hash id issued by the registry.
 * @property {string} name         Basename for display.
 * @property {string} path         Real path readable by the process.
 * @property {string} displayPath  Human-facing path (Windows separators).
 * @property {'dir'|'file'} type
 * @property {number} sizeBytes    Recursive size (dirs) or file size (files).
 * @property {number} fileCount    Recursive file count.
 * @property {number} subfolderCount Recursive subfolder count.
 * @property {number} directFileCount
 * @property {number} directSubfolderCount
 * @property {number} items        Direct children count (files + folders).
 * @property {number} lastModified Epoch ms of newest entry in the subtree.
 * @property {boolean} partial     True when the subtree could not be read fully.
 * @property {string} [risk]
 * @property {string} [category]
 * @property {string|null} [guideId]
 * @property {string} [reason]
 */

function toDisplayPath(value) {
  return String(value).replace(/\//g, '\\');
}

/**
 * Build a mapper from real (container) paths to human-facing display paths.
 *
 * In Docker the process reads `C:\` through a `/mnt/c` bind mount, so the raw
 * paths are `/mnt/c/Users/...`. The UI and the classifier must keep working with
 * the real Windows paths (`C:\Users\...`), otherwise display is wrong and every
 * Windows classification rule misses.
 *
 * @param {string} realRoot
 * @param {string} displayRoot
 * @returns {(realPath: string) => string}
 */
function makeDisplayMapper(realRoot, displayRoot) {
  const real = path.resolve(realRoot);
  const display = String(displayRoot || toDisplayPath(realRoot));
  return (realPath) => {
    const resolved = path.resolve(realPath);
    if (resolved === real) return display;
    const relative = path.relative(real, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return toDisplayPath(resolved);
    }
    const sep = display.endsWith('\\') || display.endsWith('/') ? '' : '\\';
    return display + sep + toDisplayPath(relative);
  };
}

function resolveTimeoutMs(options = {}) {
  if (options.timeoutMs) return Number(options.timeoutMs);
  const fromEnv = Number(process.env.SCAN_TIMEOUT_MS);
  return fromEnv > 0 ? fromEnv : DEFAULT_SCAN_TIMEOUT_MS;
}

function isAborted(signal) {
  return Boolean(signal && signal.aborted);
}

function isAccessDenied(code) {
  return code === 'EACCES' || code === 'EPERM';
}

function isNotFound(code) {
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Recursively size a directory into a ScanNode.
 *
 * Symlinks, junctions and other reparse points are skipped entirely (never
 * followed), which also guarantees the walk terminates on cyclic trees. A
 * subtree that hits the global deadline is marked `partial` and its numbers are
 * a lower bound.
 *
 * @param {string} dirPath
 * @param {object} ctx
 * @returns {Promise<ScanNode>}
 */
async function walkDir(dirPath, ctx) {
  const { fs, signal, deadline, toDisplay, registry, onNode, onChild } = ctx;
  const node = {
    id: nodeId(dirPath),
    name: path.basename(dirPath) || dirPath,
    path: dirPath,
    displayPath: toDisplay(dirPath),
    type: 'dir',
    sizeBytes: 0,
    fileCount: 0,
    subfolderCount: 0,
    directFileCount: 0,
    directSubfolderCount: 0,
    items: 0,
    lastModified: 0,
    partial: false,
    children: [],
  };

  if (registry) registry.register(node);
  if (onNode) onNode(node);

  if (isAborted(signal)) {
    node.partial = true;
    node.reason = 'cancelled';
    return node;
  }
  if (deadline.expired()) {
    node.partial = true;
    node.reason = 'timeout';
    return node;
  }

  let entries;
  try {
    const winner = await Promise.race([
      fs.readdir(dirPath, { withFileTypes: true }).then((res) => ({ ok: res })),
      ctx.deadlinePromise,
    ]);
    if (winner.reason) {
      node.partial = true;
      node.reason = winner.reason;
      return node;
    }
    entries = winner.ok;
  } catch (error) {
    node.partial = true;
    node.reason = isAccessDenied(error.code) ? 'access_denied'
      : isNotFound(error.code) ? 'not_found'
        : (error.code || 'scan_error');
    ctx.skipped += 1;
    return node;
  }

  const attach = (child) => {
    if (!child) return;
    node.children.push(child);
    node.sizeBytes += child.sizeBytes;
    node.fileCount += child.fileCount;
    node.lastModified = Math.max(node.lastModified, child.lastModified);
    if (child.type === 'dir') {
      node.subfolderCount += 1 + child.subfolderCount;
      node.directSubfolderCount += 1;
      if (child.partial) {
        node.partial = true;
        node.reason = node.reason || child.reason;
      }
    } else {
      node.directFileCount += 1;
    }
    node.items = node.children.length;
  };

  // IMPORTANT: mapLimit returns values but does NOT mutate; attach each
  // completed child to the live parent as it finishes so scans are
  // progressively readable via session.liveRoot.
  await mapLimit(entries, ctx.concurrency, async (dirent) => {
    if (isAborted(signal) || deadline.expired()) return null;
    const fullPath = path.join(dirPath, dirent.name);

    if (typeof dirent.isSymbolicLink === 'function' && dirent.isSymbolicLink()) {
      return null;
    }

    let stat;
    let statWinner = null;
    try {
      statWinner = await Promise.race([
        fs.lstat(fullPath).then((res) => ({ ok: res })),
        ctx.deadlinePromise,
      ]);
      if (statWinner.reason) {
        // Child lstat timed out or was aborted → parent is partial.
        node.partial = true;
        node.reason = node.reason || statWinner.reason;
        return null;
      }
      stat = statWinner.ok;
    } catch {
      ctx.skipped += 1;
      return null;
    }
    if (stat.isSymbolicLink()) return null;
    if (typeof stat.isReparsePoint === 'function' && stat.isReparsePoint()) return null;

    if (stat.isDirectory()) {
      const child = await walkDir(fullPath, ctx);
      if (!child) return null;
      // walkDir registers directory nodes when first created.
      attach(child);
      if (onChild) onChild(node, child);
      return child;
    }
    if (stat.isFile()) {
      ctx.files += 1;
      ctx.bytes += stat.size;
      ctx.extensions.set(
        extensionOf(dirent.name),
        (ctx.extensions.get(extensionOf(dirent.name)) || 0) + stat.size,
      );
      ctx.extensionFiles.set(
        extensionOf(dirent.name),
        (ctx.extensionFiles.get(extensionOf(dirent.name)) || 0) + 1,
      );
      ctx.maybeProgress(fullPath);
      const child = {
        id: nodeId(fullPath),
        name: dirent.name,
        path: fullPath,
        displayPath: toDisplay(fullPath),
        type: 'file',
        sizeBytes: stat.size,
        fileCount: 1,
        subfolderCount: 0,
        directFileCount: 0,
        directSubfolderCount: 0,
        items: 0,
        lastModified: Number(stat.mtimeMs) || 0,
        partial: false,
      };
      if (registry) registry.register(child);
      attach(child);
      if (onChild) onChild(node, child);
      return child;
    }
    return null;
  });

  if (deadline.expired() && !node.partial) {
    node.partial = true;
    node.reason = 'timeout';
  }

  const meta = classify(node.displayPath);
  node.risk = meta.risk;
  node.category = meta.category;
  node.guideId = meta.guideId;
  node.classificationReason = meta.reason;
  ctx.dirs += 1;
  ctx.maybeProgress(dirPath);
  return node;
}

const EXTENSIONLESS = '(tanpa ekstensi)';

function extensionOf(fileName) {
  const name = String(fileName);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return EXTENSIONLESS;
  return name.slice(dot).toLowerCase();
}

function makeDeadline(startedAt, timeoutMs, now) {
  return {
    expired() {
      return now() - startedAt >= timeoutMs;
    },
    remaining() {
      return timeoutMs - (now() - startedAt);
    },
  };
}

/**
 * Creates a single promise that resolves when the abort signal fires or the
 * global timeout elapses. Every filesystem call races against this shared
 * promise, so a hanging readdir/lstat cannot keep the scan alive past the
 * deadline. The timer is cleared and the listener removed via `dispose` (use
 * `finally` so it always runs).
 */
function createDeadlinePromise(startedAt, timeoutMs, signal, now) {
  let settle = null;
  let timer = null;
  let onAbort = null;
  const promise = new Promise((resolve) => {
    let done = false;
    settle = (reason) => {
      if (done) return;
      done = true;
      resolve({ reason });
    };
    if (signal) {
      if (signal.aborted) settle('aborted');
      else {
        onAbort = () => settle('aborted');
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
    const check = () => {
      if (done) return;
      if (now() - startedAt >= timeoutMs) settle('timeout');
      else timer = setTimeout(check, 50);
    };
    check();
  });
  return {
    promise,
    dispose() {
      if (timer) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Fully analyze one root directory. Options `onRoot`/`onChild` callbacks make
 * the tree usable progressively: the root is published when created and each
 * child attaches to its parent as soon as it completes, so a caller can serve
 * the live tree while the walk continues.
 *
 * @param {string} rootPath  Real path readable by the process.
 * @param {object} [options]
 * @param {object} [options.fs]            fs.promises-like API (injectable for tests).
 * @param {AbortSignal} [options.signal]   Cancellation.
 * @param {number} [options.timeoutMs]     Global budget.
 * @param {number} [options.concurrency]   Max parallel directory reads.
 * @param {() => number} [options.now]     Clock (injectable for tests).
 * @param {(p: object) => void} [options.onProgress]
 * @param {(root: object) => void} [options.onRoot]
 * @param {(parent: object, child: object) => void} [options.onChild]
 * @returns {Promise<object>}
 */
async function analyze(rootPath, options = {}) {
  const fs = options.fs || fsPromises;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const startedAt = now();
  const timeoutMs = resolveTimeoutMs(options);
  const signal = options.signal || null;
  const toDisplay = typeof options.toDisplay === 'function'
    ? options.toDisplay
    : (typeof options.displayRoot === 'string' ? makeDisplayMapper(rootPath, options.displayRoot) : toDisplayPath);

  let lastProgress = 0;
  const registry = options.registry || new NodeRegistry();
  const deadlineObj = createDeadlinePromise(startedAt, timeoutMs, signal, now);
  const ctx = {
    fs,
    signal,
    deadline: makeDeadline(startedAt, timeoutMs, now),
    deadlinePromise: deadlineObj.promise,
    toDisplay,
    concurrency: options.concurrency || 16,
    registry,
    onNode: (node) => {
      if (node.path === rootPath && typeof options.onRoot === 'function') options.onRoot(node);
    },
    onChild: options.onChild,
    dirs: 0,
    files: 0,
    bytes: 0,
    skipped: 0,
    extensions: new Map(),
    extensionFiles: new Map(),
    maybeProgress(currentPath) {
      if (typeof options.onProgress !== 'function') return;
      const stamp = now();
      if (stamp - lastProgress < 120 && !isAborted(signal)) return;
      lastProgress = stamp;
      options.onProgress({
        dirsScanned: ctx.dirs,
        filesScanned: ctx.files,
        bytesScanned: ctx.bytes,
        currentPath: ctx.toDisplay(currentPath),
      });
    },
  };

  try {
    const rootWinner = await Promise.race([
      fs.lstat(rootPath).then((res) => ({ ok: res })),
      deadlineObj.promise,
    ]);
    if (rootWinner.reason) {
      // A hung root lstat must not block cancellation; return an empty
      // partial tree rather than throwing.
      const aborted = isAborted(signal) || rootWinner.reason === 'aborted';
      const timeout = ctx.deadline.expired() || rootWinner.reason === 'timeout';
      const empty = {
        id: nodeId(rootPath),
        name: path.basename(rootPath) || rootPath,
        path: rootPath,
        displayPath: ctx.toDisplay(rootPath),
        type: 'dir',
        sizeBytes: 0,
        fileCount: 0,
        subfolderCount: 0,
        directFileCount: 0,
        directSubfolderCount: 0,
        items: 0,
        lastModified: 0,
        partial: true,
        reason: aborted ? 'cancelled' : 'timeout',
        children: [],
      };
      if (registry) registry.register(empty);
      if (typeof options.onRoot === 'function') options.onRoot(empty);
      return {
        root: empty,
        registry,
        totals: { sizeBytes: 0, fileCount: 0, subfolderCount: 0, items: 0 },
        extensions: [],
        partial: true,
        timedOut: timeout,
        cancelled: aborted,
        skipped: ctx.skipped,
        dirsScanned: 0,
        filesScanned: 0,
        durationMs: now() - startedAt,
      };
    }
    if (!rootWinner.ok.isDirectory()) {
      throw Object.assign(new Error('not_a_directory'), { code: 'ENOTDIR' });
    }

    const tree = await walkDir(rootPath, ctx);
    const timedOut = ctx.deadline.expired();
    const cancelled = isAborted(signal);
    if (cancelled) {
      tree.partial = true;
      tree.reason = tree.reason || 'cancelled';
    }

    return {
      root: tree,
      registry,
      totals: {
        sizeBytes: tree.sizeBytes,
        fileCount: tree.fileCount,
        subfolderCount: tree.subfolderCount,
        items: tree.items,
      },
      extensions: summarizeExtensions(ctx.extensions, ctx.extensionFiles),
      partial: tree.partial,
      timedOut,
      cancelled,
      skipped: ctx.skipped,
      dirsScanned: ctx.dirs,
      filesScanned: ctx.files,
      durationMs: now() - startedAt,
    };
  } finally {
    deadlineObj.dispose();
  }
}

function summarizeExtensions(sizeMap, fileMap) {
  const rows = [];
  for (const [ext, sizeBytes] of sizeMap.entries()) {
    rows.push({ extension: ext, sizeBytes, fileCount: fileMap.get(ext) || 0 });
  }
  rows.sort((a, b) => b.sizeBytes - a.sizeBytes || a.extension.localeCompare(b.extension));
  return rows;
}

/**
 * Percentage of `part` within `whole`, rounded to 1 decimal. Returns 0 when the
 * whole is unknown/zero so the UI never prints NaN.
 */
function percentOf(part, whole) {
  const total = Number(whole);
  if (!total || total <= 0) return 0;
  return Math.round((Number(part) / total) * 1000) / 10;
}

/**
 * Build the configured scan roots. `SCAN_ROOTS` (JSON array) overrides the
 * defaults; otherwise the roots are derived from `SCAN_HOST_MOUNT` when running
 * in a container.
 *
 * @param {object} [options]
 * @returns {Array<{id:string,name:string,path:string,displayPath:string,letter:string|null}>}
 */
function createRoots(options = {}) {
  const raw = options.scanRoots !== undefined ? options.scanRoots : process.env.SCAN_ROOTS;
  if (raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn(`SCAN_ROOTS bukan JSON valid: ${error.message}`);
      parsed = null;
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .filter((item) => item && typeof item.name === 'string' && typeof item.path === 'string')
        .map((item) => {
          const display = typeof item.displayPath === 'string' ? item.displayPath : toDisplayPath(item.path);
          return {
            id: nodeId(item.path),
            name: item.name,
            path: item.path,
            displayPath: display,
            letter: /^([A-Za-z]):/.test(display) ? display[0].toUpperCase() : null,
          };
        });
    }
  }

  const mount = options.scanHostMount !== undefined ? options.scanHostMount : process.env.SCAN_HOST_MOUNT;
  const map = parseHostMount(mount);
  if (map) {
    return Object.keys(map)
      .sort()
      .map((letter) => {
        const drive = letter.toUpperCase();
        return {
          id: nodeId(`${drive}:\\`),
          name: `Drive ${drive}:`,
          path: map[letter],
          displayPath: `${drive}:\\`,
          letter: drive,
        };
      });
  }

  return [{ id: nodeId('C:\\'), name: 'Drive C:', path: 'C:\\', displayPath: 'C:\\', letter: 'C' }];
}

function parseHostMount(mount) {
  if (!mount) return null;
  let value = mount;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        return { c: trimmed };
      }
    } else {
      const last = trimmed.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
      return /^[A-Za-z]$/.test(last) ? { [last.toLowerCase()]: trimmed } : { '*': trimmed };
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const map = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val !== 'string') continue;
      const k = String(key).toLowerCase().replace(/:$/, '');
      if (/^[a-z]$/.test(k)) map[k] = val;
    }
    return Object.keys(map).length > 0 ? map : null;
  }
  return null;
}

/**
 * Serialize one node for the tree API: includes only direct children summaries,
 * never the full recursive subtree. Percentages are supplied by the caller.
 *
 * @param {ScanNode} node
 * @returns {object}
 */
function toSummary(node) {
  return {
    id: node.id,
    name: node.name,
    displayPath: node.displayPath,
    type: node.type,
    sizeBytes: node.sizeBytes,
    fileCount: node.fileCount,
    subfolderCount: node.subfolderCount,
    items: node.items,
    lastModified: node.lastModified,
    partial: Boolean(node.partial),
    risk: node.risk || 'unknown',
    category: node.category || 'unknown',
    guideId: node.guideId || null,
  };
}

module.exports = {
  analyze,
  makeDisplayMapper,
  createRoots,
  parseHostMount,
  percentOf,
  summarizeExtensions,
  toSummary,
  toDisplayPath,
  resolveTimeoutMs,
  extensionOf,
  walkDir,
  DEFAULT_SCAN_TIMEOUT_MS,
};
