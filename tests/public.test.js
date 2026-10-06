'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.join(__dirname, '..', 'public', 'app.js');
const HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');

const wait = () => new Promise((resolve) => setImmediate(resolve));

class Element {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this._children = [];
    this._textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.className = '';
    this.listeners = new Map();
  }

  // Mirror the browser: element.children is a read-only HTMLCollection whose
  // length cannot be assigned. Exposing a plain writable array here would hide
  // strict-mode TypeError bugs in app.js.
  get children() {
    return { length: this._children.length, item: (i) => this._children[i] };
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this._children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
    this._children = [];
  }

  appendChild(child) {
    this._children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  setAttribute(name, value) {
    if (!this.attributes) this.attributes = {};
    this.attributes[String(name)] = String(value);
  }

  getAttribute(name) {
    if (!this.attributes) return null;
    const key = String(name);
    return Object.prototype.hasOwnProperty.call(this.attributes, key)
      ? this.attributes[key]
      : null;
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  focus() {
    // handled externally or via document.activeElement if passed/scoped
  }
}

function makeDocument() {
  const elements = new Map();
  const buttonIds = new Set([
    'refresh-button',
    'modal-close',
    'mark-cleaned-button',
  ]);
  const ids = [
    'refresh-button',
    'scan-status',
    'results-panel',
    'guide-panel',
    'results-content',
    'grand-total',
    'empty-state',
    'folder-list',
    'sort-toggle',
    'hide-zero-toggle',
    'hidden-chip',
    'tab-results',
    'tab-guide',
    'folder-modal',
    'modal-backdrop',
    'modal-title',
    'modal-body',
    'modal-close',
    'scan-delta',
    'mark-cleaned-button',
    'cleaned-status',
  ];
  const listeners = new Map();
  const doc = {
    activeElement: null,
    elements,
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tagName) {
      const el = new Element('', tagName);
      el.focus = function focus() { doc.activeElement = el; };
      return el;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
  };
  for (const id of ids) {
    const tag = id.startsWith('tab-') || buttonIds.has(id) ? 'button' : 'div';
    const el = new Element(id, tag);
    el.focus = function focus() { doc.activeElement = el; };
    elements.set(id, el);
  }
  return doc;
}

function response(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    },
  };
}

// Map-backed localStorage mock mirroring the browser API surface used by
// app.js. Pass a shared `store` Map to let two loadApp() calls share state
// (needed to exercise preference persistence across reloads).
function makeLocalStorage(store) {
  const data = store instanceof Map ? store : new Map();
  return {
    get length() {
      return data.size;
    },
    getItem(key) {
      const name = String(key);
      return data.has(name) ? data.get(name) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
    clear() {
      data.clear();
    },
    key(index) {
      const keys = Array.from(data.keys());
      const i = Number(index);
      return i >= 0 && i < keys.length ? keys[i] : null;
    },
  };
}

function loadApp(fetchStub, store, opts) {
  const document = makeDocument();
  const localStorage = makeLocalStorage(store);
  const mockNow = opts && typeof opts.now === 'number' ? opts.now : null;
  var RealDate = Date;
  var MockDate = mockNow != null
    ? function MockDate(arg) {
        if (arg !== undefined) return new RealDate(arg);
        return new RealDate(mockNow);
      }
    : RealDate;
  if (mockNow != null) {
    MockDate.now = function () { return mockNow; };
    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;
    MockDate.prototype = RealDate.prototype;
  }
  const context = vm.createContext({
    document,
    window: { document, localStorage },
    localStorage,
    fetch: fetchStub,
    console,
    setTimeout,
    clearTimeout,
    Date: MockDate,
  });
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'EventSource')) {
    context.EventSource = opts.EventSource;
  }
  vm.runInContext(fs.readFileSync(APP_PATH, 'utf8'), context, { filename: APP_PATH });
  document.dispatchEvent({ type: 'DOMContentLoaded' });
  return { document, window: context.window, localStorage };
}

const readyPayload = {
  entries: [
    {
      name: 'Local\\Temp',
      path: 'C:\\Users\\alice\\AppData\\Local\\Temp',
      fileCount: 2,
      sizeBytes: 2048,
      sizeHuman: '2.0 KB',
      status: 'ready',
    },
  ],
  scannedAt: '2026-09-29T10:05:00+07:00',
  partial: false,
};

const sortPayload = {
  entries: [
    // Intentionally reversed: small first so that payload insertion order
    // differs from the desired descending-size order. RED should show
    // Windows\\Temp first; GREEN (sorted) should show Local\\Temp first.
    { name: 'Windows\\Temp', path: 'C:\\Windows\\Temp', group: 'temp', fileCount: 10, sizeBytes: 741376, sizeHuman: '724 KB', status: 'ready' },
    { name: 'Local\\Temp', path: 'C:\\Local\\Temp', group: 'temp', fileCount: 50, sizeBytes: 2362232012, sizeHuman: '2.2 GB', status: 'ready' },
  ],
  scannedAt: '2026-09-29T10:05:00+07:00',
  partial: false,
};

const hideZeroPayload = {
  entries: [
    { name: 'Local\\Temp', path: 'C:\\Local\\Temp', group: 'temp', fileCount: 50, sizeBytes: 2362232012, sizeHuman: '2.2 GB', status: 'ready' },
    { name: 'Windows\\Temp', path: 'C:\\Windows\\Temp', group: 'temp', fileCount: 10, sizeBytes: 741376, sizeHuman: '724 KB', status: 'ready' },
    ...Array.from({ length: 12 }, (_, i) => ({
      name: 'zero-' + (i + 1),
      path: 'C:\\Zero' + (i + 1),
      group: 'temp',
      fileCount: 0,
      sizeBytes: 0,
      sizeHuman: '0 B',
      status: 'ready',
    })),
  ],
  scannedAt: '2026-09-29T10:05:00+07:00',
  partial: false,
};

