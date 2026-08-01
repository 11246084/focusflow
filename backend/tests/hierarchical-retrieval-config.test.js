const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const env = require('../src/config/env');

describe('hierarchical retrieval config', () => {
  it('defaults to disabled with leaf fallback enabled', () => {
    assert.equal(env.hierarchicalRetrievalEnabled, false);
    assert.equal(env.hierarchicalRetrievalFallbackToLeaf, true);
  });

  it('parses explicit boolean strings', () => {
    assert.equal(env.parseBoolean('true', false, 'FLAG'), true);
    assert.equal(env.parseBoolean('FALSE', true, 'FLAG'), false);
  });

  it('rejects ambiguous boolean values', () => {
    assert.throws(
      () => env.parseBoolean('yes', false, 'FLAG'),
      /FLAG must be true or false/,
    );
  });

  it('validates positive integer retrieval limits', () => {
    assert.equal(env.parsePositiveInteger('5', 1, 'LIMIT'), 5);
    assert.throws(() => env.parsePositiveInteger('0', 1, 'LIMIT'), /positive integer/);
    assert.throws(() => env.parsePositiveInteger('1.5', 1, 'LIMIT'), /positive integer/);
  });
});
