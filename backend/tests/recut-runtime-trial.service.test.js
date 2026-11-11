const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { assertLoopbackMongoTarget } = require('../src/services/recutRuntime.service');
const { runSingleTopicTrial, copyRecutCourseData } = require('../src/services/recutRuntimeTrial.service');
const { fixture, fakeRenderer } = require('./helpers/recutPipelineFixtures');
const { createRecutPipeline } = require('../src/services/recutPipeline.service');
describe('recut 本機單題工具', () => {
  it('只接受loopback明確埠與資料庫，不接受Atlas、認證或DNS別名', () => {
    for (const uri of ['mongodb+srv://atlas/db', 'mongodb://remote:27017/db', 'mongodb://127.0.0.1/db', 'mongodb://u:p@localhost:27017/db', 'mongodb://127.0.0.1:27017,remote:27017/db', 'mongodb://localhost:27017/db?replicaSet=x', 'mongodb://localhost:99999/db']) assert.throws(() => assertLoopbackMongoTarget(uri), { code: 'RECUT_LOCAL_DB_REQUIRED' });
    assert.equal(assertLoopbackMongoTarget('mongodb://127.0.0.1:27131/recut_trial').database, 'recut_trial');
  });
  it('預設dry-run不呼叫模型與adapter', async () => {
    let called = false; const result = await runSingleTopicTrial({ pipeline: { get generate() { called = true; } } });
    assert.equal(called, false); assert.equal(result.dryRun, true); assert.equal(result.estimatedSharedCalls, 3);
  });
  it('課程複製預設只列筆數，目標守衛先於讀取且不輸出URI', async () => {
    let writes = 0, reads = 0;
    const args = { courseIds: ['c1', 'c2'], targetUri: 'mongodb://127.0.0.1:27131/recut_trial',
      readCourseData: async () => { reads++; return { courses: [{ _id: 'c1' }], videos: [] }; }, writeLocal: async () => { writes++; } };
    const result = await copyRecutCourseData(args); assert.equal(writes, 0); assert.equal(reads, 1); assert.equal(result.counts.courses, 1);
    assert.equal(JSON.stringify(result).includes('mongodb:'), false);
    await assert.rejects(copyRecutCourseData({ ...args, targetUri: 'mongodb+srv://private/db' })); assert.equal(reads, 1);
  });
  it('fake完整流程按source/selection/cards/check順序到script_review', async () => {
    const f = fixture(), order = []; let calls = 0;
    const pipeline = createRecutPipeline({ renderer: fakeRenderer(), decide: async () => ({ output: ++calls === 1 ? f.cards : { issues: [] }, usageMetadata: { totalTokenCount: 1 } }),
      sourceSteps: [{ id: 'fake-source', stage: 'sourceCheck', run: async () => { order.push('source'); return { sourceId: 'source' }; } }],
      selectionStep: { id: 'fake-selection', stage: 'selection', run: async () => { order.push('selection'); return { selection: f.selection, selectionResult: f.selectionResult, fullScript: f.selectionResult.fullScript }; } },
      loadSource: async () => f.source });
    const result = await runSingleTopicTrial({ pipeline, input: { scriptId: 'script' }, model: { provider: 'gemini', model: 'fake' }, allowModel: true });
    assert.deepEqual(order, ['source', 'selection']); assert.equal(result.state, 'script_review'); assert.equal(result.callsUsed, 2);
    assert.deepEqual(result.attempts.filter((a) => a.stepId === 'fake-source' || a.stepId === 'fake-selection').map((a) => a.stage), ['sourceCheck', 'selection']);
  });
  it('任一步失敗後停下且附安全階段紀錄', async () => {
    let next = false;
    const pipeline = { generate: [{ id: 'source', stage: 'sourceCheck', run: async () => { throw Object.assign(new Error('private'), { code: 'RECUT_SOURCE_INVALID' }); } },
      { id: 'next', stage: 'selection', run: async () => { next = true; } }] };
    await assert.rejects(runSingleTopicTrial({ pipeline, model: { model: 'fake' }, allowModel: true }), (error) => error.trial.stage === 'sourceCheck'); assert.equal(next, false);
  });
});
