const { ids, store, newObjectId } = require('./backendTestHarness');
const { sourceData, selection } = require('./recutSelectionFixtures');
const { seedScript } = require('./recutFixtures');
const { createRecutSource, createRecutVersion, transitionRecut } = require('../../src/services/recutState.service');
const { resolveSelection } = require('../../src/services/recutSelectionValidation.service');
const ReviewEvent = require('../../src/models/recutReviewEvent.model');
async function makeReview({ opening = false, locked = [] } = {}) {
  const script = seedScript(); const source = await createRecutSource({ ...sourceData(), scriptId: script._id });
  const selected = selection(); selected.lockedSentenceIds = locked;
  if (opening) { selected.openingSentenceId = 's1'; selected.sentenceLabels[0].label = '冷開場'; }
  const result = resolveSelection(source, selected);
  const version = await createRecutVersion({ scriptId: script._id, sourceId: source._id, selection: result.selection, fullScript: result.fullScript,
    modelId: 'fake-model', shortRenderVersion: 'fixture', theme: 'N2', plan: { schemaVersion: 'recut-v1', source: { videoId: String(source.videoId) },
      clips: [{ chunkIds: ['chunk1'], from: { text: '句2' }, to: { text: '句6' } }], cards: [] } });
  await transitionRecut({ scriptId: script._id, event: 'revise', versionId: version._id });
  return { script, source, version };
}
async function suggest(fixture, overrides = {}) {
  return ReviewEvent.create({ scriptId: fixture.script._id, versionId: fixture.version._id, kind: 'suggestion', content: '字幕可以縮短',
    proposal: { kind: 'presentation', problem: '字幕太長', proposedChange: '縮短第一張字幕', impact: '只改呈現', target: 'card-1', allowedPaths: ['/plan/cards'], ...overrides } });
}
async function assetFor(fixture) {
  await transitionRecut({ scriptId: fixture.script._id, event: 'start_render', versionId: fixture.version._id });
  const asset = { _id: newObjectId(), sourceScriptId: fixture.script._id, recutVersionId: fixture.version._id, generationVersion: 1, status: 'draft' };
  store.shortAssets.push(asset);
  await transitionRecut({ scriptId: fixture.script._id, event: 'attach_asset', versionId: fixture.version._id, assetId: asset._id, generationVersion: 1 });
  return asset;
}
module.exports = { makeReview, suggest, assetFor, teacher: { id: ids.teacher, role: 'teacher' } };
