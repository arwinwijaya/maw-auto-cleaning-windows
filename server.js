'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs').promises;
const path = require('node:path');

const {
  analyze,
  createRoots,
  percentOf,
  toSummary,
  toDisplayPath,
  DEFAULT_SCAN_TIMEOUT_MS,
} = require('./lib/analyzer.js');
const { NodeRegistry, nodeId } = require('./lib/tree-registry.js');
const { getGuide, GUIDES } = require('./lib/cleanup-guides.js');
const { sizeHuman } = require('./lib/format.js');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3456;
const PUBLIC_ROOT = path.resolve(__dirname, 'public');

// How long a completed scan session is retained for lazy tree lookups.
const SESSION_TTL_MS = 30 * 60_000;
const MAX_SESSIONS = 8;

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

function isNotFound(code) {
  return code === 'ENOENT' || code === 'ENOTDIR';
}

// ---------------------------------------------------------------------------
// Scan sessions
// ---------------------------------------------------------------------------

/**
 * One in-flight or completed scan. Holds the fully walked tree in memory so the
 * UI can lazily request individual subtrees, plus a registry that maps opaque
 * node ids back to real filesystem nodes.
 */
class ScanSession {
  constructor(id, root) {
    this.id = id;
    this.root = root;
    this.status = 'scanning';
    this.registry = new NodeRegistry();
    this.liveRoot = null;
    this.result = null;
    this.error = null;
    this.abortController = new AbortController();
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.listeners = new Set();
    this.totals = { sizeBytes: 0, fileCount: 0, subfolderCount: 0 };
    this.progress = { dirsScanned: 0, filesScanned: 0, bytesScanned: 0, currentPath: '' };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    this.updatedAt = Date.now();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken SSE client must never break the scan.
      }
    }
  }

  get expired() {
    return this.status !== 'scanning' && Date.now() - this.updatedAt > SESSION_TTL_MS;
  }
}

class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  create(root) {
    this.evict();
    const id = crypto.randomBytes(9).toString('hex');
    const session = new ScanSession(id, root);
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    const session = this.sessions.get(String(id));
    if (!session) return null;
    if (session.expired) {
      this.sessions.delete(session.id);
      return null;
    }
    return session;
  }

  evict() {
    for (const [id, session] of this.sessions) {
      if (session.expired) this.sessions.delete(id);
    }
    if (this.sessions.size < MAX_SESSIONS) return;
    const finished = [...this.sessions.values()]
      .filter((s) => s.status !== 'scanning')
      .sort((a, b) => a.updatedAt - b.updatedAt);
    while (this.sessions.size >= MAX_SESSIONS && finished.length > 0) {
      this.sessions.delete(finished.shift().id);
    }
  }
}



function runScan(session, options) {
  const startedAt = Date.now();
  analyze(session.root.path, {
    fs: options.fs,
    signal: session.abortController.signal,
    timeoutMs: options.timeoutMs,
    displayRoot: session.root.displayPath,
    concurrency: options.concurrency,
    registry: session.registry,
    onRoot: (root) => {
      if (!session.liveRoot) session.liveRoot = root;
    },
    onChild: (parent, child) => {
      // Tree APIs can now return completed children before the entire scan ends.
      session.totals.sizeBytes = session.liveRoot ? session.liveRoot.sizeBytes : 0;
      session.totals.fileCount = session.liveRoot ? session.liveRoot.fileCount : 0;
      session.totals.subfolderCount = session.liveRoot ? session.liveRoot.subfolderCount : 0;
      session.emit({ type: 'tree', nodeId: parent.id });
    },
    onProgress: (progress) => {
      session.progress = progress;
      session.emit({ type: 'progress', progress });
    },
  })
    .then((result) => {
      session.result = result;
      session.totals = { sizeBytes: result.totals.sizeBytes, fileCount: result.totals.fileCount, subfolderCount: result.totals.subfolderCount };
      session.status = result.cancelled ? 'cancelled' : 'ready';
      session.emit({
        type: result.cancelled ? 'cancelled' : 'done',
        status: session.status,
        totals: session.totals,
        partial: result.partial,
        timedOut: result.timedOut,
        skipped: result.skipped,
        durationMs: Date.now() - startedAt,
      });
    })
    .catch((error) => {
      session.status = 'error';
      session.error = isNotFound(error.code) ? 'not_found' : (error.code || error.message || 'scan_error');
      session.emit({ type: 'error', error: session.error });
    })
    .finally(() => {
      session.updatedAt = Date.now();
    });
}

