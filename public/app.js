'use strict';

/* global window, document, fetch, EventSource */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  roots: [],
  scanId: null,
  rootMeta: null,
  status: 'idle',
  totals: { sizeBytes: 0, fileCount: 0, subfolderCount: 0 },
  driveTotalBytes: 0,
  // Tree navigation uses a stack of node ids. "root" is a virtual entry.
  stack: [{ id: 'root', name: 'Root', displayPath: '' }],
  current: null,
  children: [],
  childrenById: new Map(),
  expanded: new Set(),
  loadingNodes: new Set(),
  sort: 'size-desc',
  filterPath: '',
  filterMinSize: 0,
  eventSource: null,
};

const RISK_LABEL = {
  'safe-cache': 'Aman Dibersihkan (Cache)',
  review: 'Perlu Ditinjau',
  protected: 'Jangan Dihapus',
  unknown: 'Tidak Diketahui',
};

const CATEGORY_LABEL = {
  temporary: 'Sementara',
  'package-cache': 'Cache Paket',
  'browser-cache': 'Cache Browser',
  'application-data': 'Data Aplikasi',
  'build-cache': 'Cache Build',
  'development-sdk': 'SDK Development',
  'docker-storage': 'Penyimpanan Docker',
  'windows-system': 'Sistem Windows',
  applications: 'Aplikasi',
  'browser-profile': 'Profil Browser',
  'personal-data': 'Data Pribadi',
  'user-data': 'Data Pengguna',
  unknown: 'Tidak Diketahui',
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value) || 0);
}

function formatPercent(value) {
  return `${(Number(value) || 0).toFixed(1)}%`;
}

function formatDate(ms) {
  if (!ms) return '—';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms));
  } catch {
    return '—';
  }
}

function riskBadge(risk) {
  const key = RISK_LABEL[risk] ? risk : 'unknown';
  return `<span class="badge risk-${key}">${escapeHtml(RISK_LABEL[key])}</span>`;
}

function riskColor(risk) {
  switch (risk) {
    case 'safe-cache': return '#16a34a';
    case 'review': return '#d97706';
    case 'protected': return '#dc2626';
    default: return '#64748b';
  }
}

