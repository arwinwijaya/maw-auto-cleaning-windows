'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('mapLimit — bounded concurrency', () => {
  let mapLimit;

  beforeEach(() => {
    // Fresh import each test to avoid state leakage
    delete require.cache[require.resolve('../lib/concurrency.js')];
    ({ mapLimit } = require('../lib/concurrency.js'));
  });

  it('limits in-flight calls and preserves order', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const limit = 4;
    let inFlight = 0;
    let maxInFlight = 0;

    const mapper = async (item) => {
      inFlight += 1;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      // Simulate async work with a resolved promise
      await Promise.resolve();
      const result = item * 2;
      inFlight -= 1;
      return result;
    };

    const results = await mapLimit(items, limit, mapper);

    // Verify bounded concurrency: max simultaneous in-flight never exceeded limit
    assert.equal(maxInFlight, limit, `max in-flight (${maxInFlight}) should equal limit (${limit})`);

    // Verify order preservation
    for (let i = 0; i < items.length; i++) {
      assert.equal(results[i], items[i] * 2, `result[${i}] should be ${items[i] * 2}`);
    }
  });
});

describe('mapLimit — edge cases', () => {
  let mapLimit;

  beforeEach(() => {
    delete require.cache[require.resolve('../lib/concurrency.js')];
    ({ mapLimit } = require('../lib/concurrency.js'));
  });

  it('resolves [] for an empty array without invoking the mapper', async () => {
    let calls = 0;
    const mapper = async () => {
      calls += 1;
      return 'should-not-run';
    };

    const results = await mapLimit([], 4, mapper);

    assert.deepEqual(results, []);
    assert.equal(calls, 0, 'mapper must not be invoked for an empty array');
  });

  it('runs every item when limit exceeds the item count', async () => {
    const items = [1, 2, 3];
    const seen = [];

    const mapper = async (item) => {
      await Promise.resolve();
      seen.push(item);
      return item + 1;
    };

    const results = await mapLimit(items, 10, mapper);

    assert.deepEqual(results, [2, 3, 4]);
    assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3]);
  });

  it('rejects the returned promise and leaks no unhandled rejection', async () => {
    const items = Array.from({ length: 8 }, (_, i) => i);
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    const boom = new Error('mapper failed on item 3');
    const mapper = async (item) => {
      await Promise.resolve();
      if (item === 3) throw boom;
      return item;
    };

    try {
      await assert.rejects(() => mapLimit(items, 2, mapper), (error) => error === boom);

      // Give the event loop a chance to surface any escaped unhandled rejection.
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(unhandled, [], 'no unhandled rejection should escape');
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });
});