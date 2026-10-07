'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createContext, runInContext } = require('node:vm');

const appCode = readFileSync(join(__dirname, '..', 'public', 'app.js'), 'utf-8');

function createElementStub() {
  const node = {
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    children: [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    addEventListener: () => {},
    removeEventListener: () => {},
    appendChild: () => {},
    querySelectorAll: () => [],
    closest: () => null,
  };
  return node;
}

function createDOMStub() {
  const elements = new Map();

  function getEl(id) {
    if (!elements.has(id)) elements.set(id, createElementStub());
    return elements.get(id);
  }

  const document = {
    readyState: 'loading',
    getElementById: getEl,
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    createElement: () => createElementStub(),
    body: createElementStub(),
  };

  const window = {
    navigator: { clipboard: { writeText: async () => {} } },
    EventSource: class { constructor() { this.readyState = 2; } addEventListener() {} close() {} },
    fetch: (...args) => stub.fetchImpl(...args),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Promise,
    Map,
    Set,
    Object,
    Array,
    JSON,
    Error,
    console,
    decodeURIComponent,
    encodeURIComponent,
    escape,
    unescape,
  };

  const stub = { document, window, elements, fetchImpl: null };
  return stub;
}

function loadApp(stub, exportNames) {
  const sandbox = {
    ...stub.window,
    document: stub.document,
    window: stub.window,
    navigator: stub.window.navigator,
    EventSource: stub.window.EventSource,
    fetch: stub.window.fetch,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Map,
    Set,
    Object,
    Array,
    JSON,
    Error,
    Date,
    decodeURIComponent,
    encodeURIComponent,
    escape,
    unescape,
  };
  sandbox.globalThis = sandbox;
  const ctx = createContext(sandbox);
  const exportList = exportNames.join(', ');
  runInContext(appCode + `\n;globalThis.__exports = { ${exportList} };`, ctx);
  return ctx.__exports;
}

test('frontend: sortRows orders by size desc by default', async () => {
  const stub = createDOMStub();
  const { sortRows, state } = loadApp(stub, ['sortRows', 'state']);
  const rows = [
    { sizeBytes: 100, fileCount: 2, subfolderCount: 0, percentDrive: 10, name: 'b', lastModified: 0 },
    { sizeBytes: 500, fileCount: 1, subfolderCount: 0, percentDrive: 20, name: 'a', lastModified: 0 },
    { sizeBytes: 300, fileCount: 5, subfolderCount: 0, percentDrive: 5, name: 'c', lastModified: 0 },
  ];
  const sorted = sortRows(rows);
  assert.deepEqual([...sorted.map((r) => r.sizeBytes)], [500, 300, 100]);
});

test('frontend: sortRows supports all sort modes', async () => {
  const stub = createDOMStub();
  const { sortRows, state } = loadApp(stub, ['sortRows', 'state']);
  const rows = [
    { sizeBytes: 100, fileCount: 2, subfolderCount: 3, percentDrive: 10, name: 'b', lastModified: 1000 },
    { sizeBytes: 500, fileCount: 1, subfolderCount: 0, percentDrive: 20, name: 'a', lastModified: 2000 },
    { sizeBytes: 300, fileCount: 5, subfolderCount: 1, percentDrive: 5, name: 'c', lastModified: 1500 },
  ];

  state.sort = 'size-asc';
  assert.deepEqual([...sortRows(rows).map((r) => r.sizeBytes)], [100, 300, 500]);

  state.sort = 'files-desc';
  assert.deepEqual([...sortRows(rows).map((r) => r.fileCount)], [5, 2, 1]);

  state.sort = 'folders-desc';
  assert.deepEqual([...sortRows(rows).map((r) => r.subfolderCount)], [3, 1, 0]);

  state.sort = 'percent-desc';
  assert.deepEqual([...sortRows(rows).map((r) => r.percentDrive)], [20, 10, 5]);

  state.sort = 'name-asc';
  assert.deepEqual([...sortRows(rows).map((r) => r.name)], ['a', 'b', 'c']);

  state.sort = 'date-desc';
  assert.deepEqual([...sortRows(rows).map((r) => r.lastModified)], [2000, 1500, 1000]);
});

test('frontend: renderTree produces expand indicator and guidance link', async () => {
  const stub = createDOMStub();
  const { renderTree, state, el } = loadApp(stub, ['renderTree', 'state', 'el']);

  state.children = [
    { id: 'n1', name: 'FolderA', type: 'dir', displayPath: 'C:\\FolderA', sizeBytes: 1000, fileCount: 5, subfolderCount: 2, items: 7, depth: 0, lastModified: 0, risk: 'safe-cache', category: 'temporary', guideId: 'windows-temp', percentParent: 100, percentDrive: 50 },
    { id: 'n2', name: 'file.txt', type: 'file', displayPath: 'C:\\file.txt', sizeBytes: 200, fileCount: 1, subfolderCount: 0, items: 0, depth: 0, lastModified: 0, risk: 'unknown', category: 'unknown', guideId: null, percentParent: 20, percentDrive: 10 },
  ];
  state.childrenById = new Map();
  state.childrenById.set('root', state.children);
  state.current = { displayPath: 'C:\\', sizeBytes: 1200, fileCount: 6 };
  state.driveTotalBytes = 2000;
  state.stack = [{ id: 'root', name: 'Root', displayPath: 'C:\\' }];
  state.expanded = new Set();
  state.filterPath = '';
  state.filterMinSize = 0;

  renderTree();
  const tbody = el('tree-tbody');
  const html = tbody.innerHTML;

  assert.ok(html.includes('tree-expander'), 'expand button present');
  assert.ok(html.includes('+'), 'collapsed indicator + present');
  assert.ok(html.includes('guide-link'), 'guidance link present');
  assert.ok(html.includes('windows-temp'), 'guideId rendered');
  assert.ok(html.includes('file.txt'));
});

test('frontend: renderTree expands/collapses children via state.expanded', async () => {
  const stub = createDOMStub();
  const { renderTree, state, el } = loadApp(stub, ['renderTree', 'state', 'el']);

  state.children = [
    { id: 'dirA', name: 'A', type: 'dir', displayPath: 'C:\\A', sizeBytes: 100, fileCount: 1, subfolderCount: 1, items: 2, depth: 0, lastModified: 0, risk: 'unknown', category: 'unknown', guideId: null, percentParent: 100, percentDrive: 50 },
  ];
  state.childrenById = new Map();
  state.childrenById.set('root', state.children);
  state.childrenById.set('dirA', [
    { id: 'dirA-sub', name: 'sub', type: 'dir', displayPath: 'C:\\A\\sub', sizeBytes: 50, fileCount: 1, subfolderCount: 0, items: 1, depth: 1, lastModified: 0, risk: 'unknown', category: 'unknown', guideId: null, percentParent: 50, percentDrive: 25 },
  ]);
  state.current = { displayPath: 'C:\\', sizeBytes: 100, fileCount: 1 };
  state.driveTotalBytes = 200;
  state.stack = [{ id: 'root', name: 'Root', displayPath: 'C:\\' }];
  state.expanded = new Set();
  state.filterPath = '';
  state.filterMinSize = 0;

  renderTree();
  let html = el('tree-tbody').innerHTML;
  assert.ok(html.includes('+'), 'collapsed shows +');
  assert.ok(!html.includes('sub'), 'child not rendered when collapsed');

  state.expanded.add('dirA');
  renderTree();
  html = el('tree-tbody').innerHTML;
  assert.ok(html.includes('−'), 'expanded shows −');
  assert.ok(html.includes('sub'), 'child rendered when expanded');

  state.expanded.delete('dirA');
  renderTree();
  html = el('tree-tbody').innerHTML;
  assert.ok(html.includes('+'));
  assert.ok(!html.includes('sub'));
});

test('frontend: wireGuideCopy copies command text via clipboard and toasts success', async () => {
  const stub = createDOMStub();
  let copiedText = null;
  stub.window.navigator.clipboard.writeText = async (text) => { copiedText = text; };
  const { wireGuideCopy, state } = loadApp(stub, ['wireGuideCopy', 'state']);

  // Create fake buttons with the same API as querySelectorAll('[data-copy]').
  const buttons = ['del /q test', 'Remove-Item test'].map((cmd) => {
    const el = { dataset: { copy: cmd }, addEventListener: (type, handler) => { el._handler = handler; } };
    return el;
  });

  const container = {
    querySelectorAll: (sel) => {
      assert.equal(sel, '[data-copy]');
      return buttons;
    },
  };

  wireGuideCopy(container);
  // wireGuideCopy registers handlers only — it never executes a command itself.
  assert.equal(buttons.length, 2);
  assert.ok(typeof buttons[0]._handler === 'function', 'click handler registered');

  // Click first copy button: must copy its text to clipboard, no exec.
  await buttons[0]._handler();
  assert.equal(copiedText, 'del /q test');
});

test('frontend: renderGuide renders copy buttons and commands', async () => {
  const stub = createDOMStub();
  const { renderGuide, riskBadge } = loadApp(stub, ['renderGuide', 'riskBadge']);

  const guide = {
    title: 'Test Guide',
    description: 'Description',
    commands: ['del /q /s %TEMP%\\*', 'Remove-Item -Recurse -Force $env:TEMP\\*'],
    category: 'temporary',
    risk: 'safe-cache',
  };
  const row = { risk: 'safe-cache', category: 'temporary', reason: 'test' };
  const html = renderGuide(guide, row);

  assert.ok(html.includes('Test Guide'));
  assert.ok(html.includes('Description'));
  assert.ok(html.includes('del /q /s %TEMP%\\*'));
  assert.ok(html.includes('Remove-Item'));
  assert.ok(html.includes('Salin'));
});

test('frontend: matchesFilter filters by path and min size', async () => {
  const stub = createDOMStub();
  const { matchesFilter, state } = loadApp(stub, ['matchesFilter', 'state']);

  state.filterPath = '';
  state.filterMinSize = 0;
  assert.ok(matchesFilter({ name: 'a', displayPath: 'C:\\a', sizeBytes: 10 }));

  state.filterMinSize = 100;
  assert.ok(!matchesFilter({ name: 'a', displayPath: 'C:\\a', sizeBytes: 50 }));
  assert.ok(matchesFilter({ name: 'a', displayPath: 'C:\\a', sizeBytes: 150 }));

  state.filterMinSize = 0;
  state.filterPath = 'cache';
  assert.ok(matchesFilter({ name: 'cache', displayPath: 'C:\\cache', sizeBytes: 10 }));
  assert.ok(matchesFilter({ name: 'file', displayPath: 'C:\\cache\\file', sizeBytes: 10 }));
  assert.ok(!matchesFilter({ name: 'other', displayPath: 'C:\\other', sizeBytes: 10 }));
});

test('frontend: live refresh preserves expanded nodes and updates children', async () => {
  const stub = createDOMStub();
  const { refreshLiveTree, state, loadChildren, el } = loadApp(stub, ['refreshLiveTree', 'state', 'loadChildren', 'el']);

  state.expanded = new Set(['dirA']);
  state.children = [
    { id: 'dirA', name: 'A', type: 'dir', displayPath: 'C:\\A', sizeBytes: 100, fileCount: 1, subfolderCount: 1, items: 2, depth: 0, lastModified: 0, risk: 'unknown', category: 'unknown', guideId: null, percentParent: 100, percentDrive: 50 },
  ];
  state.childrenById = new Map();
  state.childrenById.set('root', state.children);
  state.childrenById.set('dirA', [
    { id: 'dirA-sub', name: 'sub', type: 'dir', displayPath: 'C:\\A\\sub', sizeBytes: 50, fileCount: 1, subfolderCount: 0, items: 1, depth: 1, lastModified: 0, risk: 'unknown', category: 'unknown', guideId: null, percentParent: 50, percentDrive: 25 },
  ]);
  state.current = { id: 'root', displayPath: 'C:\\', sizeBytes: 100, fileCount: 1 };
  state.driveTotalBytes = 200;
  state.stack = [{ id: 'root', name: 'Root', displayPath: 'C:\\' }];
  state.scanId = 'test-scan';
  state.status = 'scanning';

  // Mock fetch so `api()` returns updated children with a new sibling B.
  stub.fetchImpl = async (url) => ({
    ok: true,
    text: async () => JSON.stringify(url.includes('/tree/root') ? {
      parent: { id: 'root', displayPath: 'C:\\', sizeBytes: 230, fileCount: 2 },
      children: [
        { id: 'dirA', name: 'A', type: 'dir', displayPath: 'C:\\A', sizeBytes: 150, fileCount: 1, subfolderCount: 1, items: 2, depth: 0, lastModified: 0, risk: 'unknown', category: 'unknown', guideId: null, percentParent: 65.2, percentDrive: 65.2 },
        { id: 'dirB', name: 'B', type: 'dir', displayPath: 'C:\\B', sizeBytes: 80, fileCount: 1, subfolderCount: 0, items: 1, depth: 0, lastModified: 0, risk: 'unknown', category: 'unknown', guideId: null, percentParent: 34.8, percentDrive: 34.8 },
      ],
      driveTotalBytes: 230,
    } : { children: [] }),
  });

  await refreshLiveTree();
  assert.ok(state.expanded.has('dirA'), 'expanded set preserved');
  const rootChildren = state.childrenById.get('root');
  assert.ok([...rootChildren].some((c) => c.name === 'B'), 'new sibling B appears');
});