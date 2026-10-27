const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids } = require('./helpers/backendTestHarness');
const { seedScript, makeVersion, reviewScript, snapshot } = require('./helpers/recutFixtures');
const RecutTask = require('../src/models/recutTask.model');
const RecutAttempt = require('../src/models/recutAttempt.model');
const RecutReviewEvent = require('../src/models/recutReviewEvent.model');
const { transitionRecut } = require('../src/services/recutState.service');
const { createRecutQueue } = require('../src/services/recutQueue.service');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const taskFor = (id) => store.recutTasks.find((t) => String(t._id) === String(id));
function payload(version) {
  const { _id, createdAt, updatedAt, __v, ...data } = version;
  return data;
}
async function setup(type = 'generate', options = {}) {
  const script = seedScript();
  const version = await makeVersion(script);
  const q = createRecutQueue(options);
  q.registerSteps(type, [{ id: 'fake-selection-v1', stage: 'selection', run: async () => ({ version: payload(version) }) }]);
  return { q, script, version };
}
const enqueue = (q, script, extras = {}) => q.enqueue({ script, requestedBy: ids.teacher, ...extras });

describe('recut 持久化背景佇列（外部步驟皆為假實作）', () => {
  beforeEach(resetStore);
  it('未註冊步驟不建立假成功工作', async () => {
    const q = createRecutQueue();
    await assert.rejects(() => enqueue(q, seedScript()), { code: 'RECUT_STEPS_NOT_CONFIGURED' });
    assert.equal(store.recutTasks.length, 0);
  });
  it('無法回答保存原因與逐句標籤，停止後續步驟且不可核准製作', async () => {
    const { q, script, version } = await setup(); let called = false;
    q.registerSteps('generate', [
      { id: 'cannot-answer', stage: 'selection', run: async () => ({ version: { ...payload(version), plan: null,
        selection: { answerable: false, unanswerableReason: '這段錄音沒有說明差別', ranges: [], sentenceLabels: [
          { sentenceId: 's1', label: '離題' }, { sentenceId: 's2', label: '離題' },
        ] } } }) },
      { id: 'never-run', stage: 'cards', run: async () => { called = true; return {}; } },
    ]);
    const task = await enqueue(q, script); await q.idle();
    assert.equal(taskFor(task._id).status, 'succeeded'); assert.equal(called, false);
    const current = store.recutVersions.find((v) => String(v._id) === String(snapshot(script).currentVersionId));
    assert.match(current.selection.unanswerableReason, /沒有說明/);
    await assert.rejects(() => transitionRecut({ scriptId: script._id, event: 'approve_script', versionId: current._id, actorId: ids.teacher }), { code: 'RECUT_STATE_INVALID' });
  });
  it('管理員啟動時仍通知課程教師', async () => {
    const { q, script } = await setup(); const task = await enqueue(q, script, { requestedBy: ids.admin }); await q.idle();
    assert.equal(taskFor(task._id).status, 'succeeded'); assert.equal(String(store.notifications[0].recipientId), ids.teacher);
  });
  it('持久化排隊並 FIFO 依序執行，同一程序只跑一件', async () => {
    const { q, script, version } = await setup(); const other = seedScript(); const otherVersion = await makeVersion(other);
    const firstStarted = deferred(); const release = deferred(); const order = []; let active = 0; let peak = 0;
    q.registerSteps('generate', [{ id: 'serial', stage: 'selection', run: async ({ task }) => {
      active++; peak = Math.max(peak, active); order.push(String(task.scriptId));
      if (String(task.scriptId) === String(script._id)) { firstStarted.resolve(); await release.promise; }
      active--; return { version: payload(String(task.scriptId) === String(script._id) ? version : otherVersion) };
    } }]);
    const a = await enqueue(q, script); await firstStarted.promise;
    const b = await enqueue(q, other);
    assert.equal(taskFor(b._id).status, 'queued');
    release.resolve(); await q.idle();
    assert.deepEqual(order, [String(script._id), String(other._id)]); assert.equal(peak, 1);
    assert.equal(taskFor(a._id).status, 'succeeded'); assert.equal(taskFor(b._id).status, 'succeeded');
    assert.equal(store.notifications.length, 2);
  });
  it('同一腳本重複啟動被擋，正在執行時不可切換模式', async () => {
    const { q, script } = await setup(); q.stop();
    await enqueue(q, script);
    await assert.rejects(() => enqueue(q, script), { code: 'RECUT_STATE_INVALID' });
    const { setProductionModeForScript } = require('../src/services/recutState.service');
    await assert.rejects(() => setProductionModeForScript({ scriptId: script._id, mode: 'avatar' }), { code: 'RECUT_STATE_INVALID' });
    assert.equal(snapshot(script).state, 'queued');
  });
  it('重啟後恢復排隊任務；已切換目前版本但未收尾的 task 不回滾', async () => {
    const { q, script } = await setup(); q.stop(); const task = await enqueue(q, script);
    await q.recover();
    assert.equal(taskFor(task._id).status, 'succeeded');
    const current = snapshot(script).currentVersionId;
    taskFor(task._id).status = 'running'; taskFor(task._id).notifiedAt = null;
    await q.recover();
    assert.equal(taskFor(task._id).status, 'succeeded'); assert.equal(String(snapshot(script).currentVersionId), String(current));
    assert.equal(store.notifications.length, 1);
  });
  it('重啟時執行中的工作失敗並回原版，不重新呼叫步驟；未完成嘗試留下原因', async () => {
    const { q, script } = await setup(); const base = await reviewScript(script); q.stop();
    const task = await enqueue(q, script);
    await RecutTask.findByIdAndUpdate(task._id, { $set: { status: 'running', callsUsed: 1 } });
    await transitionRecut({ scriptId: script._id, event: 'start_task', taskId: task._id });
    await RecutAttempt.create({ taskId: task._id, stepId: 'fake-selection-v1', stage: 'selection', status: 'running', startedAt: new Date(), input: { question: 'test' }, consumesCall: true });
    await q.recover();
    assert.equal(taskFor(task._id).status, 'failed'); assert.equal(taskFor(task._id).error.code, 'RECUT_TASK_INTERRUPTED');
    assert.equal(String(snapshot(script).currentVersionId), String(base._id)); assert.equal(snapshot(script).state, 'script_review');
    assert.equal(store.recutAttempts[0].error.code, 'RECUT_TASK_INTERRUPTED'); assert.equal(taskFor(task._id).callsUsed, 1);
    assert.equal(store.notifications[0].source, 'recut_task_finished');
  });
  it('啟動時恢復 task 已建立但尚未附加到腳本的排隊工作', async () => {
    const { q, script } = await setup(); q.stop(); const base = snapshot(script); const task = await enqueue(q, script);
    script.recut = base; taskFor(task._id).readyAt = null;
    await q.recover();
    assert.equal(taskFor(task._id).status, 'succeeded'); assert.equal(snapshot(script).state, 'script_review');
  });
  it('取消在步驟間生效，晚到輸出不採用，保留已耗呼叫與未套用修改', async () => {
    const { q, script, version } = await setup(); const current = await reviewScript(script);
    const edit = await RecutReviewEvent.create({ scriptId: script._id, versionId: current._id, kind: 'edit', sentenceId: 's1', originalLabel: '結論或定義', action: 'remove' });
    await transitionRecut({ scriptId: script._id, event: 'set_pending_edits', pendingEditId: edit._id });
    const started = deferred(); const release = deferred(); let nextRan = false;
    q.registerSteps('apply_selection', [
      { id: 'cards', stage: 'cards', run: async ({ runAttempt }) => {
        await runAttempt({ input: { sentence: 's1' }, modelId: 'fake-model', consumesCall: true, execute: async () => {
          started.resolve(); await release.promise; return { output: { version: payload(version) }, validation: { valid: true }, usageMetadata: { totalTokenCount: 19 } };
        } }); return {};
      } },
      { id: 'check', stage: 'wholeCheck', run: async () => { nextRan = true; return {}; } },
    ]);
    const task = await enqueue(q, script, { type: 'apply_selection' }); await started.promise;
    await q.requestCancel(task._id); release.resolve(); await q.idle();
    assert.equal(taskFor(task._id).status, 'cancelled'); assert.equal(nextRan, false); assert.equal(taskFor(task._id).callsUsed, 1);
    assert.equal(String(snapshot(script).currentVersionId), String(current._id)); assert.equal(String(snapshot(script).pendingEditId), String(edit._id));
    assert.ok(store.recutAttempts.some((a) => a.status === 'discarded' && a.usageMetadata?.totalTokenCount === 19));
    await assert.rejects(() => transitionRecut({ scriptId: script._id, event: 'approve_script', versionId: current._id, actorId: ids.teacher }), { code: 'RECUT_STATE_INVALID' });
  });
  it('另一件工作執行期間取消排隊工作，該工作永不執行', async () => {
    const { q, script, version } = await setup(); const other = seedScript(); const started = deferred(); const release = deferred();
    let count = 0;
    q.registerSteps('generate', [{ id: 'wait', stage: 'selection', run: async () => { count++; started.resolve(); await release.promise; return { version: payload(version) }; } }]);
    await enqueue(q, script); await started.promise;
    const task = await enqueue(q, other); await q.requestCancel(task._id);
    release.resolve(); await q.idle();
    assert.equal(taskFor(task._id).status, 'cancelled'); assert.equal(count, 1); assert.equal(snapshot(other).state, 'idle');
  });
  it('步驟失敗回原版並保留錯誤原因，完成與失敗均通知教師', async () => {
    const { q, script } = await setup(); const current = await reviewScript(script);
    q.registerSteps('generate', [{ id: 'bad-source', stage: 'sourceCheck', run: async () => { const error = new Error('fake source is missing audio'); error.code = 'FAKE_NO_AUDIO'; throw error; } }]);
    const task = await enqueue(q, script); await q.idle();
    assert.equal(taskFor(task._id).status, 'failed'); assert.equal(taskFor(task._id).error.code, 'FAKE_NO_AUDIO');
    assert.equal(String(snapshot(script).currentVersionId), String(current._id));
    assert.equal(store.notifications.length, 1); assert.equal(String(store.notifications[0].recipientId), ids.teacher);
    assert.match(store.notifications[0].content, /missing audio/);
    assert.equal(store.recutAttempts[0].status, 'failed');
  });
  it('每次嘗試保存輸入、輸出、驗證、模型、usageMetadata 與耗時，可由步驟重試', async () => {
    const { q, script, version } = await setup();
    q.registerSteps('generate', [{ id: 'retry', stage: 'selection', run: async ({ runAttempt }) => {
      await assert.rejects(() => runAttempt({ input: { revision: 1 }, consumesCall: true, modelId: 'fake-id', execute: async () => ({ output: { bad: true }, validation: { valid: false, errors: ['bad range'] }, usageMetadata: { totalTokenCount: 7 } }) }), { code: 'RECUT_VALIDATION_FAILED' });
      await runAttempt({ input: { previous: 'bad range' }, consumesCall: true, modelId: 'fake-id', execute: async () => ({ output: { ok: true }, validation: { valid: true }, usageMetadata: { totalTokenCount: 8 } }) });
      return { version: payload(version) };
    } }]);
    const task = await enqueue(q, script); await q.idle();
    const attempts = store.recutAttempts.filter((a) => a.consumesCall);
    assert.equal(attempts.length, 2); assert.equal(attempts[0].input.revision, 1); assert.equal(attempts[0].output.bad, true);
    assert.equal(attempts[0].validation.valid, false); assert.equal(attempts[0].usageMetadata.totalTokenCount, 7);
    assert.equal(attempts[1].modelId, 'fake-id'); assert.ok(attempts[1].durationMs >= 0);
    assert.equal(taskFor(task._id).callsUsed, 2); assert.equal(taskFor(task._id).status, 'succeeded');
  });
  it('初次生成與修改讀不同設定鍵；上限在開始時固定且共用，不因執行中設定更動而改變', async () => {
    let configured = 3; const keys = [];
    const { q, script, version } = await setup('generate', { getSetting: async (key) => { keys.push(key); return configured; } });
    q.registerSteps('generate', [{ id: 'budget', stage: 'wholeCheck', run: async ({ runAttempt }) => {
      configured = 99;
      for (let i = 0; i < 4; i++) await runAttempt({ consumesCall: true, execute: async () => ({ output: { index: i } }) });
      return { version: payload(version) };
    } }]);
    const task = await enqueue(q, script); await q.idle();
    assert.equal(taskFor(task._id).callLimit, 3); assert.equal(taskFor(task._id).callsUsed, 3);
    assert.equal(taskFor(task._id).error.code, 'RECUT_CALL_LIMIT_EXCEEDED');
    await reviewScript(script); q.stop();
    q.registerSteps('apply_suggestions', [{ id: 'suggestions', stage: 'cards', run: async () => ({}) }]);
    const modification = await enqueue(q, script, { type: 'apply_suggestions' });
    assert.equal(modification.callLimit, 99); assert.deepEqual(keys, ['recut.initialCallLimit', 'recut.modificationCallLimit']);
  });
  it('設定不能繞過必需檢查；初次生成至少 3 次，修改至少 2 次', async () => {
    const { q, script } = await setup('generate', { getSetting: async () => 2 });
    await assert.rejects(() => enqueue(q, script), { code: 'RECUT_SETTING_INVALID' });
    assert.equal(store.recutTasks.length, 0);
  });
  it('重啟後步驟 ID 已變更時不猜測續跑，失敗並恢復原版', async () => {
    const { q, script } = await setup(); q.stop(); const task = await enqueue(q, script);
    q.registerSteps('generate', [{ id: 'new-step-v2', stage: 'selection', run: async () => ({}) }]);
    await q.recover(); assert.equal(taskFor(task._id).error.code, 'RECUT_STEPS_NOT_CONFIGURED'); assert.equal(snapshot(script).state, 'idle');
  });
});
