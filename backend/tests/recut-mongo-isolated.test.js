const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
require('./helpers/noDotenv.cjs');
const mongoose = require('mongoose');
const { assertLoopbackMongoTarget } = require('../src/services/recutRuntime.service');
const uri = process.env.RECUT_ISOLATED_TEST_URI;
const Script = require('../src/models/shortScript.model');
const Source = require('../src/models/recutSource.model');
const Version = require('../src/models/recutVersion.model');
const Approval = require('../src/models/recutApproval.model');
const Worker = require('../src/models/recutWorker.model');
const Job = require('../src/models/recutRenderJob.model');
const state = require('../src/services/recutState.service');
const fixture = require('./fixtures/recut-sentences.json');
function child(operation, scriptId, workerId) {
  const proc = fork(path.join(__dirname, 'helpers/recutMongoChild.cjs'), [uri, operation, String(scriptId), String(workerId || '')], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  const messages = []; const listeners = [];
  proc.on('message', (message) => { const next = listeners.shift(); if (next) next(message); else messages.push(message); });
  const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve) => listeners.push(resolve));
  return { proc, next };
}
async function seed() {
  const script = await Script.create({ courseId: new mongoose.Types.ObjectId(), topic: 'isolated recut', topicKey: new mongoose.Types.ObjectId().toString(), productionMode: 'recut', createdBy: new mongoose.Types.ObjectId() });
  const source = await state.createRecutSource({ ...fixture, scriptId: script._id });
  const version = await state.createRecutVersion({ scriptId: script._id, sourceId: source._id,
    selection: { answerable: true, ranges: [{ from: 's1', to: 's2' }] }, fullScript: '原音快照', plan: { schemaVersion: 'recut-v1' }, modelId: 'fake', shortRenderVersion: 'isolated-render', assetVersions: {} });
  await state.transitionRecut({ scriptId: script._id, event: 'revise', versionId: version._id });
  return { script, source, version };
}
describe('recut 專用 loopback Mongo 跨程序 fencing', { skip: !uri, timeout: 20000 }, () => {
  before(async () => {
    const target = assertLoopbackMongoTarget(uri);
    assert.equal(target.host, '127.0.0.1'); assert.equal(target.port, 27029);
    assert.match(target.database, /^recut_delivery_test_[a-zA-Z0-9_]+$/);
    await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 3000 });
    for (const model of [Script, Source, Version, Approval, Worker, Job]) { await model.createCollection(); await model.createIndexes(); }
  });
  after(async () => {
    if (mongoose.connection.readyState === 1) { assert.match(mongoose.connection.name, /^recut_delivery_test_/); await mongoose.connection.dropDatabase(); }
    await mongoose.disconnect();
  });
  it('另一 Node 程序持有 DB lease 時，修改在副作用前拒絕；釋放後可繼續', async () => {
    const { script, version } = await seed(); const owner = child('lock', script._id);
    assert.equal((await owner.next()).locked, true);
    try {
      await assert.rejects(state.transitionRecut({ scriptId: script._id, event: 'approve_script', versionId: version._id, actorId: script.createdBy }), { code: 'RECUT_STATE_INVALID' });
      assert.equal(await Approval.countDocuments({ scriptId: script._id }), 0);
    } finally { owner.proc.send('release'); assert.equal((await owner.next()).ok, true); }
    await state.transitionRecut({ scriptId: script._id, event: 'approve_script', versionId: version._id, actorId: script.createdBy });
    assert.equal(await Approval.countDocuments({ scriptId: script._id }), 1);
  });
  it('lease被新token取代後，舊owner不能提交狀態或釋放新owner的lease', async () => {
    const { script, version } = await seed();
    await assert.rejects(state.withRecutTransition(script._id, async (transition) => {
      await Script.updateOne({ _id: script._id }, { $set: { 'recutMutationLock.token': 'replacement-owner', 'recutMutationLock.expiresAt': new Date(Date.now() + 60000) } });
      await transition({ event: 'approve_script', versionId: version._id, actorId: script.createdBy });
    }), { code: 'RECUT_STATE_INVALID' });
    assert.equal((await Script.findById(script._id).select('+recutMutationLock.token').lean()).recutMutationLock.token, 'replacement-owner');
    assert.equal(await Approval.countDocuments({ scriptId: script._id }), 0);
  });
  it('兩個獨立程序競領同一核准工作，DB CAS只允許一次派工', async () => {
    const { script, version } = await seed();
    await state.transitionRecut({ scriptId: script._id, event: 'approve_script', versionId: version._id, actorId: script.createdBy });
    await state.transitionRecut({ scriptId: script._id, event: 'queue_render', versionId: version._id });
    const job = await require('../src/services/recutWorker.service').ensureRenderJob(script._id);
    const workers = await Worker.create([{ name: 'one', keyHash: 'a'.repeat(64), createdBy: script.createdBy }, { name: 'two', keyHash: 'b'.repeat(64), createdBy: script.createdBy }]);
    const results = await Promise.all(workers.map(async (worker) => child('claim', script._id, worker._id).next()));
    assert.equal(results.filter((result) => result.jobId === String(job._id)).length, 1);
    const saved = await Job.findById(job._id).lean(); assert.equal(saved.attemptCount, 1); assert.equal(saved.status, 'leased');
    assert.equal(await Worker.countDocuments({ activeJobId: job._id }), 1);
  });
  it('程序中斷留下的過期mutation lease可由新owner接手', async () => {
    const { script, version } = await seed();
    await Script.updateOne({ _id: script._id }, { $set: { 'recutMutationLock.token': 'crashed-owner', 'recutMutationLock.expiresAt': new Date(Date.now() - 1000) } });
    await state.transitionRecut({ scriptId: script._id, event: 'approve_script', versionId: version._id, actorId: script.createdBy });
    const saved = await Script.findById(script._id).select('+recutMutationLock.token').lean();
    assert.equal(saved.recut.state, 'script_approved'); assert.equal(saved.recutMutationLock.token, null);
  });
});
