const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { store, ids, resetStore } = require('./helpers/backendTestHarness');
const { seedScript, snapshot } = require('./helpers/recutFixtures');
const { sourceData, selection } = require('./helpers/recutSelectionFixtures');
const { fakeRenderer } = require('./helpers/recutPipelineFixtures');
const { createRecutSource } = require('../src/services/recutState.service');
const { createRecutQueue } = require('../src/services/recutQueue.service');
const { createRecutPipeline } = require('../src/services/recutPipeline.service');
const queues = [];
async function run({ answerable = true, invalidFirst = false, cancelCards = false } = {}) {
  const script = seedScript(), source = await createRecutSource({ ...sourceData(), scriptId: script._id });
  const q = createRecutQueue({ getSetting: () => 5, captureSettings: () => ({ model: { provider: 'gemini', model: 'fixture-model' } }), notify: async () => {} }); queues.push(q);
  let count = 0;
  const cards = { scenes: [{ id: 'scene1', from: 's2', to: 's6', component: 'quote-reveal', params: { text: '原文' } }], subtitles: [] };
  const outputs = [answerable ? selection() : selection(2, 6, { answerable: false, unanswerableReason: '沒有回答', ranges: [], sentenceLabels: sourceData().sentences.map((s) => ({ sentenceId: s.id, label: '離題' })) }),
    ...(invalidFirst ? [{ ...cards, clips: [] }] : []), cards, { issues: [] }];
  const p = createRecutPipeline({ renderer: fakeRenderer(), decide: async () => {
    if (cancelCards && count === 1) await q.requestCancel(store.recutTasks[0]._id);
    return { output: outputs[count++], modelId: 'fixture-model', usageMetadata: { totalTokenCount: 7 } };
  }, sourceSteps: [{ id: 'fake-source', stage: 'sourceCheck', run: async () => ({ sourceId: String(source._id) }) }] });
  p.register(q);
  const task = await q.enqueue({ script, requestedBy: ids.teacher }); await q.idle();
  return { script, source, count, task: store.recutTasks.find((t) => String(t._id) === String(task._id)), attempts: store.recutAttempts.filter((a) => String(a.taskId) === String(task._id)) };
}
describe('recut 完整假模型管線與正式queue', () => {
  beforeEach(resetStore);
  afterEach(async () => { for (const q of queues) { q.stop(); await q.idle(); } queues.length = 0; });
  it('RC3→RC4→wholeCheck記三次共用用量後切script_review', async () => {
    const r = await run(); assert.equal(r.task.status, 'succeeded'); assert.equal(snapshot(r.script).state, 'script_review');
    assert.equal(r.task.callsUsed, 3); const modelAttempts = r.attempts.filter((a) => a.consumesCall);
    assert.equal(modelAttempts.length, 3); assert.ok(modelAttempts.every((a) => a.usageMetadata.totalTokenCount === 7));
    assert.ok(r.attempts.some((a) => a.stage === 'wholeCheck'));
  });
  it('錯誤配圖使用同一任務額度重試並保留失敗嘗試', async () => {
    const r = await run({ invalidFirst: true }); assert.equal(r.task.status, 'succeeded'); assert.equal(r.task.callsUsed, 4);
    assert.equal(r.attempts.filter((a) => a.consumesCall && a.status === 'failed').length, 1);
  });
  it('無法回答不呼叫cards或wholeCheck', async () => {
    const r = await run({ answerable: false }); assert.equal(r.task.status, 'succeeded'); assert.equal(r.count, 1);
    assert.equal(store.recutVersions[0].plan, null);
  });
  it('配圖呼叫途中取消會保存已用次數並還原原狀態', async () => {
    const r = await run({ cancelCards: true }); assert.equal(r.task.status, 'cancelled'); assert.equal(snapshot(r.script).state, 'idle');
    assert.equal(r.task.callsUsed, 2); assert.equal(store.recutVersions.length, 0);
    assert.ok(r.attempts.some((a) => a.status === 'discarded'));
  });
});
