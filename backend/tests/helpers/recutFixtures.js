const { ids, newObjectId, store } = require('./backendTestHarness');
const { createRecutSource, createRecutVersion, transitionRecut, recutSnapshot } = require('../../src/services/recutState.service');
const sourceFixture = require('../fixtures/recut-sentences.json');

function seedScript(overrides = {}) {
  const script = { _id: newObjectId(), courseId: ids.teacherCourse, topic: 'OpenCV 與 YOLO', topicKey: 'opencv-yolo',
    createdBy: ids.teacher, status: 'evidence_ready', productionMode: 'recut', versions: [], ...overrides };
  store.shortScripts.push(script);
  return script;
}
async function makeVersion(script, overrides = {}) {
  const source = await createRecutSource({ ...structuredClone(sourceFixture), scriptId: script._id });
  return createRecutVersion({ scriptId: script._id, sourceId: source._id,
    selection: { answerable: true, ranges: [{ from: 's1', to: 's2' }], sentenceLabels: [
      { sentenceId: 's1', label: '結論或定義' }, { sentenceId: 's2', label: '例子' },
    ], openingSentenceId: 's1', lockedSentenceIds: [] },
    fullScript: 'OpenCV 是工具箱。YOLO 是訓練好的模型。',
    plan: { schemaVersion: 'recut-v1' }, modelId: 'fake-gemini', shortRenderVersion: 'fake-render-1',
    assetVersions: { '@iconify-json/fluent-emoji-flat': 'fixture', '@phosphor-icons/core': 'fixture' }, theme: 'N2', ...overrides });
}
async function reviewScript(script) {
  const version = await makeVersion(script);
  await transitionRecut({ scriptId: script._id, event: 'revise', versionId: version._id });
  return version;
}
async function approvedScript(script) {
  const version = await reviewScript(script);
  await transitionRecut({ scriptId: script._id, event: 'approve_script', versionId: version._id, actorId: ids.teacher });
  return version;
}
async function renderedAsset(script) {
  const version = await approvedScript(script);
  await transitionRecut({ scriptId: script._id, event: 'queue_render', versionId: version._id });
  await transitionRecut({ scriptId: script._id, event: 'start_render', versionId: version._id });
  const asset = { _id: newObjectId(), sourceScriptId: script._id, recutVersionId: version._id, generationVersion: 1, status: 'draft' };
  store.shortAssets.push(asset);
  await transitionRecut({ scriptId: script._id, event: 'attach_asset', versionId: version._id, assetId: asset._id, generationVersion: 1 });
  return { version, asset };
}
const snapshot = (script) => recutSnapshot(store.shortScripts.find((s) => String(s._id) === String(script._id)));
module.exports = { seedScript, makeVersion, reviewScript, approvedScript, renderedAsset, snapshot };