function showToast(message) {
  // Lightweight, non-blocking feedback for copy actions.
  const node = document.createElement('div');
  node.textContent = message;
  node.style.cssText = [
    'position:fixed', 'bottom:1.5rem', 'left:50%', 'transform:translateX(-50%)',
    'background:#0f172a', 'color:#fff', 'padding:0.6rem 1rem', 'border-radius:8px',
    'z-index:9999', 'font-size:0.85rem', 'box-shadow:0 8px 24px rgba(0,0,0,0.3)',
  ].join(';');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(path, options) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

async function loadRoots() {
  const select = el('root-select');
  try {
    const data = await api('/api/roots');
    state.roots = data.roots || [];
    select.innerHTML = state.roots
      .map((root) => `<option value="${escapeHtml(root.id)}">${escapeHtml(root.name)} — ${escapeHtml(root.displayPath)}</option>`)
      .join('');
    if (state.roots.length === 0) {
      select.innerHTML = '<option value="">Tidak ada drive terdeteksi</option>';
    }
  } catch (error) {
    select.innerHTML = '<option value="">Gagal memuat drive</option>';
    showToast(`Gagal memuat drive: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Scan lifecycle
// ---------------------------------------------------------------------------

async function startScan() {
  const rootId = el('root-select').value;
  if (!rootId) {
    showToast('Pilih drive terlebih dahulu.');
    return;
  }
  closeEventStream();
  resetTree();
  setScanning(true);
  try {
    const data = await api('/api/scans', {
      method: 'POST',
      body: JSON.stringify({ rootId }),
    });
    state.scanId = data.scanId;
    state.rootMeta = data.root;
    state.stack = [{ id: 'root', name: data.root.displayPath || data.root.name, displayPath: data.root.displayPath }];
    openEventStream(data.scanId);
  } catch (error) {
    setScanning(false);
    showToast(`Gagal memulai pemindaian: ${error.message}`);
  }
}

function openEventStream(scanId) {
  const source = new EventSource(`/api/scans/${scanId}/events`);
  state.eventSource = source;

  source.addEventListener('progress', (event) => {
    const payload = JSON.parse(event.data);
    updateProgress(payload.progress);
    scheduleLiveTreeRefresh();
  });

  source.addEventListener('tree', () => {
    scheduleLiveTreeRefresh();
  });

  source.addEventListener('done', async (event) => {
    const payload = JSON.parse(event.data);
    state.status = 'ready';
    state.totals = payload.totals || state.totals;
    setScanning(false);
    closeEventStream();
    if (state.liveRefreshTimer) {
      clearTimeout(state.liveRefreshTimer);
      state.liveRefreshTimer = null;
    }
    await Promise.all([loadTree('root'), loadSummary()]);
  });

  source.addEventListener('cancelled', () => {
    state.status = 'cancelled';
    setScanning(false);
    closeEventStream();
    if (state.liveRefreshTimer) {
      clearTimeout(state.liveRefreshTimer);
      state.liveRefreshTimer = null;
    }
    showToast('Pemindaian dibatalkan.');
  });

  source.addEventListener('error', () => {
    // EventSource fires "error" both for server events and transport issues.
    if (state.status === 'ready' || state.status === 'cancelled') return;
    if (source.readyState === EventSource.CLOSED) {
      setScanning(false);
      showToast('Koneksi progres terputus.');
    }
  });
}

function closeEventStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

async function cancelScan() {
  if (!state.scanId) return;
  try {
    await api(`/api/scans/${state.scanId}/cancel`, { method: 'POST' });
    showToast('Membatalkan pemindaian...');
  } catch (error) {
    showToast(`Gagal membatalkan: ${error.message}`);
  }
}

function scheduleLiveTreeRefresh() {
  if (state.status !== 'scanning') return;
  if (state.liveRefreshTimer) return;
  state.liveRefreshTimer = setTimeout(async () => {
    state.liveRefreshTimer = null;
    try {
      await refreshLiveTree();
    } catch {
      // Transient during scan; the next tick retries.
    }
  }, 700);
}

async function refreshLiveTree() {
  if (!state.scanId || state.status !== 'scanning') return;
  // Reload the currently visible node's children live, keeping the user's
  // expanded set so a refresh never collapses folders the user opened.
  const visibleNodeId = state.current ? state.current.id : 'root';
  const data = await api(`/api/scans/${state.scanId}/tree/${visibleNodeId}`);
  state.children = data.children || [];
  state.childrenById.set(visibleNodeId, state.children);
  state.driveTotalBytes = data.driveTotalBytes || state.driveTotalBytes;
  state.current = data.parent;
  // Invalidate cached expanded subtrees so they also refresh.
  for (const key of [...state.childrenById.keys()]) {
    if (key !== visibleNodeId && state.expanded.has(key)) state.childrenById.delete(key);
  }
  renderTree();
  await Promise.all([...state.expanded].map((id) => loadChildren(id).catch(() => null)));
  renderTree();
}

function updateProgress(progress) {
  const text = el('progress-text');
  if (!progress) return;
  text.textContent = `Memindai... ${formatNumber(progress.dirsScanned)} folder, `
    + `${formatNumber(progress.filesScanned)} file, ${formatBytes(progress.bytesScanned)}`
    + (progress.currentPath ? ` — ${progress.currentPath}` : '');
}

function setScanning(isScanning) {
  el('scan-btn').disabled = isScanning;
  el('cancel-btn').hidden = !isScanning;
  el('progress-banner').hidden = !isScanning;
  el('progress-cancel').hidden = !isScanning;
  if (isScanning) {
    state.status = 'scanning';
    el('progress-text').textContent = 'Memulai pemindaian...';
  }
}

function resetTree() {
  state.children = [];
  state.childrenById = new Map();
  state.current = null;
  state.expanded = new Set();
  state.loadingNodes = new Set();
  if (state.liveRefreshTimer) {
    clearTimeout(state.liveRefreshTimer);
    state.liveRefreshTimer = null;
  }
  el('tree-tbody').innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:2rem;">Memindai...</td></tr>';
  el('treemap-canvas').innerHTML = '<div style="color:var(--muted);padding:2rem;margin:auto;">Memindai...</div>';
}

// ---------------------------------------------------------------------------
// Tree rendering
// ---------------------------------------------------------------------------

async function loadTree(nodeId) {
  if (!state.scanId) return;
  try {
    const data = await api(`/api/scans/${state.scanId}/tree/${nodeId}`);
    if (nodeId === 'root') {
      state.current = data.parent;
      state.children = data.children || [];
      state.childrenById = new Map([['root', state.children]]);
      state.driveTotalBytes = data.driveTotalBytes || 0;
      state.stack = [{ id: 'root', name: data.parent.displayPath || data.parent.name, displayPath: data.parent.displayPath }];
      renderTree();
    }
    return data;
  } catch (error) {
    showToast(`Gagal memuat folder: ${error.message}`);
    return null;
  }
}

async function loadChildren(nodeId) {
  if (state.childrenById.has(nodeId)) return state.childrenById.get(nodeId);
  const data = await api(`/api/scans/${state.scanId}/tree/${nodeId}`);
  const children = data.children || [];
  state.childrenById.set(nodeId, children);
  return children;
}

function sortRows(rows) {
  const list = [...rows];
  switch (state.sort) {
    case 'size-asc': return list.sort((a, b) => a.sizeBytes - b.sizeBytes);
    case 'files-desc': return list.sort((a, b) => b.fileCount - a.fileCount);
    case 'folders-desc': return list.sort((a, b) => b.subfolderCount - a.subfolderCount);
    case 'percent-desc': return list.sort((a, b) => b.percentDrive - a.percentDrive);
    case 'name-asc': return list.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    case 'date-desc': return list.sort((a, b) => b.lastModified - a.lastModified);
    case 'size-desc':
    default: return list.sort((a, b) => b.sizeBytes - a.sizeBytes);
  }
}

function matchesFilter(row) {
  if (state.filterMinSize && row.sizeBytes < state.filterMinSize) return false;
  if (state.filterPath) {
    const needle = state.filterPath.toLowerCase();
    if (!row.name.toLowerCase().includes(needle)
      && !(row.displayPath || '').toLowerCase().includes(needle)) {
      return false;
    }
  }
  return true;
}

function renderTree() {
  const tbody = el('tree-tbody');
  const rows = [];
  const appendVisible = (items, depth) => {
    for (const row of sortRows(items)) {
      if (!matchesFilter(row)) continue;
      rows.push({ ...row, depth });
      if (row.type === 'dir' && state.expanded.has(row.id)) {
        appendVisible(state.childrenById.get(row.id) || [], depth + 1);
      }
    }
  };
  appendVisible(state.children, 0);

  el('tree-up-btn').disabled = state.stack.length <= 1;
  el('tree-path-crumb').textContent = state.current
    ? `${state.current.displayPath}  (${formatBytes(state.current.sizeBytes)}, ${formatNumber(state.current.fileCount)} file)`
    : 'Root';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:2rem;">Tidak ada item yang cocok.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const isDir = row.type === 'dir';
    const canExpand = isDir && row.subfolderCount + row.fileCount > 0;
    const expanded = state.expanded.has(row.id);
    const indicator = canExpand ? (expanded ? '−' : '+') : '';
    return `
      <tr data-id="${escapeHtml(row.id)}" data-type="${row.type}">
        <td>
          <div class="tree-row-name" style="padding-left: ${expanded ? 0 : 0}px;">
            <span style="display:inline-block;width:${row.depth * 1.25}rem;"></span>
            <button type="button" class="tree-expander" data-expand="${escapeHtml(row.id)}" ${canExpand ? '' : 'disabled'} aria-label="Expand">${indicator}</button>
            <span title="${escapeHtml(row.displayPath)}">${isDir ? '📁' : '📄'} ${escapeHtml(row.name)}</span>
          </div>
        </td>
        <td>${formatBytes(row.sizeBytes)}</td>
        <td>${formatPercent(row.percentParent)}</td>
        <td>${formatPercent(row.percentDrive)}</td>
        <td>${isDir ? formatNumber(row.items) : '—'}</td>
        <td>${formatNumber(row.fileCount)}</td>
        <td>${isDir ? formatNumber(row.subfolderCount) : '—'}</td>
        <td>${formatDate(row.lastModified)}</td>
        <td>${riskBadge(row.risk)}</td>
        <td>${row.guideId ? `<button type="button" class="guide-link" data-guide-node="${escapeHtml(row.id)}">${escapeHtml(row.guideId)}</button>` : '—'}</td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', (event) => {
      if (event.target.closest('[data-expand]')) return;
      openDetail(tr.dataset.id);
    });
  });

  tbody.querySelectorAll('[data-expand]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleExpand(button.dataset.expand);
    });
  });
  tbody.querySelectorAll('[data-guide-node]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openDetail(button.dataset.guideNode);
    });
  });
}

