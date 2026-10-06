'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseScanRoots,
  applyHostMount,
  toContainerPath,
  toDisplayPath,
  getWhitelist,
  scanAll,
} = require('../server.js');

describe('default D: entries and grouping', () => {
  it('Given default roots When getWhitelist() resolves Then exactly one D:\\Temp (temp) and D:\\Program, D:\\Program Files (app) with exact Windows paths', async () => {
    const roots = await getWhitelist();
    const dTemp = roots.filter(r => r.path === 'D:\\Temp');
    const dProgram = roots.filter(r => r.path === 'D:\\Program');
    const dProgramFiles = roots.filter(r => r.path === 'D:\\Program Files');

    assert.equal(dTemp.length, 1, 'exactly one D:\\Temp entry');
    assert.equal(dTemp[0].group, 'temp');

    assert.equal(dProgram.length, 1, 'exactly one D:\\Program entry');
    assert.equal(dProgram[0].group, 'app');

    assert.equal(dProgramFiles.length, 1, 'exactly one D:\\Program Files entry');
    assert.equal(dProgramFiles[0].group, 'app');

    assert.equal(roots.filter(r => r.path.toLowerCase() === 'd:\\tmp').length, 0, 'no duplicate lowercase tmp');
  });

  it('Given SCAN_HOST_MOUNT=\'{"c":"/mnt/c"}\' and HOST_USER=jane, When getWhitelist builds Local\\Temp entry, Then path = /mnt/c/Users/jane/AppData/Local/Temp and displayPath = C:\\Users\\jane\\AppData\\Local\\Temp', async () => {
    const previousMount = process.env.SCAN_HOST_MOUNT;
    const previousUser = process.env.HOST_USER;
    const previousLocal = process.env.LOCALAPPDATA;
    process.env.SCAN_HOST_MOUNT = '{"c":"/mnt/c"}';
    process.env.HOST_USER = 'jane';
    // Docker Compose derives LOCALAPPDATA from HOST_USER for the container.
    process.env.LOCALAPPDATA = `C:\\Users\\${process.env.HOST_USER}\\AppData\\Local`;
    try {
      const roots = await getWhitelist();
      const localTemp = roots.find(r => r.name === 'Local\\Temp');
      assert.ok(localTemp, 'Local\\Temp entry exists');
      assert.equal(localTemp.path, '/mnt/c/Users/jane/AppData/Local/Temp');
      assert.equal(localTemp.displayPath, 'C:\\Users\\jane\\AppData\\Local\\Temp');
      assert.equal(localTemp.fallback, false);
    } finally {
      if (previousMount === undefined) delete process.env.SCAN_HOST_MOUNT;
      else process.env.SCAN_HOST_MOUNT = previousMount;
      if (previousUser === undefined) delete process.env.HOST_USER;
      else process.env.HOST_USER = previousUser;
      if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocal;
    }
  });

  it('Given default roots When scanAll() runs with fixture Then D: entries carry exact paths and app group', async () => {
    const missing = async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      throw error;
    };
    const body = await scanAll({ fs: { lstat: missing }, now: () => 0, timeoutMs: 30_000 });
    const dTemp = body.entries.find(e => e.path === 'D:\\Temp');
    const dProgram = body.entries.find(e => e.path === 'D:\\Program');
    const dProgramFiles = body.entries.find(e => e.path === 'D:\\Program Files');

    assert.ok(dTemp, 'D:\\Temp must exist in scan results');
    assert.equal(dTemp.group, 'temp');

    assert.ok(dProgram, 'D:\\Program must exist in scan results');
    assert.equal(dProgram.group, 'app');

    assert.ok(dProgramFiles, 'D:\\Program Files must exist in scan results');
    assert.equal(dProgramFiles.group, 'app');
  });
});