// ---------------------------------------------------------------------------
// Tree serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a directory's direct children with percentages relative to the
 * parent and to the drive root. Sorting is done client-side, so we return
 * everything (children lists are bounded by real folder fan-out).
 */
function childrenPayload(session, node) {
  const parentTotal = node.sizeBytes || 0;
  const driveTotal = session.totals.sizeBytes || 0;
  const children = (node.children || [])
    .map((child) => {
      const summary = toSummary(child);
      summary.percentParent = percentOf(child.sizeBytes, parentTotal);
      summary.percentDrive = percentOf(child.sizeBytes, driveTotal);
      return summary;
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
  return {
    parent: {
      ...toSummary(node),
      percentParent: 100,
      percentDrive: percentOf(node.sizeBytes, driveTotal),
    },
    children,
    driveTotalBytes: driveTotal,
    driveTotalHuman: sizeHuman(driveTotal),
  };
}

function treemapPayload(session, node, depth, limit) {
  const driveTotal = session.totals.sizeBytes || 0;
  const out = [];
  const walk = (current, currentDepth, parentId) => {
    if (currentDepth > depth) return;
    const kids = (current.children || []).filter((child) => child.type === 'dir')
      .concat((current.children || []).filter((child) => child.type === 'file'))
      .filter((child) => child.sizeBytes > 0)
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, limit);
    for (const child of kids) {
      out.push({
        id: child.id,
        parentId,
        name: child.name,
        displayPath: child.displayPath,
        type: child.type,
        sizeBytes: child.sizeBytes,
        percentDrive: percentOf(child.sizeBytes, driveTotal),
        risk: child.risk || 'unknown',
        depth: currentDepth,
      });
      if (child.type === 'dir' && currentDepth < depth) {
        walk(child, currentDepth + 1, child.id);
      }
    }
  };
  walk(node, 1, node.id);
  return { rootId: node.id, driveTotalBytes: driveTotal, nodes: out };
}

// ---------------------------------------------------------------------------
// Routing helpers
// ---------------------------------------------------------------------------

async function readJsonBody(req, maxBytes = 8 * 1024) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      throw Object.assign(new Error('request_too_large'), { statusCode: 413 });
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('invalid_json'), { statusCode: 400 });
  }
}

function validSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
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