async function toggleExpand(nodeId) {
  if (state.expanded.has(nodeId)) {
    state.expanded.delete(nodeId);
    renderTree();
    return;
  }
  if (state.loadingNodes.has(nodeId)) return;
  state.loadingNodes.add(nodeId);
  try {
    await loadChildren(nodeId);
    state.expanded.add(nodeId);
    renderTree();
  } catch (error) {
    showToast(`Gagal memuat subfolder: ${error.message}`);
  } finally {
    state.loadingNodes.delete(nodeId);
  }
}

async function drillInto(nodeId) {
  try {
    const data = await api(`/api/scans/${state.scanId}/tree/${nodeId}`);
    state.current = data.parent;
    state.children = data.children || [];
    state.childrenById = new Map([[nodeId, state.children]]);
    state.stack.push({ id: nodeId, name: data.parent.name, displayPath: data.parent.displayPath });
    state.expanded = new Set();
    renderTree();
  } catch (error) {
    showToast(`Gagal membuka folder: ${error.message}`);
  }
}

async function goUp() {
  if (state.stack.length <= 1) return;
  state.stack.pop();
  const parent = state.stack[state.stack.length - 1];
  const data = await api(`/api/scans/${state.scanId}/tree/${parent.id}`);
  state.current = data.parent;
  state.children = data.children || [];
  state.childrenById = new Map([[parent.id, state.children]]);
  state.expanded = new Set();
  renderTree();
}