describe('parseScanRoots', () => {
  it('returns null when the value is absent or empty', () => {
    assert.equal(parseScanRoots(undefined), null);
    assert.equal(parseScanRoots(''), null);
    assert.equal(parseScanRoots(null), null);
  });

  it('parses a JSON array of {name, path, group, displayPath}', () => {
    const raw = JSON.stringify([
      { name: 'Local\\Temp', path: '/mnt/c/Users/x/AppData/Local/Temp', group: 'temp' },
      { name: 'Windows\\Temp', path: '/mnt/c/Windows/Temp', displayPath: 'C:\\Windows\\Temp' },
    ]);

    assert.deepEqual(parseScanRoots(raw), [
      { name: 'Local\\Temp', path: '/mnt/c/Users/x/AppData/Local/Temp', group: 'temp' },
      { name: 'Windows\\Temp', path: '/mnt/c/Windows/Temp', displayPath: 'C:\\Windows\\Temp' },
    ]);
  });

  it('drops entries missing name or path and ignores non-string optional fields', () => {
    const raw = JSON.stringify([
      { name: 'valid', path: '/tmp/valid', group: 42, displayPath: false },
      { name: 'missing-path' },
      { path: '/tmp/missing-name' },
      'not-an-object',
      null,
    ]);

    assert.deepEqual(parseScanRoots(raw), [{ name: 'valid', path: '/tmp/valid' }]);
  });

  it('returns null for invalid JSON, non-arrays, and arrays without valid entries', () => {
    assert.equal(parseScanRoots('{not json'), null);
    assert.equal(parseScanRoots('"a string"'), null);
    assert.equal(parseScanRoots('{"name":"x","path":"/y"}'), null);
    assert.equal(parseScanRoots('[]'), null);
    assert.equal(parseScanRoots('[{"foo":1}]'), null);
  });
});

describe('host mount remapping', () => {
  it('converts Windows drive paths into container mount paths', () => {
    assert.equal(toContainerPath('C:\\Windows\\Temp', '/mnt/c'), '/mnt/c/Windows/Temp');
    assert.equal(toContainerPath('C:/Windows/Temp', '/mnt/c'), '/mnt/c/Windows/Temp');
    assert.equal(toContainerPath('D:\\Data\\Cache', '/mnt/d'), '/mnt/d/Data/Cache');
    assert.equal(toContainerPath('C:\\', '/mnt/c'), '/mnt/c');
  });

  it('converts container paths back into Windows display paths', () => {
    assert.equal(toDisplayPath('/mnt/c/Windows/Temp'), '\\mnt\\c\\Windows\\Temp');
    assert.equal(toDisplayPath('C:\\Windows\\Temp'), 'C:\\Windows\\Temp');
  });

  it('remaps Windows paths and preserves the original as displayPath', () => {
    const remapped = applyHostMount([
      { name: 'Windows\\Temp', path: 'C:\\Windows\\Temp', group: 'temp' },
      { name: 'native', path: '/already/posix', group: 'other' },
    ], '/mnt/c');

    assert.deepEqual(remapped, [
      {
        name: 'Windows\\Temp',
        path: '/mnt/c/Windows/Temp',
        displayPath: 'C:\\Windows\\Temp',
        group: 'temp',
      },
      { name: 'native', path: '/already/posix', group: 'other' },
    ]);
  });

  it('keeps explicit displayPath when provided', () => {
    const remapped = applyHostMount([
      { name: 'x', path: 'C:\\Windows\\Temp', displayPath: 'C:\\Custom', group: 'temp' },
    ], '/mnt/c');

    assert.equal(remapped[0].path, '/mnt/c/Windows/Temp');
    assert.equal(remapped[0].displayPath, 'C:\\Custom');
  });

  it('leaves entries untouched when no mount is configured', () => {
    const folders = [{ name: 'a', path: 'C:\\Windows\\Temp', group: 'temp' }];
    const result = applyHostMount(folders, undefined);
    assert.deepEqual(result, folders);
    assert.notEqual(result, folders);
    assert.notEqual(result[0], folders[0]);
  });
});

