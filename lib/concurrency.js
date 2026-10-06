'use strict';

/** Map items through a bounded number of async workers, preserving input order. */
async function mapLimit(items, limit, mapper) {
  if (items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

module.exports = { mapLimit };