function findRow(nodeId) {
  for (const list of state.childrenById.values()) {
    const found = list.find((item) => item.id === nodeId);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------

async function openDetail(nodeId) {
  const row = findRow(nodeId);
  if (!row) return;
  const modal = el('folder-modal');
  el('modal-title').textContent = row.name;
  const body = el('modal-body');
  body.innerHTML = '<p>Memuat detail...</p>';
  modal.hidden = false;

  const guidePromise = row.guideId ? api(`/api/guides/${row.guideId}`).catch(() => null) : Promise.resolve(null);
  const guide = await guidePromise;

  const detailRows = [
    ['Path Lengkap', row.displayPath],
    ['Tipe', row.type === 'dir' ? 'Folder' : 'File'],
    ['Ukuran', `${formatBytes(row.sizeBytes)} (${formatPercent(row.percentDrive)} dari drive)`],
    ['Jumlah File', formatNumber(row.fileCount)],
    ['Jumlah Subfolder', row.type === 'dir' ? formatNumber(row.subfolderCount) : '—'],
    ['Items Langsung', row.type === 'dir' ? formatNumber(row.items) : '—'],
    ['Modifikasi Terakhir', formatDate(row.lastModified)],
    ['Klasifikasi', `${RISK_LABEL[row.risk] || row.risk} (${CATEGORY_LABEL[row.category] || row.category})`],
  ];

  body.innerHTML = `
    <table class="tree-table" style="width:100%; margin-bottom:1rem;">
      <tbody>
        ${detailRows.map(([label, value]) => `<tr><th style="width:180px;">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
      ${row.type === 'dir' ? `<button type="button" id="modal-drill">Buka Folder Ini di Tree</button>` : ''}
    </div>
    <div id="modal-guide" style="margin-top:1rem;"></div>
  `;

  const drill = el('modal-drill');
  if (drill) {
    drill.addEventListener('click', () => {
      modal.hidden = true;
      drillInto(row.id);
    });
  }

  const guideBox = el('modal-guide');
  if (guide) {
    guideBox.innerHTML = renderGuide(guide, row);
    wireGuideCopy(guideBox);
  } else {
    guideBox.innerHTML = `<div class="badge risk-${row.risk || 'unknown'}">${escapeHtml(RISK_LABEL[row.risk] || 'Tidak Diketahui')}</div>
      <p style="color:var(--muted);font-size:0.9rem;">${escapeHtml(row.reason || 'Tidak ada panduan pembersihan khusus untuk path ini.')}</p>`;
  }
}

function renderGuide(guide, row) {
  const commands = (guide.commands || []).map((command) => `
    <div class="code-wrap">
      <button type="button" class="copy-btn" data-copy="${escapeHtml(command)}">Salin</button>
      <code>${escapeHtml(command)}</code>
    </div>`).join('');

  return `
    <h3 style="margin-bottom:0.5rem;">${escapeHtml(guide.title || 'Panduan Pembersihan')}</h3>
    <div style="margin-bottom:0.75rem;">${riskBadge(row.risk)} <span style="color:var(--muted);font-size:0.85rem;">${escapeHtml(guide.category || '')}</span></div>
    <p style="font-size:0.9rem;">${escapeHtml(guide.description || '')}</p>
    ${commands}
    <p style="color:var(--muted);font-size:0.8rem;">Aplikasi tidak mengeksekusi perintah ini. Salin dan jalankan sendiri di terminal.</p>
  `;
}

function wireGuideCopy(container) {
  container.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        showToast('Perintah disalin ke clipboard.');
      } catch {
        showToast('Gagal menyalin. Salin manual dari kotak kode.');
      }
    });
  });
}

function closeModal() {
  el('folder-modal').hidden = true;
}

// ---------------------------------------------------------------------------
// Summary dashboards
// ---------------------------------------------------------------------------

async function loadSummary() {
  try {
    const data = await api(`/api/scans/${state.scanId}/summary`);
    state.totals = data.totals || state.totals;
    renderTopFolders(data.topFolders || []);
    renderTopFiles(data.topFiles || []);
    renderExtensions(data.extensions || []);
  } catch (error) {
    showToast(`Gagal memuat ringkasan: ${error.message}`);
  }
}

function renderTopFolders(rows) {
  const tbody = el('top-folders-tbody');
  tbody.innerHTML = rows.length
    ? rows.map((row) => `
      <tr data-id="${escapeHtml(row.id)}" data-type="dir">
        <td title="${escapeHtml(row.displayPath)}">📁 ${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.sizeHuman || formatBytes(row.sizeBytes))}</td>
        <td>${formatPercent(row.percentDrive)}</td>
        <td>${riskBadge(row.risk)}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:var(--muted);">Belum ada data.</td></tr>';
  tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => drillInto(tr.dataset.id));
  });
}

