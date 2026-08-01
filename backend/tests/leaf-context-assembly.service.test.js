const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { assembleLeafContext } = require('../src/services/leafContextAssembly.service');

function leaf(id, startSec, transcript, overrides = {}) {
  return {
    chunkId: id,
    segmentId: id,
    videoId: 'video-1',
    startSec,
    endSec: startSec + 10,
    transcript,
    parentScore: 0.8,
    ...overrides,
  };
}

describe('leaf context assembly', () => {
  it('deduplicates before deterministic selection', () => {
    const result = assembleLeafContext({ leaves: [leaf('c2', 20, 'two'), leaf('c1', 10, 'one'), leaf('c2', 20, 'duplicate')] });
    assert.deepEqual(result.matches.map((match) => match.chunkId), ['c2', 'c1']);
    assert.equal(result.diagnostics.deduplicatedLeafCount, 2);
  });

  it('preserves timestamp, chunk, video, and citation fields', () => {
    const result = assembleLeafContext({ leaves: [leaf('c1', 12, 'citation text')] });
    assert.deepEqual(result.matches[0], {
      segmentId: 'c1', chunkId: 'c1', videoId: 'video-1', startSec: 12, endSec: 22,
      transcript: 'citation text', score: 0.8,
    });
  });

  it('enforces leaf count limit', () => {
    const result = assembleLeafContext({ leaves: [leaf('c1', 0, 'one'), leaf('c2', 10, 'two')], maxLeaves: 1 });
    assert.deepEqual(result.matches.map((match) => match.chunkId), ['c1']);
    assert.equal(result.diagnostics.contextTruncated, true);
  });

  it('enforces character budget deterministically', () => {
    const result = assembleLeafContext({ leaves: [leaf('c1', 0, '12345'), leaf('c2', 10, '67890')], maxCharacters: 7 });
    assert.deepEqual(result.matches.map((match) => match.transcript), ['12345']);
    assert.equal(result.diagnostics.selectedContextCharacters, 5);
  });

  it('bounds an oversized first leaf instead of returning unbounded context', () => {
    const result = assembleLeafContext({ leaves: [leaf('c1', 0, '123456789')], maxCharacters: 4 });
    assert.equal(result.matches[0].transcript, '1234');
    assert.equal(result.diagnostics.selectedContextCharacters, 4);
  });

  it('does not add parent text to the assembled match', () => {
    const result = assembleLeafContext({ leaves: [leaf('c1', 0, 'leaf only', { parentText: 'must not appear' })] });
    assert.equal(result.matches[0].parentText, undefined);
    assert.equal(JSON.stringify(result.matches).includes('must not appear'), false);
  });

  it('returns safe empty context and count metadata', () => {
    const result = assembleLeafContext({ leaves: [] });
    assert.deepEqual(result.matches, []);
    assert.deepEqual(result.diagnostics, {
      expandedLeafCount: 0,
      deduplicatedLeafCount: 0,
      selectedLeafCount: 0,
      selectedContextCharacters: 0,
      contextTruncated: false,
    });
  });
});
