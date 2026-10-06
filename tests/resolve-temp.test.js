'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('resolveTemp', () => {
  let origTemp;
  let origLocalAppData;
  let origUsername;

  beforeEach(() => {
    origTemp = process.env.TEMP;
    origLocalAppData = process.env.LOCALAPPDATA;
    origUsername = process.env.USERNAME;
  });

  afterEach(() => {
    if (origTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = origTemp;
    if (origLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = origLocalAppData;
    if (origUsername === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = origUsername;
  });

  it('returns logged-in user Temp path when elevated', async () => {
    const { resolveTemp } = require('../lib/resolve-temp.js');

    // Elevated scenario: TEMP points outside the user profile (e.g. admin/system Temp).
    process.env.TEMP = 'C:\\Windows\\Temp';
    process.env.LOCALAPPDATA = 'C:\\Users\\alice\\AppData\\Local';
    process.env.USERNAME = 'alice';

    // Stub the read-only registry query — no real registry call in test.
    const stubQuery = async () => 'C:\\Users\\alice\\AppData\\Local';

    const result = await resolveTemp(stubQuery);
    assert.equal(result, 'C:\\Users\\alice\\AppData\\Local\\Temp');
  });

  it('preserves spaces in registry profile paths and reports no fallback', async () => {
    const { resolveUserPaths } = require('../lib/resolve-temp.js');
    const expectedLocalAppData = 'C:\\Users\\John Doe\\AppData\\Local';

    process.env.LOCALAPPDATA = 'C:\\Users\\ignored\\AppData\\Local';
    const result = await resolveUserPaths(async () => expectedLocalAppData);

    assert.equal(result.localAppData, expectedLocalAppData);
    assert.equal(result.temp, 'C:\\Users\\John Doe\\AppData\\Local\\Temp');
    assert.equal(result.usedFallback, false);
  });

  it('falls back to %LOCALAPPDATA%\\Temp when registry query fails', async () => {
    const { resolveTemp } = require('../lib/resolve-temp.js');

    process.env.TEMP = 'C:\\Windows\\Temp';
    process.env.LOCALAPPDATA = 'C:\\Users\\bob\\AppData\\Local';
    process.env.USERNAME = 'bob';

    // Stub the read-only registry query failure — no real registry call in test.
    const stubQuery = async () => {
      throw new Error('registry unavailable');
    };

    const result = await resolveTemp(stubQuery);
    assert.equal(result, 'C:\\Users\\bob\\AppData\\Local\\Temp');
  });

  it('reports usedFallback=true when falling back to C:\\Temp', async () => {
    const { resolveUserPaths } = require('../lib/resolve-temp.js');

    // Remove all sources: registry throws, no env vars
    const stubQuery = async () => { throw new Error('registry unavailable'); };
    delete process.env.LOCALAPPDATA;
    delete process.env.TEMP;

    const result = await resolveUserPaths(stubQuery);

    assert.equal(result.temp, 'C:\\Temp');
    assert.equal(result.usedFallback, true);
  });
});