function safeStaticPath(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0]);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.normalize(requested).replace(/^([/\\])+/, '');
  const resolved = path.resolve(PUBLIC_ROOT, normalized);
  const rootWithSep = PUBLIC_ROOT.endsWith(path.sep) ? PUBLIC_ROOT : `${PUBLIC_ROOT}${path.sep}`;
  if (resolved !== PUBLIC_ROOT && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
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

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function createServer(options = {}) {
  const store = new SessionStore();

  const handleApi = async (req, res, routePath, reqUrl) => {
    // GET /api/roots — available drives
    if (routePath === '/api/roots') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Metode tidak diizinkan.' });
      const roots = createRoots(options);
      return json(res, 200, {
        roots: roots.map((root) => ({
          id: root.id,
          name: root.name,
          displayPath: root.displayPath,
          letter: root.letter,
        })),
      });
    }

    // GET /api/guides, GET /api/guides/:id
    if (routePath === '/api/guides') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Metode tidak diizinkan.' });
      return json(res, 200, {
        guides: GUIDES.map((g) => ({
          id: g.id,
          title: g.name,
          risk: g.risk,
          description: g.description,
          commands: [...(g.cmdCommands || []), ...(g.psCommands || [])],
        })),
      });
    }
    const guideMatch = routePath.match(/^\/api\/guides\/([a-z0-9-]+)$/);
    if (guideMatch) {
      if (req.method !== 'GET') return json(res, 405, { error: 'Metode tidak diizinkan.' });
      const g = getGuide(guideMatch[1]);
      if (!g) return json(res, 404, { error: 'Panduan tidak ditemukan.' });
      return json(res, 200, {
        id: g.id,
        title: g.name,
        risk: g.risk,
        description: g.description,
        commands: [...(g.cmdCommands || []), ...(g.psCommands || [])],
      });
    }

    // POST /api/scans — start a scan for a root id
    if (routePath === '/api/scans') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Metode tidak diizinkan.' });
      if (!validSameOrigin(req)) return json(res, 403, { error: 'Origin tidak diizinkan.' });
      const body = await readJsonBody(req);
      const roots = createRoots(options);
      const root = roots.find((item) => item.id === body.rootId);
      if (!root) return json(res, 400, { error: 'Root tidak dikenal.' });
      const session = store.create(root);
      runScan(session, options);
      return json(res, 202, {
        scanId: session.id,
        root: { id: root.id, name: root.name, displayPath: root.displayPath },
      });
    }

    const scanMatch = routePath.match(/^\/api\/scans\/([a-f0-9]+)(\/.*)?$/);
    if (scanMatch) {
      const session = store.get(scanMatch[1]);
      if (!session) return json(res, 404, { error: 'Sesi pemindaian tidak ditemukan.' });
      const sub = scanMatch[2] || '';

      if (sub === '' || sub === '/status') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Metode tidak diizinkan.' });
        return json(res, 200, {
          scanId: session.id,
          status: session.status,
          root: { id: session.root.id, name: session.root.name, displayPath: session.root.displayPath },
          totals: session.totals,
          totalsHuman: sizeHuman(session.totals.sizeBytes),
          partial: session.result ? session.result.partial : false,
          error: session.error,
          progress: session.progress,
        });
      }

      if (sub === '/cancel') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Metode tidak diizinkan.' });
        if (!validSameOrigin(req)) return json(res, 403, { error: 'Origin tidak diizinkan.' });
        session.abortController.abort();
        return json(res, 202, { scanId: session.id, status: 'cancelling' });
      }

      if (sub === '/events') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Metode tidak diizinkan.' });
        res.writeHead(200, {
          ...securityHeaders(),
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.flushHeaders();
        const send = (event) => {
          if (res.destroyed) return;
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        };
        if (session.status !== 'scanning') {
          send({ type: session.status === 'ready' ? 'done' : session.status, status: session.status, totals: session.totals, partial: session.result ? session.result.partial : false });
          res.end();
          return;
        }
        send({ type: 'progress', progress: session.progress });
        const unsubscribe = session.subscribe((event) => {
          send(event);
          if (event.type === 'done' || event.type === 'cancelled' || event.type === 'error') {
            unsubscribe();
            res.end();
          }
        });
        const onClose = () => {
          unsubscribe();
        };
        res.on('close', onClose);
        return;
      }

      if (sub === '/tree' || sub.startsWith('/tree/')) {
        if (req.method !== 'GET') return json(res, 405, { error: 'Metode tidak diizinkan.' });
        if (session.status === 'error') return json(res, 500, { error: 'Pemindaian gagal.' });
        const nodeIdParam = sub.startsWith('/tree/') ? sub.slice('/tree/'.length) : 'root';
        const node = nodeIdParam === 'root' ? (session.liveRoot || (session.result && session.result.root)) : session.registry.get(nodeIdParam);
        if (!node) return json(res, 404, { error: 'Node tidak ditemukan.' });
        if (node.type !== 'dir') return json(res, 400, { error: 'Node bukan folder.' });
        return json(res, 200, {
          ...childrenPayload(session, node),
          status: session.status,
          partial: session.status === 'scanning' || (session.result && session.result.partial),
        });
      }

      if (sub === '/treemap') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Metode tidak diizinkan.' });
        if (session.status === 'error') return json(res, 500, { error: 'Pemindaian gagal.' });
        const nodeIdParam = reqUrl.searchParams.get('node') || 'root';
        const depth = Math.min(Math.max(Number(reqUrl.searchParams.get('depth')) || 2, 1), 4);
        const limit = Math.min(Math.max(Number(reqUrl.searchParams.get('limit')) || 12, 1), 40);
        const node = nodeIdParam === 'root'
          ? (session.liveRoot || (session.result && session.result.root))
          : session.registry.get(nodeIdParam);
        if (!node) return json(res, 404, { error: 'Node tidak ditemukan.' });
        return json(res, 200, {
          ...treemapPayload(session, node, depth, limit),
          status: session.status,
          partial: session.status === 'scanning' || (session.result && session.result.partial),
        });
      }

      if (sub === '/summary') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Metode tidak diizinkan.' });
        if (session.status === 'scanning') return json(res, 409, { error: 'Pemindaian belum selesai.' });
        if (session.status === 'error') return json(res, 500, { error: 'Pemindaian gagal.' });
        const root = session.result.root;
        const driveTotal = session.totals.sizeBytes || 0;
        return json(res, 200, {
          totals: session.totals,
          totalsHuman: sizeHuman(session.totals.sizeBytes),
          partial: session.result.partial,
          timedOut: session.result.timedOut,
          skipped: session.result.skipped,
          durationMs: session.result.durationMs,
          extensions: session.result.extensions.slice(0, 30).map((row) => ({
            ...row,
            sizeHuman: sizeHuman(row.sizeBytes),
            percent: percentOf(row.sizeBytes, driveTotal),
          })),
          topFolders: collectTop(root, 'dir', driveTotal, 12),
          topFiles: collectTop(root, 'file', driveTotal, 12),
        });
      }

      return json(res, 404, { error: 'Endpoint tidak ditemukan.' });
    }

    return json(res, 404, { error: 'Endpoint tidak ditemukan.' });
  };

  return http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const routePath = reqUrl.pathname;

      if (routePath.startsWith('/api/')) {
        await handleApi(req, res, routePath, reqUrl);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: 'Metode tidak diizinkan.' });
        return;
      }
      await serveStatic(req, res);
    } catch (error) {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      if (statusCode === 413) return json(res, 413, { error: 'Permintaan terlalu besar.' });
      if (statusCode === 400) return json(res, 400, { error: 'Format permintaan tidak valid.' });
      return json(res, 500, { error: 'Terjadi kesalahan server.' });
    }
  });
}