function renderTopFiles(rows) {
  const tbody = el('top-files-tbody');
  tbody.innerHTML = rows.length
    ? rows.map((row) => `
      <tr data-id="${escapeHtml(row.id)}" data-type="file">
        <td title="${escapeHtml(row.displayPath)}">📄 ${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.sizeHuman || formatBytes(row.sizeBytes))}</td>
        <td>${formatPercent(row.percentDrive)}</td>
        <td>${formatDate(row.lastModified)}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:var(--muted);">Belum ada data.</td></tr>';
}

function renderExtensions(rows) {
  const tbody = el('extension-tbody');
  tbody.innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.extension)}</td>
        <td>${escapeHtml(row.sizeHuman || formatBytes(row.sizeBytes))}</td>
        <td>${formatPercent(row.percent)}</td>
        <td>${formatNumber(row.fileCount)}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:var(--muted);">Belum ada data.</td></tr>';
}

// ---------------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------------

async function loadTreemap(nodeId = 'root') {
  try {
    const data = await api(`/api/scans/${state.scanId}/treemap?node=${encodeURIComponent(nodeId)}&depth=2&limit=14`);
    renderTreemap(data);
  } catch (error) {
    showToast(`Gagal memuat treemap: ${error.message}`);
  }
}

function renderTreemap(data) {
  const canvas = el('treemap-canvas');
  const nodes = (data.nodes || []).filter((node) => node.depth === 1);
  if (nodes.length === 0) {
    canvas.innerHTML = '<div style="color:var(--muted);padding:2rem;margin:auto;">Tidak ada data treemap.</div>';
    return;
  }
  const total = nodes.reduce((sum, node) => sum + node.sizeBytes, 0) || 1;

  canvas.innerHTML = nodes.map((node) => {
    const share = node.sizeBytes / total;
    // Area-proportional flex sizing; keep a floor so tiny blocks stay clickable.
    const flexGrow = Math.max(Math.round(share * 1000), 20);
    const flexBasis = `${Math.max(share * 100, 8)}%`;
    const minHeight = `${Math.max(Math.sqrt(share) * 320, 70)}px`;
    const color = riskColor(node.risk);
    return `
      <div class="treemap-node" data-id="${escapeHtml(node.id)}"
           style="flex:${flexGrow} 1 ${flexBasis}; background:${color}; min-height:${minHeight};"
           title="${escapeHtml(node.displayPath)} — ${formatBytes(node.sizeBytes)} (${formatPercent(node.percentDrive)})">
        <span style="font-weight:600;">${node.type === 'dir' ? '📁' : '📄'} ${escapeHtml(node.name)}</span>
        <span>${formatBytes(node.sizeBytes)} · ${formatPercent(node.percentDrive)}</span>
      </div>`;
  }).join('');

  canvas.querySelectorAll('.treemap-node').forEach((block) => {
    block.addEventListener('click', () => {
      const node = nodes.find((item) => item.id === block.dataset.id);
      if (node && node.type === 'dir') {
        drillInto(node.id);
        switchTab('tree');
      } else {
        openDetailById(node);
      }
    });
  });
}

function openDetailById(node) {
  if (!node) return;
  state.childrenById.set('detail', [node]);
  openDetail(node.id);
}

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

async function loadGuides() {
  const container = el('guides-container');
  try {
    const data = await api('/api/guides');
    const guides = data.guides || [];
    if (guides.length === 0) {
      container.innerHTML = '<p style="color:var(--muted);">Belum ada panduan terdaftar.</p>';
      return;
    }
    container.innerHTML = guides.map((guide) => `
      <div class="dash-card" style="margin-bottom:1rem; box-shadow:none;">
        <h4 style="margin-top:0;">${escapeHtml(guide.title)}</h4>
        <p style="font-size:0.9rem;color:var(--muted);">${escapeHtml(guide.description || '')}</p>
        ${(guide.commands || []).map((command) => `
          <div class="code-wrap">
            <button type="button" class="copy-btn" data-copy="${escapeHtml(command)}">Salin</button>
            <code>${escapeHtml(command)}</code>
          </div>`).join('')}
      </div>`).join('');
    wireGuideCopy(container);
  } catch (error) {
    container.innerHTML = `<p style="color:var(--danger);">Gagal memuat panduan: ${escapeHtml(error.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Tabs & events
// ---------------------------------------------------------------------------

function switchTab(name) {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${name}`);
  });
  if (name === 'treemap' && state.scanId && (state.status === 'ready' || state.status === 'scanning')) {
    const focus = state.current ? state.current.id : 'root';
    loadTreemap(focus);
  }
}

function wireEvents() {
  el('scan-btn').addEventListener('click', startScan);
  el('cancel-btn').addEventListener('click', cancelScan);
  el('progress-cancel').addEventListener('click', cancelScan);
  el('tree-up-btn').addEventListener('click', goUp);

  el('tree-sort-select').addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderTree();
  });

  el('filter-path').addEventListener('input', (event) => {
    state.filterPath = event.target.value.trim();
    renderTree();
  });

  el('filter-min-size').addEventListener('change', (event) => {
    state.filterMinSize = Number(event.target.value) || 0;
    renderTree();
  });

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  el('modal-close').addEventListener('click', closeModal);
  el('modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  wireEvents();
  loadRoots();
  loadGuides();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
