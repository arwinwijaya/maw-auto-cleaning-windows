'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('sizeHuman', () => {
  it('formats 0 B', () => {
    const { sizeHuman } = require('../lib/format.js');
    assert.equal(sizeHuman(0), '0 B');
  });

  it('formats 2.5 GB', () => {
    const { sizeHuman } = require('../lib/format.js');
    assert.equal(sizeHuman(2684354560), '2.5 GB');
  });
});
