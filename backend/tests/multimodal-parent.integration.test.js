const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParentFixture } = require('./helpers/multimodalParentFixture');
const { retrieveForQa } = require('../src/services/multimodalQaBridge.service');
const { buildComparisonRecords } = require('../src/services/multimodalOfflineEvaluation.service');

test('actual Parent search/expansion differs from flat and enters Bridge with child evidence', async () => {
  const fixture = createParentFixture();
  const hierarchical = await fixture.retrieve();
  assert.deepEqual(hierarchical.matches.map(row => row.chunkId), ['synthetic-child-1', 'synthetic-child-2']);
  assert.equal(hierarchical.matches[0].score, 1);
  assert.equal(hierarchical.matches[0].startSec, 22);
  assert.equal(hierarchical.matches[0].endSec, 24);
  assert.deepEqual(fixture.calls[0].restrictedVideoIds, [fixture.videoId]);
  const lower = { ...fixture.parent, parentId: 'synthetic-lower-parent', syntheticEmbedding: [0.8, 0.6] };
  const ranked = await fixture.retrieve({ parents: [lower, fixture.parent] });
  assert.deepEqual(ranked.diagnostics.hierarchical.retrievedParentIds, [fixture.parent.parentId, lower.parentId]);
  assert.equal(ranked.matches[0].score, 1);
  const scope = { courseId: fixture.courseId, allowedVideoIds: [fixture.videoId] };
  const text = hierarchical.matches.map(row => ({ ...row, courseId: fixture.courseId, text: row.transcript }));
  const result = await retrieveForQa({ scope, settings: { enabled: true, hierarchy: true },
    textSearch: async () => { throw Error('Flat search must not supply hierarchical text'); },
    hierarchicalTextSearch: async () => text,
    searchers: { audio: async () => [fixture.leaves[1]], visual: async () => [fixture.leaves[2]] },
    loadEvidence: async () => fixture.leaves });
  assert.equal(result.usedFallback, false);
  assert.equal(result.matches[0].chunkId, 'synthetic-child-1');
  assert.equal(result.matches[0].transcript, fixture.leaves[1].text);
  assert.deepEqual(result.citations[0].retrievedBy, ['text', 'audio']);
  const records = buildComparisonRecords({ questionId: 'synthetic-q', scope,
    flat: { text: fixture.flat.matches, audio: [fixture.leaves[1]], visual: [fixture.leaves[2]] },
    hierarchical: { text } });
  assert.equal(records.length, 24);
  assert.notDeepEqual(records.find(row => row.mode === 'flat' && row.group === 'text').ranked,
    records.find(row => row.mode === 'hierarchical' && row.group === 'text').ranked);
  assert.deepEqual(records.find(row => row.mode === 'flat' && row.group === 'audio').ranked,
    records.find(row => row.mode === 'hierarchical' && row.group === 'audio').ranked);
});

test('missing parents and children fall back; duplicate hits deduplicate; foreign scope fails closed', async () => {
  const fixture = createParentFixture();
  for (const options of [{ parents: [] }, { documents: [] },
    { parents: [{ ...fixture.parent, courseId: 'other', videoId: 'unauthorized' }] },
    { documents: fixture.leaves.map(row => ({ ...row, courseId: 'other', videoId: 'unauthorized' })) }]) {
    const result = await fixture.retrieve(options);
    assert.equal(result.diagnostics.hierarchical.fallbackUsed, true);
    assert.deepEqual(result.matches, fixture.flat.matches);
  }
  const duplicate = await fixture.retrieve({ parents: [fixture.parent, fixture.parent] });
  assert.equal(duplicate.matches.length, 2);
  assert.ok(duplicate.diagnostics.hierarchical.diagnostics.duplicateChildCount > 0);
  const partial = await fixture.retrieve({ documents: [fixture.leaves[1]] });
  assert.equal(partial.matches.length, 1);
  assert.equal(partial.diagnostics.hierarchical.missingChildCount, 1);
  assert.equal(partial.diagnostics.hierarchical.fallbackUsed, false);
});
