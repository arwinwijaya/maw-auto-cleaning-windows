'use strict';

const http = require('node:http');
const fs = require('node:fs').promises;
const path = require('node:path');
const { sizeHuman } = require('./lib/format.js');
const { resolveUserPaths } = require('./lib/resolve-temp.js');
const { mapLimit } = require('./lib/concurrency.js');
const cleanupTargets = require('./lib/cleanup-targets.js');
const cleanupEngine = require('./lib/cleanup-engine.js');
const cleanupJobs = require('./lib/cleanup-jobs.js');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3456;
const DEFAULT_SCAN_TIMEOUT_MS = 45_000;

function resolveTimeoutMs(options = {}) {
  if (options.timeoutMs) return Number(options.timeoutMs);
  const fromEnv = Number(process.env.SCAN_TIMEOUT_MS);
  return fromEnv > 0 ? fromEnv : DEFAULT_SCAN_TIMEOUT_MS;
}
const PUBLIC_ROOT = path.resolve(__dirname, 'public');

function nowIsoWithLocalOffset(date = new Date()) {
  const pad = (n, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHour = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetMinute = pad(Math.abs(offsetMinutes) % 60);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${sign}${offsetHour}:${offsetMinute}`;
}


/**
 * Security headers applied to every HTTP response (spec R13/R14).
 *
 * The CSP policy is intentionally strict: scripts and connections are limited
 * to same-origin, framing is denied, and forms/base URLs are locked down. The
 * `style-src` directive keeps `'unsafe-inline'` so the single `<style>` block
 * in `public/index.html` keeps working without a build step (spec R14).
 *
 * @returns {Record<string, string>}
 */
function securityHeaders() {
  return {
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  };
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    ...securityHeaders(),
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function isAccessDenied(code) {
  return code === 'EACCES' || code === 'EPERM';
}

function isNotFound(code) {
  return code === 'ENOENT' || code === 'ENOTDIR';
}

const KNOWN_GROUPS = new Set(['temp', 'system', 'logs', 'cache', 'app']);

function normalizeGroup(group) {
  return KNOWN_GROUPS.has(group) ? group : 'other';
}

const WINDOWS_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

function isWindowsPath(value) {
  return typeof value === 'string' && WINDOWS_PATH_PATTERN.test(value);
}

/**
 * Parse SCAN_HOST_MOUNT into a drive-letter → mount-point map.
 * - `undefined`/empty → `null` (no remapping)
 * - Object `{ c: '/mnt/c', d: '/mnt/d' }` → normalized lowercase keys
 * - JSON string `'{"c":"/mnt/c","d":"/mnt/d"}'` → parsed then normalized
 * - Legacy string `'/mnt/c'` → infer drive from last segment (`c`); if not a single letter → catch-all `*`
 * @param {string|object} [mount]
 * @returns {object|null} Map like `{ c: '/mnt/c' }` or `{ '*': '/mnt/host' }`
 */
function parseHostMount(mount) {
  if (!mount) return null;
  if (typeof mount === 'object' && !Array.isArray(mount)) {
    const map = {};
    for (const [key, value] of Object.entries(mount)) {
      if (typeof value !== 'string') continue;
      const k = String(key).toLowerCase().replace(/^([a-z]):?$/, '$1');
      if (/^[a-z]$/.test(k)) map[k] = value;
    }
    return Object.keys(map).length > 0 ? map : null;
  }
  const raw = String(mount).trim();
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parseHostMount(parsed);
      }
    } catch {
      // fall through to legacy string handling
    }
  }
  // Legacy single mount string: infer drive from last path segment
  const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '');
  const last = normalized.split('/').pop() || '';
  if (/^[A-Za-z]$/.test(last)) {
    return { [last.toLowerCase()]: raw };
  }
  // No recognizable drive letter: treat as catch-all for backward compatibility
  return { '*': raw };
}

/**
 * Translate a Windows path (e.g. `C:\\Windows\\Temp`) into the equivalent path
 * inside a Linux container bind mount (e.g. `/mnt/c/Windows/Temp`).
 *
 * @param {string} winPath - Windows-style path.
 * @param {string|object} [mount] - Container mount point or drive map.
 * @returns {string} Container path, or original winPath if no matching mount.
 */
function toContainerPath(winPath, mount) {
  const map = parseHostMount(mount);
  if (!map) return String(winPath);
  const driveMatch = String(winPath).match(/^([A-Za-z]):/);
  const drive = driveMatch ? driveMatch[1].toLowerCase() : null;
  const mountPoint = drive && map[drive] ? map[drive] : map['*'] || null;
  if (!mountPoint) return String(winPath);
  const unified = String(winPath).replace(/\//g, '\\');
  const withoutDrive = unified.replace(/^[A-Za-z]:\\?/, '');
  const posix = withoutDrive.replace(/\\/g, '/').replace(/^\/+/, '');
  const base = String(mountPoint).replace(/\\/g, '/').replace(/\/+$/, '');
  return posix ? `${base}/${posix}` : base;
}

function toDisplayPath(targetPath) {
  return String(targetPath).replace(/\//g, '\\');
}

/**
 * When the scanner runs inside a Linux container, the Windows whitelist paths
 * must be remapped to their bind-mount location. The UI keeps showing the
 * original Windows path via `displayPath`, while `path` points at the mounted
 * folder that the container can actually read.
 *
 * @param {Array<object>} folders - Whitelist entries with Windows paths.
 * @param {string|object} [mount] - Container mount point or drive map.
 * @returns {Array<object>}
 */
function applyHostMount(folders, mount) {
  if (!mount) return folders.map((folder) => ({ ...folder }));
  return folders.map((folder) => {
    if (!isWindowsPath(folder.path)) return { ...folder };
    const mapped = toContainerPath(folder.path, mount);
    if (mapped === folder.path) return { ...folder };
    return {
      ...folder,
      displayPath: folder.displayPath || toDisplayPath(folder.path),
      path: mapped,
    };
  });
}

/**
 * Parse the optional `SCAN_ROOTS` JSON override. Each entry is
 * `{ name, path, group?, displayPath? }` where `path` is the path readable by
 * the process (host or container).
 *
 * @param {string} [raw] - Raw JSON string.
 * @returns {Array<object>|null} Parsed roots, or null when absent/invalid.
 */
function parseScanRoots(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`SCAN_ROOTS bukan JSON valid: ${error.message}`);
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.warn('SCAN_ROOTS harus berupa array JSON yang tidak kosong.');
    return null;
  }
  const roots = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.name !== 'string' || typeof item.path !== 'string') continue;
    const entry = { name: item.name, path: item.path };
    if (typeof item.group === 'string') entry.group = item.group;
    if (typeof item.displayPath === 'string') entry.displayPath = item.displayPath;
    roots.push(entry);
  }
  if (roots.length === 0) {
    console.warn('SCAN_ROOTS tidak berisi entri valid {name, path}.');
    return null;
  }
  return roots;
}

function makeEntry(folder, status, fileCount = 0, sizeBytes = 0, reason) {
  const entry = {
    name: folder.name,
    path: folder.displayPath || folder.path,
    group: normalizeGroup(folder.group),
    fileCount,
    sizeBytes,
    sizeHuman: sizeHuman(sizeBytes),
    status,
  };
  if ((status === 'partial' || status === 'access_denied') && reason) {
    entry.reason = reason;
  }
  if (folder.fallback === true) entry.fallback = true;
  return entry;
}

async function getWhitelist(options = {}) {
  if (Array.isArray(options.whitelistRoots)) {
    return options.whitelistRoots.map((folder) => ({ ...folder }));
  }

  const mount = options.scanHostMount !== undefined
    ? options.scanHostMount
    : process.env.SCAN_HOST_MOUNT;
  const scanRoots = parseScanRoots(
    options.scanRoots !== undefined ? options.scanRoots : process.env.SCAN_ROOTS,
  );
  if (scanRoots) {
    return applyHostMount(scanRoots, mount);
  }

  if (process.env.TEST_FIXTURE_ROOT) {
    const root = process.env.TEST_FIXTURE_ROOT;
    return [
      { name: 'Local\\Temp', path: path.join(root, 'UserTemp'), group: 'temp' },
      { name: 'Windows\\Temp', path: path.join(root, 'WindowsTemp'), group: 'temp' },
      { name: 'Windows\\Prefetch', path: path.join(root, 'Prefetch'), group: 'system' },
      { name: '$Recycle.Bin', path: path.join(root, '$Recycle.Bin'), group: 'system' },
      {
        name: 'SoftwareDistribution\\Download',
        path: path.join(root, 'SoftwareDistribution', 'Download'),
        group: 'system',
      },
      { name: 'Windows\\Logs', path: path.join(root, 'WindowsLogs'), group: 'logs' },
      { name: 'Windows\\Minidump', path: path.join(root, 'Minidump'), group: 'logs' },
      { name: 'LiveKernelReports', path: path.join(root, 'LiveKernelReports'), group: 'logs' },
      {
        name: 'WER\\ReportQueue',
        path: path.join(root, 'WER', 'ReportQueue'),
        group: 'logs',
      },
      {
        name: 'WER\\ReportArchive',
        path: path.join(root, 'WER', 'ReportArchive'),
        group: 'logs',
      },
      { name: 'CrashDumps', path: path.join(root, 'UserLocal', 'CrashDumps'), group: 'cache' },
      {
        name: 'INetCache',
        path: path.join(root, 'UserLocal', 'Microsoft', 'Windows', 'INetCache'),
        group: 'cache',
      },
      { name: 'D3DSCache', path: path.join(root, 'UserLocal', 'D3DSCache'), group: 'cache' },
      {
        name: 'NVIDIA\\DXCache',
        path: path.join(root, 'UserLocal', 'NVIDIA', 'DXCache'),
        group: 'cache',
      },
      {
        name: 'NVIDIA\\GLCache',
        path: path.join(root, 'UserLocal', 'NVIDIA', 'GLCache'),
        group: 'cache',
      },
      { name: 'D:\\Temp', path: 'D:\\Temp', group: 'temp' },
      { name: 'D:\\Program', path: 'D:\\Program', group: 'app' },
      { name: 'D:\\Program Files', path: 'D:\\Program Files', group: 'app' },
    ];
  }

  const { localAppData, temp, usedFallback } = await (
    options.resolveUserPaths || resolveUserPaths
  )();
  const userLocal = localAppData || 'C:\\Users\\Default\\AppData\\Local';

  const folders = [
    { name: 'Local\\Temp', path: temp, group: 'temp', fallback: usedFallback },
    { name: 'Windows\\Temp', path: 'C:\\Windows\\Temp', group: 'temp' },
    { name: 'Windows\\Prefetch', path: 'C:\\Windows\\Prefetch', group: 'system' },
    { name: '$Recycle.Bin', path: 'C:\\$Recycle.Bin', group: 'system' },
    {
      name: 'SoftwareDistribution\\Download',
      path: 'C:\\Windows\\SoftwareDistribution\\Download',
      group: 'system',
    },
    { name: 'Windows\\Logs', path: 'C:\\Windows\\Logs', group: 'logs' },
    { name: 'Windows\\Minidump', path: 'C:\\Windows\\Minidump', group: 'logs' },
    { name: 'LiveKernelReports', path: 'C:\\Windows\\LiveKernelReports', group: 'logs' },
    {
      name: 'WER\\ReportQueue',
      path: 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue',
      group: 'logs',
    },
    {
      name: 'WER\\ReportArchive',
      path: 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive',
      group: 'logs',
    },
    { name: 'CrashDumps', path: path.join(userLocal, 'CrashDumps'), group: 'cache' },
    {
      name: 'INetCache',
      path: path.join(userLocal, 'Microsoft', 'Windows', 'INetCache'),
      group: 'cache',
    },
    { name: 'D3DSCache', path: path.join(userLocal, 'D3DSCache'), group: 'cache' },
    { name: 'NVIDIA\\DXCache', path: path.join(userLocal, 'NVIDIA', 'DXCache'), group: 'cache' },
    { name: 'NVIDIA\\GLCache', path: path.join(userLocal, 'NVIDIA', 'GLCache'), group: 'cache' },
    { name: 'D:\\Temp', path: 'D:\\Temp', group: 'temp' },
    { name: 'D:\\Program', path: 'D:\\Program', group: 'app' },
    { name: 'D:\\Program Files', path: 'D:\\Program Files', group: 'app' },
  ];

  return applyHostMount(folders, mount);
}

function hasTimedOut(context) {
  return context.now() - context.startedAt >= context.timeoutMs || context.timedOut === true;
}

function isAborted(context) {
  return Boolean(context.abortSignal && context.abortSignal.aborted);
}

// Race `work()` against the strict global deadline. Resolves with
// { timedOut: true } when the deadline fires first, otherwise
// { timedOut: false, value } or { timedOut: false, error }.
// On timer expiry, also marks `context.timedOut = true` so downstream
// callers (and injected clocks) observe the same deadline.
async function raceDeadline(context, work) {
  if (hasTimedOut(context)) {
    context.timedOut = true;
    return { timedOut: true };
  }
  if (isAborted(context)) {
    return { timedOut: true };
  }
  const remaining = context.timeoutMs - (context.now() - context.startedAt);
  if (remaining <= 0) {
    context.timedOut = true;
    return { timedOut: true };
  }

  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      context.timedOut = true;
      resolve({ timedOut: true });
    }, remaining);
  });

  let onAbort;
  const aborted = new Promise((resolve) => {
    if (!context.abortSignal) return;
    if (context.abortSignal.aborted) {
      resolve({ timedOut: true });
      return;
    }
    onAbort = () => resolve({ timedOut: true });
    context.abortSignal.addEventListener('abort', onAbort, { once: true });
  });

  const settled = Promise.resolve()
    .then(work)
    .then(
      (value) => hasTimedOut(context) ? { timedOut: true } : { timedOut: false, value },
      (error) => hasTimedOut(context) ? { timedOut: true } : { timedOut: false, error },
    );

  try {
    return await Promise.race([settled, deadline, aborted]);
  } finally {
    clearTimeout(timer);
    if (onAbort && context.abortSignal) context.abortSignal.removeEventListener('abort', onAbort);
  }
}

async function walkFolder(rootPath, context) {
  const fsApi = context.fs || fs;
  let fileCount = 0;
  let sizeBytes = 0;
  let skipped = 0;
  let timedOut = false;

  async function walk() {
    const stack = [rootPath];
    while (stack.length > 0) {
      if (hasTimedOut(context)) {
        timedOut = true;
        break;
      }

      const current = stack.pop();
      let entries;
      try {
        entries = await fsApi.readdir(current, { withFileTypes: true });
      } catch {
        skipped += 1;
        continue;
      }

      const outcomes = await mapLimit(entries, 32, async (dirent) => {
        if (hasTimedOut(context)) return { kind: 'timeout' };

        const fullPath = path.join(current, dirent.name);
        if (typeof dirent.isSymbolicLink === 'function' && dirent.isSymbolicLink()) {
          return { kind: 'ignored' };
        }
        if (typeof dirent.isDirectory === 'function' && dirent.isDirectory()) {
          let stat;
          try {
            stat = await fsApi.lstat(fullPath);
          } catch {
            return { kind: 'skipped' };
          }
          if (stat.isSymbolicLink()) return { kind: 'ignored' };
          if (typeof stat.isReparsePoint === 'function' && stat.isReparsePoint()) return { kind: 'ignored' };
          return { kind: 'directory', path: fullPath };
        }

        let stat;
        try {
          stat = await fsApi.lstat(fullPath);
        } catch {
          return { kind: 'skipped' };
        }

        if (stat.isSymbolicLink()) return { kind: 'ignored' };
        if (typeof stat.isReparsePoint === 'function' && stat.isReparsePoint()) return { kind: 'ignored' };
        if (stat.isDirectory()) return { kind: 'directory', path: fullPath };
        if (stat.isFile()) return { kind: 'file', size: stat.size };
        return { kind: 'ignored' };
      });

      if (hasTimedOut(context)) {
        timedOut = true;
        break;
      }

      for (const outcome of outcomes) {
        if (outcome.kind === 'timeout') {
          timedOut = true;
          break;
        }
        if (outcome.kind === 'skipped') {
          skipped += 1;
        } else if (outcome.kind === 'directory') {
          stack.push(outcome.path);
        } else if (outcome.kind === 'file') {
          fileCount += 1;
          sizeBytes += outcome.size;
        }
      }
      if (timedOut) break;
    }
  }

  const outcome = await raceDeadline(context, walk);
  if (outcome.timedOut) {
    timedOut = true;
  }

  const skipRatio = fileCount === 0 ? (skipped > 0 ? 1 : 0) : skipped / fileCount;
  const partial = timedOut || skipRatio > 0.10;
  return { fileCount, sizeBytes, skipped, timedOut, partial };
}

async function scanFolder(folder, context) {
  const fsApi = context.fs || fs;
  const start = context.now();

  if (hasTimedOut(context) || isAborted(context)) {
    return makeEntry(folder, 'partial', 0, 0, 'timeout');
  }

  const rootOutcome = await raceDeadline(context, () => fsApi.lstat(folder.path));
  if (rootOutcome.timedOut) {
    return makeEntry(folder, 'partial', 0, 0, 'timeout');
  }

  try {
    if (rootOutcome.error) throw rootOutcome.error;
    const rootStat = rootOutcome.value;
    if (!rootStat.isDirectory() ||
        rootStat.isSymbolicLink() ||
        (typeof rootStat.isReparsePoint === 'function' && rootStat.isReparsePoint())) {
      return makeEntry(folder, 'not_found');
    }
  } catch (error) {
    const elapsed = context.now() - start;
    if (isNotFound(error.code)) {
      console.warn(`${folder.path} not_found ${error.code || 'not_found'} ${elapsed}ms`);
      return makeEntry(folder, 'not_found');
    }
    if (isAccessDenied(error.code)) {
      console.warn(`${folder.path} access_denied ${error.code || 'access_denied'} ${elapsed}ms`);
      return makeEntry(folder, 'access_denied', 0, 0, 'access_denied');
    }
    console.warn(`${folder.path} partial ${error.code || error.message || 'scan_error'} ${elapsed}ms`);
    return makeEntry(folder, 'partial');
  }

  const result = await walkFolder(folder.path, context);
  const status = result.partial ? 'partial' : 'ready';
  if (status !== 'ready') {
    const elapsed = context.now() - start;
    const reason = result.timedOut ? 'timeout' : `skipped=${result.skipped}`;
    console.warn(`${folder.path} ${status} ${reason} ${elapsed}ms`);
    return makeEntry(folder, status, result.fileCount, result.sizeBytes, reason);
  }
  return makeEntry(folder, status, result.fileCount, result.sizeBytes);
}

async function scanAll(options = {}) {
  const folders = await getWhitelist(options);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const context = {
    fs: options.fs,
    now,
    startedAt: now(),
    timeoutMs: resolveTimeoutMs(options),
    abortSignal: options.abortSignal || null,
  };
  const entries = [];
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  for (const folder of folders) {
    if (hasTimedOut(context) || isAborted(context)) {
      const aborted = makeEntry(folder, 'partial', 0, 0, 'timeout');
      entries.push(aborted);
      if (onProgress) onProgress(aborted, entries.slice());
      continue;
    }
    const entry = await scanFolder(folder, context);
    entries.push(entry);
    if (onProgress) onProgress(entry, entries.slice());
  }

  const partial = entries.some((entry) => (
    entry.status === 'partial' || entry.status === 'access_denied'
  ));
  return {
    entries,
    scannedAt: nowIsoWithLocalOffset(),
    partial,
  };
}

function safeStaticPath(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0]);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.normalize(requested).replace(/^([/\\])+/, '');
  const resolved = path.resolve(PUBLIC_ROOT, normalized);
  const rootWithSep = PUBLIC_ROOT.endsWith(path.sep) ? PUBLIC_ROOT : `${PUBLIC_ROOT}${path.sep}`;
  if (resolved !== PUBLIC_ROOT && !resolved.startsWith(rootWithSep)) {
    return null;
  }
  return resolved;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

async function serveStatic(req, res) {
  let filePath;
  try {
    filePath = safeStaticPath(req.url || '/');
  } catch {
    json(res, 400, { error: 'Permintaan tidak valid.' });
    return;
  }

  if (!filePath) {
    json(res, 404, { error: 'Tidak ditemukan.' });
    return;
  }

  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) {
      json(res, 404, { error: 'Tidak ditemukan.' });
      return;
    }
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      ...securityHeaders(),
      'content-type': contentType(filePath),
      'content-length': data.length,
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch (error) {
    if (isNotFound(error.code)) {
      json(res, 404, { error: 'Tidak ditemukan.' });
      return;
    }
    json(res, 500, { error: 'Gagal membaca file statis.' });
  }
}

async function readJsonBody(req, maxBytes = 16 * 1024) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw Object.assign(new Error('request_too_large'), { statusCode: 413 });
  }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('invalid_json'), { statusCode: 400 }); }
}

function validSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host;
  } catch { return false; }
}

function createServer(options = {}) {
  const previewTokens = new Map();
  const auditFile = options.auditFile || process.env.CLEANUP_AUDIT_FILE || '/tmp/cleanup-audit.jsonl';
  return http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const routePath = reqUrl.pathname;

      if (routePath === '/api/cleanup/targets') {
        if (req.method !== 'GET') { json(res, 405, { error: 'Metode tidak diizinkan.' }); return; }
        json(res, 200, { targets: cleanupTargets.getCleanableTargets().map(({ internalPath, ...target }) => target) });
        return;
      }

      if (routePath === '/api/cleanup/preview') {
        if (req.method !== 'POST') { json(res, 405, { error: 'Metode tidak diizinkan.' }); return; }
        if (!validSameOrigin(req)) { json(res, 403, { error: 'Origin tidak diizinkan.' }); return; }
        const body = await readJsonBody(req);
        if (!body || Object.keys(body).some(k => k !== 'targets') || !Array.isArray(body.targets) || body.targets.length < 1 || body.targets.length > 20 || body.targets.some(id => typeof id !== 'string')) {
          json(res, 400, { error: 'Permintaan hanya boleh berisi daftar target ID.' }); return;
        }
        const checked = cleanupTargets.validateTargetIds(body.targets);
        if (!checked.valid) { json(res, 400, { error: 'Target tidak dikenal atau tidak aktif.', invalidTargets: checked.invalid }); return; }
        const conflict = cleanupJobs.checkTargetLocks(body.targets);
        if (conflict) { json(res, 409, { error: 'Target is currently being cleaned.', targetId: conflict }); return; }
        try {
          const result = await cleanupEngine.preview(body.targets, options.cleanupOptions || {});
          const confirmationToken = cleanupJobs.createConfirmationToken(body.targets);
          previewTokens.set(confirmationToken, result);
          json(res, 200, {
            targets: result.targets.map(item => ({ ...item, name: cleanupTargets.findTargetById(item.targetId).name, displayPath: cleanupTargets.getDisplayPath(item.targetId) })),
            eligibleFiles: result.totalEligibleFiles,
            eligibleDirectories: result.totalEligibleDirectories,
            estimatedBytes: result.totalEstimatedBytes,
            skippedRecentFiles: result.totalSkippedRecent,
            skippedProtectedFiles: result.totalSkippedProtected,
            confirmationToken,
          });
        } catch (error) { json(res, 400, { error: error.message === 'ENOENT' ? 'Target tidak tersedia.' : 'Preview gagal; root tidak dapat divalidasi.' }); }
        return;
      }

      if (routePath === '/api/cleanup/jobs') {
        if (req.method !== 'POST') { json(res, 405, { error: 'Metode tidak diizinkan.' }); return; }
        if (!validSameOrigin(req)) { json(res, 403, { error: 'Origin tidak diizinkan.' }); return; }
        const body = await readJsonBody(req);
        if (!body || Object.keys(body).some(k => !['targets', 'confirmationToken'].includes(k)) || !Array.isArray(body.targets) || body.targets.length < 1 || body.targets.length > 20 || body.targets.some(id => typeof id !== 'string') || typeof body.confirmationToken !== 'string') {
          json(res, 400, { error: 'Diperlukan target ID dan confirmation token.' }); return;
        }
        const checked = cleanupTargets.validateTargetIds(body.targets);
        if (!checked.valid) { json(res, 400, { error: 'Target tidak dikenal atau tidak aktif.', invalidTargets: checked.invalid }); return; }
        const preview = previewTokens.get(body.confirmationToken);
        if (!preview || !cleanupJobs.consumeConfirmationToken(body.confirmationToken, body.targets)) { json(res, 403, { error: 'Confirmation token tidak valid atau kedaluwarsa.' }); return; }
        previewTokens.delete(body.confirmationToken);
        const created = cleanupJobs.createJob(body.targets);
        if (!created.jobId) { json(res, 409, { error: 'Target is currently being cleaned.', targetId: created.conflictTarget }); return; }
        const job = cleanupJobs.getJob(created.jobId);
        cleanupJobs.startJob(created.jobId);
        (async () => {
          try {
            let processedFiles = 0;
            const result = await cleanupEngine.execute(body.targets, {
              ...(options.cleanupOptions || {}),
              signal: job.abortController.signal,
              onProgress: progress => {
                const next = Number(progress.filesDeleted || 0);
                const delta = Math.max(0, next - processedFiles);
                processedFiles = next;
                cleanupJobs.updateProgress(created.jobId, { processedFiles: delta, bytesDeleted: progress.bytesDeleted });
              },
            });
            cleanupJobs.completeJob(created.jobId, result);
            const audit = { timestamp: new Date().toISOString(), targetIds: body.targets, filesDeleted: result.totals.filesDeleted, directoriesDeleted: result.totals.directoriesDeleted, bytesReclaimed: result.totals.bytesDeleted, skipped: { recent: result.totals.skippedRecent, locked: result.totals.skippedLocked, accessDenied: result.totals.accessDenied, protected: result.totals.protected }, errors: result.totals.failed, durationMs: result.totals.durationMs };
            try { await fs.appendFile(auditFile, `${JSON.stringify(audit)}\n`, { mode: 0o600 }); } catch (error) { console.warn('Audit log unavailable:', error.code || error.message); }
          } catch (error) {
            if (error.name === 'AbortError') cleanupJobs.updateProgress(created.jobId, { status: 'cancelled', completedAt: Date.now() });
            else cleanupJobs.failJob(created.jobId, error);
            cleanupJobs.releaseLocks(body.targets);
          }
        })();
        json(res, 202, { jobId: created.jobId });
        return;
      }

      const jobMatch = routePath.match(/^\/api\/cleanup\/jobs\/([a-f0-9]+)(\/cancel)?$/);
      if (jobMatch) {
        const job = cleanupJobs.getJob(jobMatch[1]);
        if (!job) { json(res, 404, { error: 'Job tidak ditemukan.' }); return; }
        if (jobMatch[2]) {
          if (req.method !== 'POST') { json(res, 405, { error: 'Metode tidak diizinkan.' }); return; }
          if (!validSameOrigin(req)) { json(res, 403, { error: 'Origin tidak diizinkan.' }); return; }
          cleanupJobs.cancelJob(jobMatch[1]);
        } else if (req.method !== 'GET') { json(res, 405, { error: 'Metode tidak diizinkan.' }); return; }
        json(res, 200, cleanupJobs.getJobSummary(jobMatch[1]));
        return;
      }

      if (routePath === '/api/scan/stream') {
        if (req.method !== 'GET') {
          json(res, 405, { error: 'Metode tidak diizinkan.' });
          return;
        }
        const abortController = new AbortController();
        const onClose = () => abortController.abort();
        res.on('close', onClose);
        res.writeHead(200, {
          ...securityHeaders(),
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.flushHeaders();
        try {
          const body = await scanAll({
            ...options,
            abortSignal: abortController.signal,
            onProgress(entry) {
              if (!abortController.signal.aborted && !res.destroyed) {
                res.write(`event: folder\ndata: ${JSON.stringify(entry)}\n\n`);
              }
            },
          });
          if (!abortController.signal.aborted && !res.destroyed) {
            res.write(`event: done\ndata: ${JSON.stringify(body)}\n\n`);
            res.end();
          }
        } finally {
          res.off('close', onClose);
        }
        return;
      }

      if (routePath === '/api/scan') {
        if (req.method !== 'GET') {
          json(res, 405, { error: 'Metode tidak diizinkan.' });
          return;
        }
        const body = await scanAll(options);
        json(res, 200, body);
        return;
      }

      if (routePath.startsWith('/api/')) {
        json(res, 404, { error: 'Endpoint tidak ditemukan.' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: 'Metode tidak diizinkan.' });
        return;
      }
      await serveStatic(req, res);
    } catch (error) {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      if (statusCode === 413) {
        json(res, 413, { error: 'Permintaan terlalu besar.' });
        return;
      }
      if (statusCode === 400) {
        json(res, 400, { error: 'Format permintaan tidak valid.' });
        return;
      }
      json(res, 500, { error: 'Terjadi kesalahan server.' });
    }
  });
}

function resolveHost(options = {}) {
  return options.host || process.env.HOST || HOST;
}

async function start(options = {}) {
  const port = Number(options.port !== undefined ? options.port : (process.env.PORT || DEFAULT_PORT));
  const host = resolveHost(options);
  const server = createServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

if (require.main === module) {
  start()
    .then((server) => {
      const address = server.address();
      console.log(`Cleanup Web Scanner running at http://${resolveHost()}:${address.port}/`);
    })
    .catch((error) => {
      console.error(`Gagal menjalankan server: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  HOST,
  DEFAULT_PORT,
  DEFAULT_SCAN_TIMEOUT_MS,
  createServer,
  start,
  resolveHost,
  scanAll,
  walkFolder,
  getWhitelist,
  parseScanRoots,
  applyHostMount,
  toContainerPath,
  toDisplayPath,
  nowIsoWithLocalOffset,
  resolveTimeoutMs,
};