// ---------------------------------------------------------------------------
// Scenario 1: auto-scan once on page load
// ---------------------------------------------------------------------------
describe('scenario 1: auto-scan on page load', () => {
  it('fetches /api/scan exactly once on DOMContentLoaded', async () => {
    const calls = [];
    loadApp(async (url) => {
      calls.push(url);
      return response(readyPayload);
    });
    await wait();
    assert.deepEqual(calls, ['/api/scan']);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: refresh loading state
// ---------------------------------------------------------------------------
describe('scenario 2: loading state during scan', () => {
  it('disables the button and shows "Memindai…" while scanning, then restores', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { document } = loadApp(async () => {
      await gate;
      return response(readyPayload);
    });
    await wait();

    const button = document.getElementById('refresh-button');
    button.click();
    await wait();

    assert.equal(button.disabled, true);
    assert.match(button.textContent, /Memindai/);

    release();
    await wait();
    await wait();

    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Pindai Ulang');
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: rapid refresh race safety
// ---------------------------------------------------------------------------
describe('scenario 3: race safety', () => {
  it('renders the result of the last-sent requestId, not the last-completed', async () => {
    const pending = [];
    let call = 0;
    const { document } = loadApp((url) => {
      const id = ++call;
      return new Promise((resolve) => {
        pending.push({ id, resolve });
      });
    });
    await wait(); // auto-scan => request 1

    const button = document.getElementById('refresh-button');
    button.click(); // request 2
    button.click(); // request 3 (last sent)

    assert.equal(pending.length, 3);

    // Complete in reverse order: 3 first, then 2, then 1.
    const byId = (id) => pending.find((p) => p.id === id);
    byId(3).resolve(
      response({
        entries: [
          { name: 'third', path: 'C:\\third', fileCount: 3, sizeBytes: 300, sizeHuman: '300 B', status: 'ready' },
        ],
        partial: false,
      }),
    );
    await wait();
    byId(2).resolve(
      response({
        entries: [
          { name: 'second', path: 'C:\\second', fileCount: 2, sizeBytes: 200, sizeHuman: '200 B', status: 'ready' },
        ],
        partial: false,
      }),
    );
    await wait();
    byId(1).resolve(
      response({
        entries: [
          { name: 'first', path: 'C:\\first', fileCount: 1, sizeBytes: 100, sizeHuman: '100 B', status: 'ready' },
        ],
        partial: false,
      }),
    );
    await wait();

    const results = document.getElementById('results-content').textContent;
    assert.match(results, /third/);
    assert.doesNotMatch(results, /second/);
    assert.doesNotMatch(results, /first/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Panduan tab
// ---------------------------------------------------------------------------
describe('scenario 4: guide tab', () => {
  it('renders safe-deletion prose and no explorer/exec affordances', async () => {
    const { document } = loadApp(async () => response(readyPayload));
    await wait();

    const tabGuide = document.getElementById('tab-guide');
    tabGuide.click();

    assert.equal(document.getElementById('guide-panel').hidden, false);
    assert.equal(document.getElementById('results-panel').hidden, true);

    const guide = document.getElementById('guide-panel').textContent;
    assert.match(guide, /Panduan Hapus Aman/);
    assert.match(guide, /Windows\\Temp/i);
    assert.match(guide, /Installer/);
    assert.match(guide, /14/);
    assert.match(guide, /Explorer/i);
    assert.doesNotMatch(guide, /Open in Explorer/i);
    assert.doesNotMatch(guide, /spawn|exec/i);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: distinct empty-state copy
// ---------------------------------------------------------------------------
describe('scenario 5: empty-state copy', () => {
  it('suggests Run as Administrator when all folders are access_denied', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'a', path: 'C:\\a', fileCount: 0, sizeBytes: 0, sizeHuman: '0 B', status: 'access_denied' },
          { name: 'b', path: 'C:\\b', fileCount: 0, sizeBytes: 0, sizeHuman: '0 B', status: 'access_denied' },
        ],
        partial: false,
      }),
    );
    await wait();
    assert.match(document.getElementById('empty-state').textContent, /Run as Administrator/i);
  });

  it('shows not-found copy when all folders are not_found', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'a', path: 'C:\\a', fileCount: 0, sizeBytes: 0, sizeHuman: '0 B', status: 'not_found' },
          { name: 'b', path: 'C:\\b', fileCount: 0, sizeBytes: 0, sizeHuman: '0 B', status: 'not_found' },
        ],
        partial: false,
      }),
    );
    await wait();
    assert.match(document.getElementById('empty-state').textContent, /Folder tidak ditemukan di sistem ini/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: partial scan lower-bound total
// ---------------------------------------------------------------------------
describe('scenario 6: partial scan lower-bound', () => {
  it('marks the grand total as a lower bound when partial is true', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'a', path: 'C:\\a', fileCount: 1, sizeBytes: 1024, sizeHuman: '1.0 KB', status: 'partial' },
          { name: 'b', path: 'C:\\b', fileCount: 1, sizeBytes: 1024, sizeHuman: '1.0 KB', status: 'ready' },
        ],
        partial: true,
      }),
    );
    await wait();
    const total = document.getElementById('grand-total').textContent;
    assert.match(total, /2\.0 KB/);
    assert.match(total, /≥/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: each entry renders exactly once (no duplicate lines)
// ---------------------------------------------------------------------------
describe('scenario 7: no duplicate rendering', () => {
  it('renders every entry name exactly once across results and folder list', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'Temp-A', path: 'C:\\temp-a', group: 'temp', fileCount: 2, sizeBytes: 2048, sizeHuman: '2.0 KB', status: 'ready' },
          { name: 'Logs-B', path: 'C:\\logs-b', group: 'logs', fileCount: 1, sizeBytes: 512, sizeHuman: '512 B', status: 'ready' },
        ],
        partial: false,
      }),
    );
    await wait();

    const results = document.getElementById('results-content').textContent;
    const folderList = document.getElementById('folder-list').textContent;

    for (const name of ['Temp-A', 'Logs-B']) {
      const occurrences = results.split(name).length - 1;
      assert.equal(occurrences, 1, `expected "${name}" exactly once in results-content`);
      assert.doesNotMatch(folderList, new RegExp(name), `legacy folder-list must not duplicate "${name}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: grouped card rendering
// ---------------------------------------------------------------------------
describe('scenario 8: grouped cards', () => {
  it('creates one group section per populated group with one card per entry', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 't1', path: 'C:\\t1', group: 'temp', fileCount: 1, sizeBytes: 10, sizeHuman: '10 B', status: 'ready' },
          { name: 't2', path: 'C:\\t2', group: 'temp', fileCount: 1, sizeBytes: 20, sizeHuman: '20 B', status: 'ready' },
          { name: 'l1', path: 'C:\\l1', group: 'logs', fileCount: 1, sizeBytes: 30, sizeHuman: '30 B', status: 'partial' },
        ],
        partial: true,
      }),
    );
    await wait();

    const results = document.elements.get('results-content');
    const groups = results.children.item(0) ? collectByClass(results, 'group') : [];
    assert.equal(groups.length, 2, 'expected one section per populated group (temp + logs)');

    const cards = collectByClass(results, 'card');
    assert.equal(cards.length, 3, 'expected one card per entry');

    // Status badges carry localized Indonesian labels, not raw enum strings.
    const badges = collectByClass(results, 'badge');
    assert.ok(badges.some((badge) => badge.textContent === 'Siap'));
    assert.ok(badges.some((badge) => badge.textContent === 'Sebagian'));
  });
});

function collectByClass(root, className) {
  const matches = [];
  const walk = (node) => {
    for (const child of childList(node)) {
      if (String(child.className || '').split(' ').includes(className)) matches.push(child);
      walk(child);
    }
  };
  walk(root);
  return matches;
}

function toggleCheckbox(el, desired) {
  if (el.checked === desired) return;
  el.checked = desired;
  el.dispatchEvent({ type: 'click', target: el });
  el.dispatchEvent({ type: 'change', target: el });
}

function childList(node) {
  // Test mock exposes children as a length/item shape like HTMLCollection.
  if (Array.isArray(node.children)) return node.children;
  const out = [];
  const length = (node.children && node.children.length) || 0;
  for (let index = 0; index < length; index += 1) {
    out.push(node.children.item(index));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scenario 9: folder modal opens on card click with commands
// ---------------------------------------------------------------------------
describe('scenario 9: folder modal', () => {
  it('opens modal with path and copyable command when a card is clicked', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          {
            name: 'Temp-A',
            path: 'C:\\temp-a',
            group: 'temp',
            fileCount: 2,
            sizeBytes: 2048,
            sizeHuman: '2.0 KB',
            status: 'ready',
          },
        ],
        partial: false,
      }),
    );
    await wait();

    const modal = document.getElementById('folder-modal');
    assert.ok(modal, 'folder-modal element should exist');
    assert.equal(modal.hidden, true, 'modal should start hidden');

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    assert.equal(cards.length, 1, 'one card rendered');

    // click the card to open modal
    cards[0].click();
    await wait();

    assert.equal(modal.hidden, false, 'modal should be visible after click');

    const title = document.getElementById('modal-title');
    assert.match(title.textContent, /Temp-A/);

    const body = document.getElementById('modal-body');
    assert.ok(body, 'modal-body element should exist');
    const bodyText = body.textContent;
    assert.match(bodyText, /C:\\temp-a/);
    assert.match(bodyText, /Get-ChildItem/);
    assert.match(bodyText, /del \/f \/s \/q/);
    assert.match(bodyText, /Disk Cleanup/);
    assert.match(bodyText, /Jangan disentuh/);

    // close via close button
    document.getElementById('modal-close').click();
    await wait();
    assert.equal(modal.hidden, true, 'modal should close after close button');
  });
});

// ---------------------------------------------------------------------------
// Rule R4: sort by size descending within group
// ---------------------------------------------------------------------------
describe('R4: sort by size descending within group', () => {
  it('renders the largest folder first within the Temp group', async () => {
    const { document } = loadApp(async () => response(sortPayload));
    await wait();

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    assert.equal(cards.length, 2, 'expected two cards in the Temp group');

    const names = cards.map((card) => collectByClass(card, 'card-name')[0].textContent);
    assert.deepEqual(names, ['Local\\Temp', 'Windows\\Temp']);
  });
});

// ---------------------------------------------------------------------------
// Rule R5: hide zero-byte folders + chip restore
// ---------------------------------------------------------------------------
describe('R5: hide zero-byte folders', () => {
  it('hides zero folders behind a chip and restores them on chip click', async () => {
    const { document } = loadApp(async () => response(hideZeroPayload));
    await wait();

    const results = document.elements.get('results-content');
    const cardsBefore = collectByClass(results, 'card');
    assert.equal(cardsBefore.length, 14, 'all 14 folders visible before toggling');

    const toggle = document.getElementById('hide-zero-toggle');
    assert.ok(toggle, 'hide-zero toggle should exist');
    toggleCheckbox(toggle, true);
    await wait();

    const cardsHidden = collectByClass(results, 'card');
    assert.equal(cardsHidden.length, 2, 'only the two non-zero folders remain visible');
    assert.doesNotMatch(results.textContent, /zero-1/);

    const chip = document.getElementById('hidden-chip');
    assert.ok(chip, 'hidden chip container should exist');
    assert.match(chip.textContent, /12 folder kosong disembunyikan/);

    // Chip click restores the hidden folders.
    chip.click();
    await wait();

    const cardsRestored = collectByClass(results, 'card');
    assert.equal(cardsRestored.length, 14, 'all folders restored after chip click');
    assert.match(results.textContent, /zero-1/);
    assert.doesNotMatch(chip.textContent, /folder kosong disembunyikan/);
  });
});

// ---------------------------------------------------------------------------
// Rule R6: preferences persist across reload
// ---------------------------------------------------------------------------
describe('R6: preferences persist across reload', () => {
  it('restores toggled preferences from localStorage in the next loadApp', async () => {
    const store = new Map();

    // First load: toggle hideZero ON and sort OFF, which persists to store.
    const first = loadApp(async () => response(hideZeroPayload), store);
    await wait();

    const hideZeroToggle = first.document.getElementById('hide-zero-toggle');
    const sortToggle = first.document.getElementById('sort-toggle');
    assert.ok(hideZeroToggle, 'hide-zero toggle must exist in first load');
    assert.ok(sortToggle, 'sort toggle must exist in first load');

    // Toggle hideZero ON (unchecked → checked) then sort OFF (checked → unchecked).
    toggleCheckbox(hideZeroToggle, true);
    await wait();
    toggleCheckbox(sortToggle, false);
    await wait();

    // Second load shares the same Map; it should restore hideZero ON and sort OFF.
    const second = loadApp(async () => response(hideZeroPayload), store);
    await wait();

    const secondHideZero = second.document.getElementById('hide-zero-toggle');
    const secondSort = second.document.getElementById('sort-toggle');
    assert.equal(secondHideZero.checked, true, 'hideZero persists across reload');
    assert.equal(secondSort.checked, false, 'sort persists across reload');

    const results = second.document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    // hideZero ON ⇒ only the two non-zero folders remain visible.
    assert.equal(cards.length, 2, 'hidden-zero state still applied after reload');
  });
});

// ---------------------------------------------------------------------------
// Rule R7: scan history (max 20, FIFO)
// ---------------------------------------------------------------------------
describe('R7: scan history FIFO', () => {
  it('stores up to 20 scans, dropping oldest (FIFO)', async () => {
    const store = new Map();
    let n = 0;
    const { window, localStorage } = loadApp(async () => {
      n += 1;
      return response({
        entries: [
          { name: 'x', path: 'C:\\x', group: 'temp', fileCount: 1, sizeBytes: n, sizeHuman: n + ' B', status: 'ready' },
        ],
        scannedAt: new Date(2026, 9, 2, 10, 0, n).toISOString(),
        partial: false,
      });
    }, store);
    await wait(); // auto-scan = scan #1

    // Trigger 20 more scans (total 21)
    for (let i = 0; i < 20; i++) {
      await window.cleanupScanner.scan();
      await wait();
    }

    const history = JSON.parse(localStorage.getItem('cleanupScanner.history.v1'));
    assert.equal(history.length, 20, 'history should keep max 20 entries');
    assert.equal(history[0].totalBytes, 2, 'oldest entry should be scan #2 (scan #1 dropped)');
    assert.equal(history[19].totalBytes, 21, 'newest entry should be scan #21');
  });
});

// ---------------------------------------------------------------------------
// Rule R8: delta vs last non-partial scan
// ---------------------------------------------------------------------------
describe('R8: delta vs last non-partial scan', () => {
  it('shows delta when a non-partial baseline exists in history', async () => {
    // 2.5 GiB baseline (non-partial), 1.1 GiB current → delta ~1.4 GiB
    const BASELINE_BYTES = 2684354560; // 2.5 * 1024^3
    const CURRENT_BYTES = 1181116006;  // 1.1 * 1024^3
    const DELTA_BYTES = BASELINE_BYTES - CURRENT_BYTES; // = 1.4 GiB
    const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
    const BASELINE_AT = new Date(NOW - 2 * 3600 * 1000).toISOString(); // 2 hours ago
    const CURRENT_AT = new Date(NOW).toISOString();

    const store = new Map();
    store.set('cleanupScanner.history.v1', JSON.stringify([
      { scannedAt: BASELINE_AT, totalBytes: BASELINE_BYTES, partial: false, entries: {} },
    ]));

    // Use a fetch that rejects so auto-scan doesn't pollute history
    const { document, window, localStorage } = loadApp(
      async () => { throw new Error('skip auto-scan'); },
      store,
      { now: NOW }
    );
    await wait();

    // Directly render the current scan
    window.cleanupScanner.renderScan({
      entries: [
        { name: 'x', path: 'C:\\x', group: 'temp', fileCount: 1, sizeBytes: CURRENT_BYTES, sizeHuman: '1.1 GB', status: 'ready' },
      ],
      scannedAt: CURRENT_AT,
      partial: false,
    });
    await wait();

    const deltaEl = document.getElementById('scan-delta');
    assert.ok(deltaEl, 'delta element should exist');
    const deltaText = deltaEl.textContent;
    assert.match(deltaText, /Turun/, 'delta should contain "Turun"');
    // sizeHuman(DELTA_BYTES) = 1.4 GB → rendered with Indonesian comma as 1,4 GB
    assert.match(deltaText, /1,4 GB/, 'delta should show human-readable drop size');
    assert.match(deltaText, /2 jam lalu/, 'delta should show relative time of baseline');
  });

  it('excludes partial scans from delta baseline', async () => {
    // History:
    // scan 1: partial (1.1 GB)
    // scan 2: ready (2.5 GB) - 2 hours ago
    // scan 3: ready (1.0 GB) - now
    // Expected delta: vs scan 2 (2.5 GB -> 1.0 GB) = Turun 1,5 GB
    const SCAN1_BYTES = 1181116006; // 1.1 GB
    const SCAN2_BYTES = 2684354560; // 2.5 GB
    const SCAN3_BYTES = 1073741824; // 1.0 GB
    const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
    const SCAN1_AT = new Date(NOW - 3 * 3600 * 1000).toISOString();
    const SCAN2_AT = new Date(NOW - 2 * 3600 * 1000).toISOString();
    const SCAN3_AT = new Date(NOW).toISOString();

    const store = new Map();
    store.set('cleanupScanner.history.v1', JSON.stringify([
      { scannedAt: SCAN1_AT, totalBytes: SCAN1_BYTES, partial: true, entries: {} },
      { scannedAt: SCAN2_AT, totalBytes: SCAN2_BYTES, partial: false, entries: {} },
    ]));

    const { document, window } = loadApp(
      async () => { throw new Error('skip auto-scan'); },
      store,
      { now: NOW }
    );
    await wait();

    window.cleanupScanner.renderScan({
      entries: [
        { name: 'x', path: 'C:\\x', group: 'temp', fileCount: 1, sizeBytes: SCAN3_BYTES, sizeHuman: '1.0 GB', status: 'ready' },
      ],
      scannedAt: SCAN3_AT,
      partial: false,
    });
    await wait();

    const deltaEl = document.getElementById('scan-delta');
    assert.ok(deltaEl, 'delta element should exist');
    const deltaText = deltaEl.textContent;
    assert.match(deltaText, /Turun 1,5 GB/, 'delta should be computed vs scan2 (ready, 2.5GB), ignoring scan1 (partial)');
    assert.match(deltaText, /2 jam lalu/, 'delta time should reflect scan2 time');
  });
});

// ---------------------------------------------------------------------------
// Rule R9: no delta on first scan
// ---------------------------------------------------------------------------
describe('R9: no delta on first scan', () => {
  it('shows only "Terakhir dipindai" and no delta when history is empty', async () => {
    const store = new Map();
    const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
    const CURRENT_AT = new Date(NOW).toISOString();
    const { document, window } = loadApp(
      async () => { throw new Error('skip auto-scan'); },
      store,
      { now: NOW }
    );
    await wait();

    window.cleanupScanner.renderScan({
      entries: [
        { name: 'x', path: 'C:\\x', group: 'temp', fileCount: 1, sizeBytes: 1073741824, sizeHuman: '1.0 GB', status: 'ready' },
      ],
      scannedAt: CURRENT_AT,
      partial: false,
    });
    await wait();

    const scanStatus = document.getElementById('scan-status');
    assert.match(scanStatus.textContent, /Terakhir dipindai/, 'scan status should show Terakhir dipindai');

    const deltaEl = document.getElementById('scan-delta');
    assert.ok(deltaEl, 'delta element should exist');
    assert.equal(deltaEl.textContent.trim(), '', 'delta should be empty when no baseline exists');
  });
});

// ---------------------------------------------------------------------------
// Rule R10: mark cleaned stores timestamp
// ---------------------------------------------------------------------------
describe('R10: mark cleaned stores timestamp', () => {
  it('sets cleanupScanner.lastCleanedAt to ISO time when button clicked', async () => {
    const store = new Map();
    const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
    const CURRENT_AT = new Date(NOW).toISOString();
    const { document, window, localStorage } = loadApp(
      async () => { throw new Error('skip auto-scan'); },
      store,
      { now: NOW }
    );
    await wait();

    window.cleanupScanner.renderScan({
      entries: [
        { name: 'x', path: 'C:\\x', group: 'temp', fileCount: 1, sizeBytes: 1073741824, sizeHuman: '1.0 GB', status: 'ready' },
      ],
      scannedAt: CURRENT_AT,
      partial: false,
    });
    await wait();

    const button = document.getElementById('mark-cleaned-button');
    assert.ok(button, 'mark cleaned button should exist');
    assert.equal(button.hidden, false, 'button should be visible after scan');

    button.click();
    await wait();

    const cleanedKey = localStorage.getItem('cleanupScanner.lastCleanedAt');
    assert.ok(cleanedKey, 'lastCleanedAt key should be set in localStorage');
    // Should be a valid ISO string matching the mocked time
    assert.match(cleanedKey, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // With mocked NOW = 2026-10-02T12:00:00.000Z
    assert.equal(cleanedKey, '2026-10-02T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Rule R11: cleaned timestamp displayed with relative time
// ---------------------------------------------------------------------------
describe('R11: cleaned timestamp displayed', () => {
  it('shows relative time of last cleaned when key exists', async () => {
    const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
    const TWO_HOURS_AGO = new Date(NOW - 2 * 3600 * 1000).toISOString();
    const store = new Map();
    store.set('cleanupScanner.lastCleanedAt', TWO_HOURS_AGO);

    const { document } = loadApp(
      async () => { throw new Error('skip auto-scan'); },
      store,
      { now: NOW }
    );
    await wait();

    const cleanedEl = document.getElementById('cleaned-status');
    assert.ok(cleanedEl, 'cleaned-status element should exist');
    assert.match(cleanedEl.textContent, /Terakhir dibersihkan: 2 jam lalu/);
  });
});

// ---------------------------------------------------------------------------
// Rule R10 edge: cleaned timestamp never affects scan or delta
// ---------------------------------------------------------------------------
describe('R10 edge: cleaned timestamp independence', () => {
  it('scan totals and delta are independent of lastCleanedAt', async () => {
    // Seed lastCleanedAt (5 hours ago) and a history baseline (2 hours ago, 2.5 GB)
    // Current scan = 1.0 GB,  delta should be vs 2.5 GB baseline (Turun 1,5 GB), not vs cleaned time
    const BASELINE_BYTES = 2684354560; // 2.5 GB
    const CURRENT_BYTES = 1073741824;  // 1.0 GB
    const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
    const CLEANED_AT = new Date(NOW - 5 * 3600 * 1000).toISOString(); // 5 hours ago
    const BASELINE_AT = new Date(NOW - 2 * 3600 * 1000).toISOString(); // 2 hours ago
    const CURRENT_AT = new Date(NOW).toISOString();

    const store = new Map();
    store.set('cleanupScanner.lastCleanedAt', CLEANED_AT);
    store.set('cleanupScanner.history.v1', JSON.stringify([
      { scannedAt: BASELINE_AT, totalBytes: BASELINE_BYTES, partial: false, entries: {} },
    ]));

    const { document, window } = loadApp(
      async () => { throw new Error('skip auto-scan'); },
      store,
      { now: NOW }
    );
    await wait();

    // Trigger a new scan - delta should be vs baseline (2.5 GB), not vs cleaned time
    window.cleanupScanner.renderScan({
      entries: [
        { name: 'x', path: 'C:\\x', group: 'temp', fileCount: 1, sizeBytes: CURRENT_BYTES, sizeHuman: '1.0 GB', status: 'ready' },
      ],
      scannedAt: CURRENT_AT,
      partial: false,
    });
    await wait();

    const deltaEl = document.getElementById('scan-delta');
    assert.ok(deltaEl, 'delta element should exist');
    const deltaText = deltaEl.textContent;
    assert.match(deltaText, /Turun 1,5 GB/, 'delta should be vs history baseline (2.5 GB -> 1.0 GB)');
    assert.match(deltaText, /2 jam lalu/, 'delta time should reflect baseline (2 hours ago), not cleaned time (5 hours ago)');

    // Grand total should show current scan's total (1.0 GB) unaffected by cleaned time
    const grandTotal = document.getElementById('grand-total');
    assert.match(grandTotal.textContent, /1\.0 GB/, 'grand total should show current scan total');
  });
});

// ---------------------------------------------------------------------------
// Rule R15: focus-trap modal
// ---------------------------------------------------------------------------
describe('R15: focus-trap modal', () => {
  it('opens modal and focuses close button (RED — no Tab wrap yet)', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'Temp-A', path: 'C:\\temp-a', group: 'temp', fileCount: 2, sizeBytes: 2048, sizeHuman: '2.0 KB', status: 'ready' },
        ],
        partial: false,
      }),
    );
    await wait();

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    assert.equal(cards.length, 1, 'one card rendered');
    cards[0].click();
    await wait();

    const modal = document.getElementById('folder-modal');
    assert.equal(modal.hidden, false, 'modal should be visible after click');
    const modalClose = document.getElementById('modal-close');
    const modalBody = document.getElementById('modal-body');
    assert.ok(modalClose, 'modal-close should exist');
    assert.ok(modalBody, 'modal-body should exist');
    assert.match(modalBody.textContent, /Salin/i);
    assert.equal(document.activeElement, modalClose, 'focus should move to close button on open');
  });

  it('wraps Tab from last focusable to first (RED — no trap yet)', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'Temp-A', path: 'C:\\temp-a', group: 'temp', fileCount: 2, sizeBytes: 2048, sizeHuman: '2.0 KB', status: 'ready' },
        ],
        partial: false,
      }),
    );
    await wait();

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    cards[0].click();
    await wait();

    const modal = document.getElementById('folder-modal');
    const modalClose = document.getElementById('modal-close');
    const modalBody = document.getElementById('modal-body');
    // Find copy buttons in modal body (they have class 'copy-button')
    const copyButtons = collectByClass(modalBody, 'copy-button');
    assert.ok(copyButtons.length >= 1, 'modal should have at least one copy button');
    const lastButton = copyButtons[copyButtons.length - 1];
    
    // Focus the last focusable element
    lastButton.focus();
    assert.equal(document.activeElement, lastButton, 'precondition: last element is focused');
    
    // Dispatch Tab keydown on the modal (simulates user pressing Tab on last element)
    modal.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: false, preventDefault() {} });
    
    // Should wrap to first focusable (close button)
    assert.equal(document.activeElement, modalClose, 'Tab from last should wrap to first (close button)');
  });

  it('wraps Shift+Tab from first focusable to last (RED — no trap yet)', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'Temp-A', path: 'C:\\temp-a', group: 'temp', fileCount: 2, sizeBytes: 2048, sizeHuman: '2.0 KB', status: 'ready' },
        ],
        partial: false,
      }),
    );
    await wait();

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    cards[0].click();
    await wait();

    const modal = document.getElementById('folder-modal');
    const modalClose = document.getElementById('modal-close');
    const modalBody = document.getElementById('modal-body');
    const copyButtons = collectByClass(modalBody, 'copy-button');
    assert.ok(copyButtons.length >= 1, 'modal should have at least one copy button');
    const lastButton = copyButtons[copyButtons.length - 1];
    
    // Focus the first focusable element (close button) - already focused on open
    modalClose.focus();
    assert.equal(document.activeElement, modalClose, 'precondition: first element is focused');
    
    // Dispatch Shift+Tab keydown on the modal
    modal.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true, preventDefault() {} });
    
    // Should wrap to last focusable
    assert.equal(document.activeElement, lastButton, 'Shift+Tab from first should wrap to last');
  });

  it('restores focus to trigger when modal closes with Escape (RED — restore not implemented)', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'Temp-A', path: 'C:\\temp-a', group: 'temp', fileCount: 2, sizeBytes: 2048, sizeHuman: '2.0 KB', status: 'ready' },
        ],
        partial: false,
      }),
    );
    await wait();

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    const card = cards[0];
    card.focus();
    assert.equal(document.activeElement, card, 'precondition: card is focused');
    
    card.click();
    await wait();

    const modal = document.getElementById('folder-modal');
    assert.equal(modal.hidden, false, 'modal should be open');
    
    // Close modal with Escape
    document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    
    assert.equal(modal.hidden, true, 'modal should be closed');
    assert.equal(document.activeElement, card, 'focus should be restored to the card');
  });
});

// ---------------------------------------------------------------------------
// Cycle 2: partial reason badge visible in modal [R17]
// ---------------------------------------------------------------------------
describe('R17: partial reason badge in modal', () => {
  it('shows "Alasan: timeout" in folder modal when entry has reason timeout', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'Local\\Temp', path: 'C:\\Local\\Temp', group: 'temp', fileCount: 5, sizeBytes: 1024, sizeHuman: '1.0 KB', status: 'partial', reason: 'timeout' },
        ],
        partial: true,
      }),
    );
    await wait();

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    assert.equal(cards.length, 1, 'one card rendered');
    cards[0].click();
    await wait();

    const modal = document.getElementById('folder-modal');
    assert.equal(modal.hidden, false, 'modal should be visible after click');
    const modalBody = document.getElementById('modal-body');
    assert.ok(modalBody, 'modal-body should exist');
    assert.match(modalBody.textContent, /Alasan: timeout/, 'modal should show reason badge for timeout');
    assert.ok(collectByClass(modalBody, 'reason-pill').length >= 1, 'reason-pill element should be present');
  });
});

// ---------------------------------------------------------------------------
// Cycle 3: reason badge for skipped and access_denied [R17 edge]
// ---------------------------------------------------------------------------
describe('R17 edge: skipped and access_denied reason badges', () => {
  it('shows "Alasan: skipped=15" in folder modal when entry has reason skipped=15', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'Local\\Temp', path: 'C:\\Local\\Temp', group: 'temp', fileCount: 5, sizeBytes: 1024, sizeHuman: '1.0 KB', status: 'partial', reason: 'skipped=15' },
        ],
        partial: true,
      }),
    );
    await wait();

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    assert.equal(cards.length, 1, 'one card rendered');
    cards[0].click();
    await wait();

    const modalBody = document.getElementById('modal-body');
    assert.ok(modalBody, 'modal-body should exist');
    assert.match(modalBody.textContent, /Alasan: skipped=15/, 'modal should show reason badge for skipped=15');
    assert.ok(collectByClass(modalBody, 'reason-pill').length >= 1, 'reason-pill element should be present');
  });

  it('shows "Alasan: access_denied" in folder modal when entry has reason access_denied', async () => {
    const { document } = loadApp(async () =>
      response({
        entries: [
          { name: 'Local\\Temp', path: 'C:\\Local\\Temp', group: 'temp', fileCount: 0, sizeBytes: 0, sizeHuman: '0 B', status: 'access_denied', reason: 'access_denied' },
        ],
        partial: true,
      }),
    );
    await wait();

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    assert.equal(cards.length, 1, 'one card rendered');
    cards[0].click();
    await wait();

    const modalBody = document.getElementById('modal-body');
    assert.ok(modalBody, 'modal-body should exist');
    assert.match(modalBody.textContent, /Alasan: access_denied/, 'modal should show reason badge for access_denied');
    assert.ok(collectByClass(modalBody, 'reason-pill').length >= 1, 'reason-pill element should be present');
  });
});

// ---------------------------------------------------------------------------
// Rule 4: app group is observation-only (uninstall via Settings, no delete cmds)
// ---------------------------------------------------------------------------
describe('R4: app group uninstall-only guidance', () => {
  const appPayload = {
    entries: [
      { name: 'D:\\Program', path: 'D:\\Program', group: 'app', fileCount: 12, sizeBytes: 1048576, sizeHuman: '1.0 MB', status: 'ready' },
      { name: 'D:\\Program Files', path: 'D:\\Program Files', group: 'app', fileCount: 30, sizeBytes: 2097152, sizeHuman: '2.0 MB', status: 'ready' },
    ],
    scannedAt: '2026-10-02T10:05:00+07:00',
    partial: false,
  };

  function openModalFor(document, name) {
    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    const card = cards.find((c) => {
      const nameCell = collectByClass(c, 'card-name')[0];
      return nameCell && nameCell.textContent === name;
    });
    assert.ok(card, `expected a rendered card for ${name}`);
    card.click();
    return document.getElementById('modal-body');
  }

  for (const name of ['D:\\Program', 'D:\\Program Files']) {
    it(`guides ${name} to uninstall via Windows Settings with no delete/copy command`, async () => {
      const { document } = loadApp(async () => response(appPayload));
      await wait();

      const modal = document.getElementById('folder-modal');
      const modalBody = openModalFor(document, name);
      await wait();

      assert.equal(modal.hidden, false, 'modal should be visible after clicking the app card');

      const bodyText = modalBody.textContent;
      // Guidance must point at Windows Settings uninstall, not file deletion.
      assert.match(bodyText, /Settings/i, 'app guide should mention Windows Settings');
      assert.match(bodyText, /Uninstall/i, 'app guide should tell the user to uninstall');

      // No destructive command, no copy affordance, no "Command siap salin" block.
      assert.doesNotMatch(bodyText, /Get-ChildItem|Remove-Item|del \/f \/s \/q|rd \/s/i,
        'app guide must not expose delete commands');
      assert.equal(collectByClass(modalBody, 'copy-button').length, 0,
        'app guide must not render any copy-command button');
      assert.doesNotMatch(bodyText, /Command siap salin/i,
        'app guide must not render the copyable-command section');
    });
  }

  it('keeps the existing delete guidance and copy commands for temp folders', async () => {
    const { document } = loadApp(async () => response(readyPayload));
    await wait();

    const modalBody = openModalFor(document, 'Local\\Temp');
    await wait();

    const bodyText = modalBody.textContent;
    assert.match(bodyText, /Get-ChildItem/, 'temp guide keeps its PowerShell command');
    assert.match(bodyText, /Command siap salin/i, 'temp guide keeps the copyable-command section');
    assert.ok(collectByClass(modalBody, 'copy-button').length >= 1,
      'temp guide keeps copy buttons');
  });
});

// ---------------------------------------------------------------------------
// T5 cycle 1: not_found hidden by default + reveal chip
// ---------------------------------------------------------------------------
const notFoundPayload = {
  entries: [
    ...Array.from({ length: 14 }, (_, i) => ({
      name: 'keep-' + (i + 1),
      path: 'C:\\keep-' + (i + 1),
      group: 'temp',
      fileCount: i + 1,
      sizeBytes: 1024 * (i + 1),
      sizeHuman: '1.0 KB',
      status: 'ready',
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      name: 'notfound-' + (i + 1),
      path: 'C:\\notfound-' + (i + 1),
      group: 'temp',
      fileCount: 0,
      sizeBytes: 0,
      sizeHuman: '0 B',
      status: 'not_found',
    })),
  ],
  scannedAt: '2026-10-06T10:00:00+07:00',
  partial: false,
};

describe('T5 cycle 1: not_found hidden by default with reveal chip', () => {
  it('hides the 4 not_found entries behind a chip and keeps 14 visible', async () => {
    const { document } = loadApp(async () => response(notFoundPayload));
    await wait();

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    assert.equal(cards.length, 14, 'only the 14 non-not_found entries should render');

    const chip = document.getElementById('hidden-chip');
    assert.match(chip.textContent, /4 folder disembunyikan \(tidak ditemukan\)/,
      'chip should announce the hidden not_found count');
    assert.match(String(chip.getAttribute('aria-label') || ''), /tidak ditemukan/i,
      'chip must expose an accessible label mentioning the hidden folders');

    const badges = collectByClass(results, 'badge');
    assert.ok(!badges.some((badge) => badge.textContent === 'Tidak ditemukan'),
      'no not_found badge should appear in the visible list');
    assert.doesNotMatch(results.textContent, /notfound-1/,
      'hidden not_found entries must not be rendered');
  });
});

// ---------------------------------------------------------------------------
// T5 cycle 2: reveal hidden not_found entries via chip
// ---------------------------------------------------------------------------
describe('T5 cycle 2: chip reveals not_found entries', () => {
  it('shows all 18 entries and not_found badges after clicking the chip', async () => {
    const { document } = loadApp(async () => response(notFoundPayload));
    await wait();

    const chip = document.getElementById('hidden-chip');
    assert.match(chip.textContent, /4 folder disembunyikan \(tidak ditemukan\)/);
    chip.click();
    await wait();

    const results = document.elements.get('results-content');
    assert.equal(collectByClass(results, 'card').length, 18,
      'all entries should be visible after revealing not_found folders');
    assert.equal(collectByClass(results, 'badge').filter((badge) => badge.textContent === 'Tidak ditemukan').length, 4,
      'all four revealed folders should show the not_found badge');
    assert.equal(chip.textContent, '', 'reveal chip should disappear when no entries remain hidden');
  });
});

// ---------------------------------------------------------------------------
// T5 cycle 3: only not_found is filterable
// ---------------------------------------------------------------------------
describe('T5 cycle 3: access_denied and partial are never hidden', () => {
  it('hides only not_found while access_denied and partial remain visible with badges', async () => {
    const payload = {
      entries: [
        { name: 'nf-1', path: 'C:\\nf-1', group: 'temp', fileCount: 0, sizeBytes: 0, status: 'not_found' },
        { name: 'nf-2', path: 'C:\\nf-2', group: 'temp', fileCount: 0, sizeBytes: 0, status: 'not_found' },
        { name: 'denied', path: 'C:\\denied', group: 'temp', fileCount: 0, sizeBytes: 0, status: 'access_denied', reason: 'access_denied' },
        { name: 'partial', path: 'C:\\partial', group: 'temp', fileCount: 1, sizeBytes: 64, status: 'partial', reason: 'timeout' },
      ],
      partial: true,
    };
    const { document } = loadApp(async () => response(payload));
    await wait();

    const results = document.elements.get('results-content');
    const cards = collectByClass(results, 'card');
    assert.equal(cards.length, 2, 'only the two not_found cards should be hidden');
    assert.match(results.textContent, /denied/);
    assert.match(results.textContent, /partial/);
    assert.doesNotMatch(results.textContent, /nf-1|nf-2/);
    const badges = collectByClass(results, 'badge');
    assert.ok(badges.some((badge) => badge.textContent === 'Akses ditolak'));
    assert.ok(badges.some((badge) => badge.textContent === 'Sebagian'));
  });
});

// ---------------------------------------------------------------------------
// T5 cycle 4: all-not_found empty state is paired with the reveal chip
// ---------------------------------------------------------------------------
describe('T5 cycle 4: empty state when all entries are not_found', () => {
  it('shows the empty message alongside a chip with the total hidden count', async () => {
    const store = new Map();
    store.set('cleanupScanner.prefs.v1', JSON.stringify({ hideNotFound: true }));
    const { document } = loadApp(async () => response({
      entries: [
        { name: 'nf-1', path: 'C:\\nf-1', group: 'temp', fileCount: 0, sizeBytes: 0, status: 'not_found' },
        { name: 'nf-2', path: 'C:\\nf-2', group: 'temp', fileCount: 0, sizeBytes: 0, status: 'not_found' },
        { name: 'nf-3', path: 'C:\\nf-3', group: 'temp', fileCount: 0, sizeBytes: 0, status: 'not_found' },
      ],
      partial: false,
    }), store);
    await wait();

    const results = document.getElementById('results-content');
    assert.equal(collectByClass(results, 'card').length, 0);
    assert.match(results.textContent, /Folder tidak ditemukan di sistem ini/,
      'empty state should explain all scanned folders were not found');
    assert.match(document.getElementById('hidden-chip').textContent,
      /3 folder disembunyikan \(tidak ditemukan\)/,
      'reveal chip should display the total hidden count next to the empty state');
  });
});

// ---------------------------------------------------------------------------
// T6: fallback entries remain visible with a warning badge
// ---------------------------------------------------------------------------
describe('T6 - fallback entries remain visible under hideNotFound', () => {
  it('shows a fallback not_found entry with the warning badge while hiding other not_found', async () => {
    const { document } = loadApp(async () => response({
      entries: [
        { name: 'Local\\Temp', path: 'C:\\Local\\Temp', group: 'temp', fileCount: 0, sizeBytes: 0, status: 'not_found', fallback: true },
        { name: 'Windows\\Temp', path: 'C:\\Windows\\Temp', group: 'temp', fileCount: 0, sizeBytes: 0, status: 'not_found' },
        { name: 'PerfLogs', path: 'C:\\PerfLogs', group: 'logs', fileCount: 0, sizeBytes: 0, status: 'not_found' },
      ],
      partial: true,
    }));
    await wait();

    const results = document.elements.get('results-content');
    assert.equal(collectByClass(results, 'card').length, 1,
      'only Local\\Temp (fallback) must survive the not_found filter');
    assert.match(results.textContent, /Local\\Temp/);
    assert.doesNotMatch(results.textContent, /Windows\\Temp|PerfLogs/);
    assert.match(results.textContent, /Fallback.*resolusi profil gagal/i,
      'fallback card must carry the warning badge text');
    const badgeEl = collectByClass(results, 'fallback-badge')[0];
    assert.ok(badgeEl, 'fallback-badge element must exist even when Local\\Temp is the sole survivor');
    const accessibleLabel = (badgeEl.textContent || '') + ' ' + String(badgeEl.getAttribute('aria-label') || '') + ' ' + String(badgeEl.getAttribute('title') || '');
    assert.match(accessibleLabel, /fallback.*resolusi profil gagal/i, 'fallback badge must expose accessible label');
  });

  it('excludes fallback entries from the "disembunyikan" hidden count', async () => {
    const { document } = loadApp(async () => response({
      entries: [
        { name: 'Local\\Temp', path: 'C:\\Local\\Temp', group: 'temp', fileCount: 0, sizeBytes: 0, status: 'not_found', fallback: true },
        { name: 'Windows\\Temp', path: 'C:\\Windows\\Temp', group: 'temp', fileCount: 0, sizeBytes: 0, status: 'not_found' },
        { name: 'PerfLogs', path: 'C:\\PerfLogs', group: 'logs', fileCount: 0, sizeBytes: 0, status: 'not_found' },
        { name: 'WER', path: 'C:\\WER', group: 'logs', fileCount: 0, sizeBytes: 0, status: 'not_found' },
      ],
      partial: true,
    }));
    await wait();

    const chip = document.getElementById('hidden-chip');
    assert.match(chip.textContent, /3 folder disembunyikan \(tidak ditemukan\)/,
      'hidden count must reflect exactly the two non-fallback not_found entries');
  });

  it('keeps hiding non-fallback not_found entries and exposes no fallback badge when no fallback is present', async () => {
    const { document } = loadApp(async () => response(notFoundPayload));
    await wait();

    const results = document.elements.get('results-content');
    assert.equal(collectByClass(results, 'card').length, 14,
      'all 14 ready entries must be visible behind the not_found filter');
    assert.equal(collectByClass(results, 'fallback-badge').length, 0,
      'no fallback badge outside fallback entries');
    const chip = document.getElementById('hidden-chip');
    assert.match(chip.textContent, /4 folder disembunyikan \(tidak ditemukan\)/, 'full non-fallback hidden count');
  });
});

// ---------------------------------------------------------------------------
// Static-asset guards (no exec/spawn, relative fetch, required markup)
// ---------------------------------------------------------------------------
describe('static asset guards', () => {
  it('index.html defines both tabs, refresh button, and status element', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.match(html, /id="refresh-button"/);
    assert.match(html, /id="scan-status"/);
    assert.match(html, /id="tab-results"/);
    assert.match(html, /id="tab-guide"/);
    assert.match(html, /id="results-panel"/);
    assert.match(html, /id="guide-panel"/);
    assert.match(html, /app\.js/);
  });

  it('public/ never uses exec/spawn or a hardcoded host:port', () => {
    const files = fs.readdirSync(path.join(__dirname, '..', 'public'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
      assert.doesNotMatch(content, /child_process|spawn\(|exec\(|execFile\(/);
      assert.doesNotMatch(content, /127\.0\.0\.1|localhost:\d|:\d{4,5}\/api/);
    }
    const app = fs.readFileSync(APP_PATH, 'utf8');
    assert.match(app, /fetch\(\s*['"]\/api\/scan['"]/);
  });
});

// ---------------------------------------------------------------------------
// Task T7: UI SSE streaming with GET /api/scan fallback (kept outside the
// static-asset guards so this file can be exercised before T7 implementation)
// ---------------------------------------------------------------------------
describe('scan SSE transport (client-side streaming)', () => {
  function makeDeferredResponse() {
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  function makeMockEventSourceClass(eventPlan, onCreate) {
    // Null-prototype data holder so hasOwnProperty doesn't interfere.
    return class MockEventSource {
      constructor(url) {
        this.url = url;
        this.listeners = new Map();
        this.closed = false;
        if (typeof onCreate === 'function') onCreate(this);
        // Deliver the plan on next tick so listeners can be attached first.
        setImmediate(() => {
          if (this.closed) return;
          for (const step of eventPlan) {
            if (this.closed) break;
            if (step.kind === 'folder' || step.kind === 'done') {
              const type = step.kind;
              const handlers = this.listeners.get(type) || [];
              const event = { data: JSON.stringify(step.payload) };
              handlers.slice().forEach((fn) => fn(event));
              if (typeof step.afterEmit === 'function') step.afterEmit(this);
            } else if (step.kind === 'error') {
              const handlers = this.listeners.get('error') || [];
              handlers.slice().forEach((fn) => fn(new Error('mock sse error')));
              if (typeof step.afterEmit === 'function') step.afterEmit(this);
            }
          }
        });
      }
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
      }
      removeEventListener(type, fn) {
        const cur = this.listeners.get(type) || [];
        const idx = cur.indexOf(fn);
        if (idx !== -1) cur.splice(idx, 1);
      }
      close() {
        this.closed = true;
      }
    };
  }

  it('Given folder+done frames When the stream runs Then cards render incrementally and finish', async () => {
    const folderA = { name: 'Local\\Temp', path: 'C:\\Local\\Temp', group: 'temp', fileCount: 2, sizeBytes: 2048, sizeHuman: '2.0 KB', status: 'ready' };
    const folderB = { name: 'Windows\\Temp', path: 'C:\\Windows\\Temp', group: 'temp', fileCount: 5, sizeBytes: 4096, sizeHuman: '4.0 KB', status: 'ready' };
    // Snapshot the results DOM immediately after each frame is delivered so we
    // can prove rendering is incremental (per folder event), not only on done.
    const snapshots = [];
    let appDocument;
    const captureAfterEmit = () => {
      const results = appDocument.getElementById('results-content').textContent;
      snapshots.push({
        results,
        disabled: appDocument.getElementById('refresh-button').disabled,
      });
    };
    const plan = [
      { kind: 'folder', payload: folderA, afterEmit: captureAfterEmit },
      { kind: 'folder', payload: folderB, afterEmit: captureAfterEmit },
      { kind: 'done', payload: { entries: [folderA, folderB], scannedAt: '2026-09-29T10:05:00+07:00', partial: false } },
    ];
    const MockEventSource = makeMockEventSourceClass(plan);
    const fetchCalls = [];
    const fetchStub = async (url) => {
      fetchCalls.push(url);
      return response({ entries: [], partial: false });
    };
    const { document } = loadApp(fetchStub, {}, { EventSource: MockEventSource });
    appDocument = document;
    await wait(); // DOMContentLoaded -> auto-scan opens EventSource
    await wait(); await wait(); await wait(); // let MockEventSource plan deliver

    // Incremental rendering: after the first folder frame only folder A exists.
    assert.equal(snapshots.length, 2, 'expected a snapshot after each folder frame');
    assert.match(snapshots[0].results, /Local\\Temp/, 'first folder frame must render its card immediately');
    assert.doesNotMatch(snapshots[0].results, /Windows\\Temp/, 'second folder must not render before its frame arrives');
    assert.equal(snapshots[0].disabled, true, 'scan must still be loading after the first folder frame');

    // After the second folder frame both cards are present, still loading.
    assert.match(snapshots[1].results, /Local\\Temp/);
    assert.match(snapshots[1].results, /Windows\\Temp/);
    assert.equal(snapshots[1].disabled, true, 'scan must still be loading until done arrives');

    const results = document.getElementById('results-content').textContent;
    assert.match(results, /Local\\Temp/);
    assert.match(results, /Windows\\Temp/);
    const scanStatus = document.getElementById('scan-status').textContent;
    assert.match(scanStatus, /Terakhir dipindai/, 'done payload should have finalized the render');
    const button = document.getElementById('refresh-button');
    assert.equal(button.disabled, false, 'loading state must be cleared after stream done');
    assert.deepEqual(fetchCalls, [], 'SSE path must not call fetch /api/scan when available');
  });

  it('Given a mid-stream error after folder frames When SSE emits error Then stream stops and loading clears without duplicate fetch', async () => {
    const folderA = { name: 'Local\\Temp', path: 'C:\\Local\\Temp', group: 'temp', fileCount: 2, sizeBytes: 2048, sizeHuman: '2.0 KB', status: 'ready' };
    const plan = [
      { kind: 'folder', payload: folderA },
      { kind: 'error' },
    ];
    const sources = [];
    const fetchCalls = [];
    const MockEventSource = makeMockEventSourceClass(plan, (source) => sources.push(source));
    const { document } = loadApp(
      async (url) => {
        fetchCalls.push(url);
        return response({ entries: [{ name: 'should-not-render', path: 'C:\\should-not-render', fileCount: 1, sizeBytes: 1, sizeHuman: '1 B', status: 'ready' }], scannedAt: '2026-09-29T10:05:00+07:00', partial: false });
      },
      {},
      { EventSource: MockEventSource },
    );
    await wait(); await wait(); await wait();
    assert.equal(sources.length, 1, 'the scan must open an EventSource before handling its error');
    assert.equal(sources[0].url, '/api/scan/stream');
    assert.equal(sources[0].closed, true, 'the failed EventSource must be closed');
    assert.deepEqual(fetchCalls, [], 'must not issue fallback fetch after partial folder progress');
    assert.equal(document.getElementById('refresh-button').disabled, false, 'must not leave permanent loading after SSE error');
  });

  it('Given EventSource is absent When a scan starts Then fallback fetch renders and clears loading', async () => {
    const { document } = loadApp(
      async (url) => {
        assert.equal(url, '/api/scan');
        return response({ entries: [{ name: 'fallback', path: 'C:\\fallback', fileCount: 1, sizeBytes: 100, sizeHuman: '100 B', status: 'ready' }], scannedAt: '2026-09-29T10:05:00+07:00', partial: false });
      },
      {},
      { EventSource: undefined },
    );
    await wait(); await wait();
    assert.match(document.getElementById('results-content').textContent, /fallback/);
    assert.match(document.getElementById('scan-status').textContent, /Terakhir dipindai/);
    assert.equal(document.getElementById('refresh-button').disabled, false);
  });

  it('Given a mid-stream error When SSE emits error Then fallback fetch renders and does not stay loading', async () => {
    const plan = [{ kind: 'error' }];
    const sources = [];
    const MockEventSource = makeMockEventSourceClass(plan, (source) => sources.push(source));
    const { document } = loadApp(
      async (url) => {
        assert.equal(url, '/api/scan');
        return response({ entries: [{ name: 'post-error', path: 'C:\\post-error', fileCount: 1, sizeBytes: 9, sizeHuman: '9 B', status: 'ready' }], scannedAt: '2026-09-29T10:05:00+07:00', partial: false });
      },
      {},
      { EventSource: MockEventSource },
    );
    await wait(); await wait(); await wait();
    assert.equal(sources.length, 1, 'the scan must open an EventSource before handling its error');
    assert.equal(sources[0].url, '/api/scan/stream');
    assert.equal(sources[0].closed, true, 'the failed EventSource must be closed before fallback');
    assert.match(document.getElementById('results-content').textContent, /post-error/);
    assert.equal(document.getElementById('refresh-button').disabled, false, 'must not leave permanent loading after SSE error fallback');
  });
});