describe('multi-drive container mapping', () => {
  const folders = [
    { name: 'C-Temp', path: 'C:\\Windows\\Temp', group: 'temp' },
    { name: 'D-Temp', path: 'D:\\Temp', group: 'temp' },
    { name: 'D-Program Files', path: 'D:\\Program Files', group: 'app' },
  ];

  it('Given C: and D: paths with both mounts When applyHostMount() runs Then C: maps to /mnt/c and D: to /mnt/d with displayPath preserved', () => {
    const remapped = applyHostMount(folders, { c: '/mnt/c', d: '/mnt/d' });

    assert.deepEqual(remapped, [
      {
        name: 'C-Temp',
        path: '/mnt/c/Windows/Temp',
        displayPath: 'C:\\Windows\\Temp',
        group: 'temp',
      },
      {
        name: 'D-Temp',
        path: '/mnt/d/Temp',
        displayPath: 'D:\\Temp',
        group: 'temp',
      },
      {
        name: 'D-Program Files',
        path: '/mnt/d/Program Files',
        displayPath: 'D:\\Program Files',
        group: 'app',
      },
    ]);
  });

  it('Given a legacy string mount /mnt/c When applyHostMount() runs Then C: maps as before and D: is not mapped onto C:', () => {
    const remapped = applyHostMount([
      { name: 'C-Temp', path: 'C:\\Windows\\Temp', group: 'temp' },
      { name: 'D-Temp', path: 'D:\\Temp', group: 'temp' },
    ], '/mnt/c');

    assert.deepEqual(remapped, [
      {
        name: 'C-Temp',
        path: '/mnt/c/Windows/Temp',
        displayPath: 'C:\\Windows\\Temp',
        group: 'temp',
      },
      { name: 'D-Temp', path: 'D:\\Temp', group: 'temp' },
    ]);
  });

  it('Given an explicit per-drive mount When toContainerPath() runs Then it targets the matching drive only', () => {
    assert.equal(toContainerPath('C:\\Windows\\Temp', '/mnt/c'), '/mnt/c/Windows/Temp');
    assert.equal(toContainerPath('D:\\Program Files\\App', '/mnt/d'), '/mnt/d/Program Files/App');
    assert.equal(toContainerPath('D:\\Temp', '/mnt/c'), 'D:\\Temp');
  });

  it('Given a JSON multi-drive SCAN_HOST_MOUNT When getWhitelist() resolves Then each drive uses its own mount', async () => {
    const previousMount = process.env.SCAN_HOST_MOUNT;
    const previousRoots = process.env.SCAN_ROOTS;
    process.env.SCAN_ROOTS = JSON.stringify([
      { name: 'C-Temp', path: 'C:\\Windows\\Temp', group: 'temp' },
      { name: 'D-Temp', path: 'D:\\Temp', group: 'temp' },
    ]);
    process.env.SCAN_HOST_MOUNT = JSON.stringify({ c: '/mnt/c', d: '/mnt/d' });
    try {
      const result = await getWhitelist();
      assert.deepEqual(result, [
        {
          name: 'C-Temp',
          path: '/mnt/c/Windows/Temp',
          displayPath: 'C:\\Windows\\Temp',
          group: 'temp',
        },
        {
          name: 'D-Temp',
          path: '/mnt/d/Temp',
          displayPath: 'D:\\Temp',
          group: 'temp',
        },
      ]);
    } finally {
      if (previousMount === undefined) delete process.env.SCAN_HOST_MOUNT;
      else process.env.SCAN_HOST_MOUNT = previousMount;
      if (previousRoots === undefined) delete process.env.SCAN_ROOTS;
      else process.env.SCAN_ROOTS = previousRoots;
    }
  });
});

describe('getWhitelist SCAN_ROOTS integration', () => {
  it('prefers options.whitelistRoots over SCAN_ROOTS', async () => {
    const previous = process.env.SCAN_ROOTS;
    process.env.SCAN_ROOTS = JSON.stringify([{ name: 'env', path: '/env/path' }]);
    try {
      const result = await getWhitelist({ whitelistRoots: [{ name: 'opt', path: '/opt/path' }] });
      assert.deepEqual(result, [{ name: 'opt', path: '/opt/path' }]);
    } finally {
      if (previous === undefined) delete process.env.SCAN_ROOTS;
      else process.env.SCAN_ROOTS = previous;
    }
  });

  it('uses SCAN_ROOTS and remaps Windows paths when SCAN_HOST_MOUNT is set', async () => {
    const previous = process.env.SCAN_ROOTS;
    const previousMount = process.env.SCAN_HOST_MOUNT;
    process.env.SCAN_ROOTS = JSON.stringify([
      { name: 'Windows\\Temp', path: 'C:\\Windows\\Temp', group: 'temp' },
    ]);
    process.env.SCAN_HOST_MOUNT = '/mnt/c';
    try {
      const result = await getWhitelist();
      assert.deepEqual(result, [
        {
          name: 'Windows\\Temp',
          path: '/mnt/c/Windows/Temp',
          displayPath: 'C:\\Windows\\Temp',
          group: 'temp',
        },
      ]);
    } finally {
      if (previous === undefined) delete process.env.SCAN_ROOTS;
      else process.env.SCAN_ROOTS = previous;
      if (previousMount === undefined) delete process.env.SCAN_HOST_MOUNT;
      else process.env.SCAN_HOST_MOUNT = previousMount;
    }
  });

  it('falls back to the built-in whitelist when SCAN_ROOTS is invalid', async () => {
    const previous = process.env.SCAN_ROOTS;
    process.env.SCAN_ROOTS = '{broken';
    try {
      const result = await getWhitelist();
      assert.ok(result.length >= 15, 'built-in whitelist must contain at least 15 folders');
      assert.ok(result.every((folder) => typeof folder.path === 'string' && folder.path.length > 0));
    } finally {
      if (previous === undefined) delete process.env.SCAN_ROOTS;
      else process.env.SCAN_ROOTS = previous;
    }
  });
});