/**
 * Flatten the tree and return the largest nodes of a given type, annotated with
 * their share of the drive. Dirs exclude the root itself so the list stays
 * actionable.
 */
function collectTop(root, type, driveTotal, limit) {
  const rows = [];
  const walk = (node, isRoot) => {
    if (!(isRoot && type === 'dir')) {
      if (node.type === type) {
        rows.push({
          id: node.id,
          name: node.name,
          displayPath: node.displayPath,
          sizeBytes: node.sizeBytes,
          fileCount: node.fileCount,
          subfolderCount: node.subfolderCount,
          lastModified: node.lastModified,
          percentDrive: percentOf(node.sizeBytes, driveTotal),
          risk: node.risk || 'unknown',
          guideId: node.guideId || null,
        });
      }
    }
    if (node.type === 'dir') {
      for (const child of node.children || []) walk(child, false);
    }
  };
  walk(root, true);
  rows.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return rows.slice(0, limit).map((row) => ({ ...row, sizeHuman: sizeHuman(row.sizeBytes) }));
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
      console.log(`Disk Usage Analyzer (read-only) berjalan di http://${resolveHost()}:${address.port}/`);
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
  collectTop,
  childrenPayload,
  treemapPayload,
  ScanSession,
  SessionStore,
  nodeId,
  toDisplayPath,
};
