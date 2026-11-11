const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retrieveForQa, retrievalSettings, faqEvidenceVersion } = require('../src/services/multimodalQaBridge.service');
const { buildComparisonRecords } = require('../src/services/multimodalOfflineEvaluation.service');
const scope = { courseId: 'course', allowedVideoIds: ['video'] };
const chunk = { ...scope, courseId: 'course', videoId: 'video', chunkId: 'chunk',
  startSec: 10, endSec: 12, text: '教師逐字稿' };
const base = { scope, settings: { enabled: true }, textSearch: async () => [],
  loadEvidence: async () => [chunk] };

test('media finds transcript evidence with original times and provenance', async () => {
  const result = await retrieveForQa({ ...base, searchers: { audio: async () => [{ ...chunk, text: 'untrusted' }] } });
  assert.equal(result.matches[0].transcript, chunk.text);
  assert.deepEqual(result.citations[0], { chunkId: 'chunk', videoId: 'video', startSec: 10,
    endSec: 12, retrievedBy: ['audio'], channelRanks: { audio: 1 } });
  assert.equal(result.supplementalVisualEnabled, false);
});

test('disabled, empty, failed and missing-index retrieval fall back to scoped text', async () => {
  for (const variant of ['disabled', 'empty', 'failed', 'index']) {
    let calls = 0;
    const result = await retrieveForQa({ ...base,
      settings: { enabled: variant !== 'disabled' },
      textSearch: async () => (++calls === 1 && !['disabled', 'index'].includes(variant) ? [] : [chunk]),
      searchers: { audio: async () => { throw new Error('offline'); } },
      ...(variant === 'index' ? { atlas: { indexSnapshot: null }, queryEmbedding: {} } : {}),
    });
    assert.equal(result.usedFallback, true);
    assert.equal(result.matches[0].chunkId, chunk.chunkId);
    assert.deepEqual(result.matches[0].retrievedBy, ['text']);
  }
});

test('cross-course, unauthorized video and shifted evidence never become answers', async () => {
  for (const bad of [{ courseId: 'other' }, { videoId: 'other' }, { startSec: 9 }]) {
    const result = await retrieveForQa({ ...base, searchers: { visual: async () => [{ ...chunk, ...bad }] } });
    assert.equal(result.matches.length, 0);
  }
  const result = await retrieveForQa({ ...base, textSearch: async () => [{ ...chunk, videoId: 'other' }] });
  assert.equal(result.matches.length, 0);
});

test('hierarchy replaces only text, partial channel failures preserve other results', async () => {
  let flatCalls = 0;
  const result = await retrieveForQa({ ...base, settings: { enabled: true, hierarchy: true },
    textSearch: async () => { flatCalls++; return []; }, hierarchicalTextSearch: async () => [chunk],
    searchers: { audio: async () => [chunk], visual: async () => { throw new Error('failed'); } } });
  assert.equal(flatCalls, 0);
  assert.deepEqual(result.matches[0].retrievedBy, ['text', 'audio']);
  assert.equal(result.diagnostics.visual.status, 'failed');
});

test('cache settings are deterministic and separate enabled, hierarchy and weights', () => {
  assert.equal(retrievalSettings().enabled, false);
  const versions = [{}, { enabled: true }, { hierarchy: true }, { mode: 'text_weighted' }]
    .map(config => faqEvidenceVersion('base', config));
  assert.equal(new Set(versions).size, 4);
  assert.equal(versions[0], faqEvidenceVersion('base', { enabled: false }));
});

test('all channels fail before a successful legacy text retry', async () => {
  let attempts = 0;
  const fail = async () => { throw new Error('unavailable'); };
  const result = await retrieveForQa({ ...base, textSearch: async () => {
    if (++attempts === 1) throw new Error('unavailable');
    return [chunk];
  }, searchers: { audio: fail, visual: fail } });
  assert.equal(result.usedFallback, true);
  assert.equal(result.matches[0].transcript, chunk.text);
  assert.ok(Object.values(result.diagnostics).every(channel => channel.status === 'failed'));
});

test('missing transcript and restricted chunk allowlist reject visual evidence', async () => {
  for (const extra of [{ loadEvidence: async () => [] },
    { scope: { ...scope, allowedChunkIds: ['other'] } }]) {
    const result = await retrieveForQa({ ...base, ...extra,
      searchers: { visual: async () => [chunk] } });
    assert.equal(result.matches.length, 0);
  }
});

test('offline export covers six groups, two hierarchies and two weights with shared media', () => {
  const records = buildComparisonRecords({ questionId: 'q1', scope,
    flat: { text: [], audio: [chunk], visual: [] }, hierarchical: { text: [chunk] } });
  assert.equal(records.length, 24);
  const audio = records.filter(row => row.group === 'audio');
  assert.deepEqual(audio[0].ranked, audio[2].ranked);
  assert.equal(records.find(row => row.group === 'text' && row.mode === 'flat').ranked.length, 0);
});
