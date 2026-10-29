// 只供明確執行的 loopback 整合測試；不載入 server、.env 或記憶體 harness。
const { before, after, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const ShortScript = require('../src/models/shortScript.model');
const RecutVersion = require('../src/models/recutVersion.model');
const RecutTask = require('../src/models/recutTask.model');
const ReviewEvent = require('../src/models/recutReviewEvent.model');
const { setProductionModeForScript, transitionRecut, createRecutSource, createRecutVersion } = require('../src/services/recutState.service');
const fixture = require('../tests/fixtures/recut-sentences.json');
const uri = process.env.RECUT_TEST_MONGODB_URI;
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(uri || '')) {
  throw new Error('RECUT_TEST_MONGODB_URI must be a bare loopback URI with explicit port.');
}
const databaseName = `focusflow_recut_test_${crypto.randomBytes(8).toString('hex')}`;
let scriptId; let version; let taskId;
before(async () => {
  await mongoose.connect(uri, { dbName: databaseName, autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000 });
  // 刻意不用 model.create，以確認真正缺欄位的舊文件可以 CAS 更新。
  scriptId = new mongoose.Types.ObjectId();
  await ShortScript.collection.insertOne({ _id: scriptId, courseId: new mongoose.Types.ObjectId(), topic: 'fixture', topicKey: 'fixture', versions: [], status: 'evidence_ready' });
});
after(async () => {
  try {
    if (mongoose.connection.db?.databaseName === databaseName && /^focusflow_recut_test_[a-f0-9]{16}$/.test(databaseName)) await mongoose.connection.db.dropDatabase();
  } finally { await mongoose.disconnect(); }
});
it('真 Mongo：缺少 productionMode 與 revision 的舊文件可原子切換且不改唯一索引定義', async () => {
  const updated = await setProductionModeForScript({ scriptId, mode: 'recut' });
  assert.equal(updated.productionMode, 'recut'); assert.equal(updated.recut.revision, 1);
  assert.ok(ShortScript.schema.indexes().some(([keys, options]) => keys.courseId === 1 && keys.topicKey === 1 && options.unique));
});
it('真 Mongo：來源、選段、模型與工具版本可往返，舊版不覆蓋', async () => {
  const source = await createRecutSource({ ...fixture, scriptId });
  version = await createRecutVersion({ scriptId, sourceId: source._id, selection: { answerable: true, ranges: [{ from: 's1', to: 's2', startAt: 'OpenCV' }], sentenceLabels: [{ sentenceId: 's1', label: '結論或定義' }] },
    plan: { schemaVersion: 'recut-v1' }, fullScript: 'OpenCV 是工具箱。', modelId: 'fake-model', shortRenderVersion: 'fixture',
    assetVersions: { '@phosphor-icons/core': 'fixture' }, theme: 'N2' });
  const saved = await RecutVersion.findById(version._id).lean();
  assert.equal(saved.selection.ranges[0].startAt, 'OpenCV'); assert.equal(saved.assetVersions['@phosphor-icons/core'], 'fixture');
  await transitionRecut({ scriptId, event: 'revise', versionId: version._id });
  const newer = await createRecutVersion({ ...saved, _id: undefined, theme: 'G' });
  assert.notEqual(String(newer._id), String(version._id)); assert.equal((await RecutVersion.findById(version._id).lean()).theme, 'N2');
});
it('真 Mongo：並行核准只有一個成功，核准版本才可排入渲染', async () => {
  const params = { scriptId, event: 'approve_script', versionId: version._id, actorId: new mongoose.Types.ObjectId() };
  const outcomes = await Promise.allSettled([transitionRecut(params), transitionRecut(params)]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  await transitionRecut({ scriptId, event: 'queue_render', versionId: version._id });
  assert.equal((await ShortScript.findById(scriptId).lean()).recut.state, 'render_queued');
});
it('真 Mongo：任務固定上限不可被更新，原子扣額度不會超用', async () => {
  const task = await RecutTask.create({ scriptId, courseId: new mongoose.Types.ObjectId(), requestedBy: new mongoose.Types.ObjectId(), type: 'generate',
    status: 'running', callLimit: 3, stepIds: ['fixture'], baseSnapshot: { state: 'idle' }, queuedAt: new Date() });
  taskId = task._id;
  await RecutTask.findByIdAndUpdate(taskId, { $set: { callLimit: 99 } });
  const updates = await Promise.all(Array.from({ length: 10 }, () => RecutTask.findOneAndUpdate({ _id: taskId, status: 'running', callsUsed: { $lt: 3 } }, { $inc: { callsUsed: 1 } }, { new: true })));
  assert.equal(updates.filter(Boolean).length, 3);
  const saved = await RecutTask.findById(taskId).lean(); assert.equal(saved.callLimit, 3); assert.equal(saved.callsUsed, 3);
});
it('真 Mongo：模型快照不可改，修改摘要與巢狀草稿／提案可以往返', async () => {
  const task = await RecutTask.create({ scriptId, courseId: new mongoose.Types.ObjectId(), requestedBy: new mongoose.Types.ObjectId(), type: 'apply_selection',
    callLimit: 5, stepIds: ['fixture'], baseSnapshot: { state: 'script_review' }, queuedAt: new Date(),
    settingsSnapshot: { model: { provider: 'gemini', model: 'fixed-model' } }, changeSummary: ['加回：例子'] });
  await RecutTask.findByIdAndUpdate(task._id, { $set: { settingsSnapshot: { model: { provider: 'gemini', model: 'changed' } } } });
  const saved = await RecutTask.findById(task._id).lean(); assert.equal(saved.settingsSnapshot.model.model, 'fixed-model');
  assert.deepEqual(saved.changeSummary, ['加回：例子']);
  const draft = await ReviewEvent.create({ scriptId, versionId: version._id, kind: 'edit', draftId: new mongoose.Types.ObjectId(),
    sentenceId: 's2', originalLabel: '離題', action: 'add', reasonLabel: '漏了重點', draftSelection: { ranges: [{ from: 's1', to: 's2' }], lockedSentenceIds: ['s2'] },
    proposal: { kind: 'presentation', allowedPaths: ['/plan/cards/0/subtitle'] } });
  const event = await ReviewEvent.findById(draft._id).lean();
  assert.equal(event.draftSelection.ranges[0].to, 's2'); assert.deepEqual(event.proposal.allowedPaths, ['/plan/cards/0/subtitle']);
});
it('真 Mongo：復原任務保留草稿參照，計時階段與來源建議可往返', async () => {
  const script = await ShortScript.create({ courseId: new mongoose.Types.ObjectId(), topic: 'review-fixture', topicKey: 'review-fixture', productionMode: 'recut' });
  const source = await createRecutSource({ ...fixture, scriptId: script._id });
  const current = await createRecutVersion({ scriptId: script._id, sourceId: source._id, selection: { answerable: true }, modelId: 'fake', shortRenderVersion: 'fake' });
  await transitionRecut({ scriptId: script._id, event: 'revise', versionId: current._id });
  const edit = await ReviewEvent.create({ scriptId: script._id, versionId: current._id, kind: 'edit', draftSelection: { ranges: [] }, action: 'remove' });
  await transitionRecut({ scriptId: script._id, event: 'set_pending_edits', pendingEditId: edit._id });
  const before = (await ShortScript.findById(script._id).lean()).recut;
  const id = new mongoose.Types.ObjectId();
  await transitionRecut({ scriptId: script._id, event: 'queue_task', taskId: id });
  await transitionRecut({ scriptId: script._id, event: 'restore_task', taskId: id, baseSnapshot: before });
  assert.equal(String((await ShortScript.findById(script._id).lean()).recut.pendingEditId), String(edit._id));
  const time = await ReviewEvent.create({ scriptId: script._id, versionId: current._id, kind: 'timing', phase: 'production_wait',
    startedAt: new Date(0), endedAt: new Date(3000), durationMs: 3000, suggestionId: edit._id });
  const saved = await ReviewEvent.findById(time._id).lean(); assert.equal(saved.durationMs, 3000); assert.equal(saved.phase, 'production_wait');
  assert.equal(String(saved.suggestionId), String(edit._id));
});
