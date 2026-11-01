const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids, newObjectId } = require('./helpers/backendTestHarness');
const { makeReview, suggest, assetFor, teacher } = require('./helpers/recutReviewFixtures');
const { snapshot } = require('./helpers/recutFixtures');
const { createRecutQueue } = require('../src/services/recutQueue.service');
const { createRecutReviewService } = require('../src/services/recutReview.service');
const { registerRecutReviewSteps } = require('../src/services/recutReviewSteps.service');
const { transitionRecut } = require('../src/services/recutState.service');
const ReviewEvent = require('../src/models/recutReviewEvent.model');
const RecutVersion = require('../src/models/recutVersion.model');
const RecutTask = require('../src/models/recutTask.model');
const queues = [];
const options = (f, extra = {}) => ({ user: teacher, scriptId: f.script._id, versionId: String(snapshot(f.script).currentVersionId), expectedRevision: snapshot(f.script).revision, ...extra });
async function setup(config = {}) {
  const f = await makeReview(config); const q = createRecutQueue(config.queueOptions || {}); queues.push(q);
  const service = createRecutReviewService({ queue: q, ...config });
  return { ...f, q, service };
}
function install(f, { fail = false, mutate = false, pause } = {}) {
  registerRecutReviewSteps({ cards: { id: 'fake-review-cards-v1', stage: 'cards', run: async ({ runAttempt, data }) => {
    await runAttempt({ input: { suggestions: data.adoptedSuggestions }, modelId: 'fake', consumesCall: true,
      execute: async () => ({ output: { cards: [] }, validation: { valid: true }, usageMetadata: { totalTokenCount: 3 } }) });
    if (pause) await pause(); if (fail) throw new Error('假的配圖失敗');
    return { newPlan: { ...f.version.plan, cards: (data.adoptedSuggestions || []).map((s) => s.id) } };
  } }, wholeCheck: { id: 'fake-review-check-v1', stage: 'wholeCheck', run: async ({ data, runAttempt }) => {
    await runAttempt({ input: data.selection, modelId: 'fake', consumesCall: true, execute: async () => ({ output: {}, validation: { valid: true } }) });
    return { version: { sourceId: data.sourceId, selection: mutate ? { ...data.selection, ranges: [{ from: 's2', to: 's6' }] } : data.selection,
      fullScript: data.fullScript, plan: data.newPlan, modelId: 'fake', shortRenderVersion: 'fixture', theme: 'N2' } };
  } } }, f.q);
}
const edit = (f, changes) => f.service.editSelection(options(f, { changes }));
const apply = (f) => f.service.applySelection(options(f));
const taskFor = (task) => store.recutTasks.find((t) => String(t._id) === String(task.id));
describe('recut 審閱、草稿、鎖定與兩階段核准', () => {
  beforeEach(resetStore);
  afterEach(async () => { for (const q of queues) { q.stop(); await q.idle(); } queues.length = 0; });
  it('逐字稿升級後審閱使用凍結句子，不回查新chunk並明示來源更新', async () => {
    const f = await setup();
    store.videos.find((video) => String(video._id) === ids.teacherVideo).activeTranscriptVersion = 'upgrade-new';
    const Model = require('../src/models/videoSegment.model'); const original = Model.find;
    Model.find = () => { throw new Error('Must not resolve a frozen chunk against current transcript'); };
    let view;
    try { view = await f.service.getReview(options(f)); } finally { Model.find = original; }
    assert.equal(view.source.transcriptVersion, 'legacy'); assert.equal(view.source.sourceUpdated, true);
    assert.match(view.source.notice, /來源已更新/); assert.equal(view.source.sentences[0].text, f.source.sentences[0].text);
  });
  it('完整講稿由實際原話組成，視窗回每句時間、理由、保留與片頭', async () => {
    const f = await setup({ opening: true }); const view = await f.service.getReview(options(f));
    assert.equal(view.source.transcriptVersion, 'legacy'); assert.equal(view.source.sourceUpdated, false); assert.equal(view.source.notice, null);
    assert.equal(view.current.durationSec, 39); assert.match(view.fullScript, /^工具不同。/); assert.equal(view.source.sentences.length, 16);
    assert.equal(view.source.sentences[0].opening, true); assert.equal(view.source.sentences[6].selected, false); assert.equal(view.source.filePath, undefined);
  });
  it('未套用修改可讀、即時計長；核准及渲染均被擋，原版不變', async () => {
    const f = await setup(); const result = await edit(f, [{ sentenceId: 's7', action: 'add', reasonLabel: '漏了重點' }]);
    assert.equal(result.current.durationSec, 37); assert.equal(result.draft.durationSec, 42); assert.equal(result.draft.durationValid, true);
    assert.equal(result.source.sentences[6].teacherChanged, true); assert.equal(result.source.sentences[6].originalLabel, '離題');
    assert.equal(store.recutReviewEvents.find((e) => e.kind === 'edit').reasonLabel, '漏了重點');
    await assert.rejects(() => f.service.approveScript(options(f)), { code: 'RECUT_STATE_INVALID' });
    await assert.rejects(() => f.service.queueRender(options(f)), { code: 'RECUT_STATE_INVALID' });
    assert.equal(String(snapshot(f.script).currentVersionId), String(f.version._id));
  });
  it('移除片頭明確回提示，不悄悄換片頭', async () => {
    const f = await setup({ opening: true }); const view = await edit(f, [{ sentenceId: 's1', action: 'remove' }]);
    assert.equal(view.draft.selection.openingSentenceId, null); assert.match(view.draft.warnings[0], /移除後會改變開場/);
    assert.equal(view.draft.durationSec, 37);
  });
  it('長度超出時可保留草稿但不能套用；全部移除顯示0秒', async () => {
    const f = await setup();
    const view = await edit(f, [2, 3, 4, 5, 6].map((i) => ({ sentenceId: `s${i}`, action: 'remove' })));
    assert.equal(view.draft.durationSec, 0); assert.equal(view.draft.durationValid, false);
    await assert.rejects(() => apply(f), { code: 'RECUT_DURATION_INVALID' }); assert.equal(store.recutTasks.length, 0);
  });
  it('加回過多內容超過65秒，仍顯示草稿長度並拒絕套用', async () => {
    const f = await setup(); const result = await edit(f, Array.from({ length: 9 }, (_, i) => ({ sentenceId: `s${i + 7}`, action: 'add' })));
    assert.ok(result.draft.durationSec > 65); assert.equal(result.draft.durationValid, false);
    await assert.rejects(() => apply(f), { code: 'RECUT_DURATION_INVALID' });
  });
  it('復原全部或逐句改回原狀都恢復原施工單，不建立任務', async () => {
    const f = await setup(); await edit(f, [{ sentenceId: 's7', action: 'add' }]);
    const restored = await edit(f, [{ sentenceId: 's7', action: 'remove' }]); assert.equal(restored.draft, null);
    await edit(f, [{ sentenceId: 's7', action: 'add' }]); const result = await f.service.restoreSelection(options(f));
    assert.equal(result.draft, null); assert.equal(store.recutTasks.length, 0); assert.equal(store.recutVersions.length, 1);
    assert.ok(store.recutReviewEvents.filter((e) => e.kind === 'edit').every((e) => e.revertedAt));
  });
  it('過時revision與並行修改不得覆蓋後來草稿', async () => {
    const f = await setup(); const old = options(f, { changes: [{ sentenceId: 's7', action: 'add' }] });
    const results = await Promise.allSettled([f.service.editSelection(old), f.service.editSelection({ ...old, changes: [{ sentenceId: 's8', action: 'add' }] })]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(store.recutReviewEvents.filter((e) => e.kind === 'edit').length, 1);
  });
  it('RC4尚未註冊回503且保留草稿', async () => {
    const f = await setup(); await edit(f, [{ sentenceId: 's7', action: 'add' }]);
    await assert.rejects(() => apply(f), { code: 'RECUT_STEPS_NOT_CONFIGURED' }); assert.ok(snapshot(f.script).pendingEditId); assert.equal(store.recutTasks.length, 0);
  });
  it('附加任務後資料庫寫入失敗，在同一鎖還原而不死鎖', { timeout: 5000 }, async () => {
    const f = await setup(); install(f); await edit(f, [{ sentenceId: 's7', action: 'add' }]);
    const update = RecutTask.findByIdAndUpdate;
    RecutTask.findByIdAndUpdate = function (id, change, ...rest) {
      if (change.$set?.readyAt) throw new Error('fake ready failure');
      return update.call(this, id, change, ...rest);
    };
    try { await assert.rejects(() => apply(f), { message: 'fake ready failure' }); }
    finally { RecutTask.findByIdAndUpdate = update; }
    assert.equal(snapshot(f.script).state, 'script_review'); assert.ok(snapshot(f.script).pendingEditId);
    assert.equal(snapshot(f.script).activeTaskId, null); assert.equal(store.recutTasks[0].status, 'failed');
  });
  it('套用後選段鎖定，重跑配圖及檢查成功才切新版並清草稿', async () => {
    const f = await setup(); install(f); await edit(f, [{ sentenceId: 's7', action: 'add' }]);
    const task = await apply(f); await f.q.idle(); assert.equal(taskFor(task).status, 'succeeded');
    assert.equal(taskFor(task).callsUsed, 2); assert.equal(snapshot(f.script).pendingEditId, null); assert.equal(snapshot(f.script).state, 'script_review');
    const current = await f.service.getReview(options(f)); assert.ok(current.current.selection.lockedSentenceIds.includes('s7'));
    assert.match(current.latestChangeSummary.changes[0], /加回/); assert.equal(current.latestChangeSummary.fromVersionId, String(f.version._id));
  });
  it('第三步推翻鎖定會失敗，恢復原版且草稿保留', async () => {
    const f = await setup(); install(f, { mutate: true }); await edit(f, [{ sentenceId: 's7', action: 'add' }]); const pending = snapshot(f.script).pendingEditId;
    const task = await apply(f); await f.q.idle(); assert.equal(taskFor(task).error.code, 'RECUT_LOCKED_SELECTION_CHANGED');
    assert.equal(String(snapshot(f.script).currentVersionId), String(f.version._id)); assert.equal(String(snapshot(f.script).pendingEditId), String(pending));
  });
  it('配圖失敗回原版，修改與原因保留', async () => {
    const f = await setup(); install(f, { fail: true }); await edit(f, [{ sentenceId: 's7', action: 'add' }]);
    const task = await apply(f); await f.q.idle(); assert.equal(taskFor(task).status, 'failed');
    assert.equal(String(snapshot(f.script).currentVersionId), String(f.version._id)); assert.ok((await f.service.getReview(options(f))).draft);
  });
  it('執行中取消丟棄晚到結果，回原版並保留未套用修改', async () => {
    let started, release; const running = new Promise((r) => { started = r; }); const gate = new Promise((r) => { release = r; });
    const f = await setup(); install(f, { pause: async () => { started(); await gate; } }); await edit(f, [{ sentenceId: 's7', action: 'add' }]);
    const task = await apply(f); await running; await f.q.requestCancel(task.id); release(); await f.q.idle();
    assert.equal(taskFor(task).status, 'cancelled'); assert.ok(snapshot(f.script).pendingEditId); assert.equal(String(snapshot(f.script).currentVersionId), String(f.version._id));
  });
  it('處理中不能再改草稿、核准或復原', async () => {
    const f = await setup(); install(f); f.q.stop(); await edit(f, [{ sentenceId: 's7', action: 'add' }]); await apply(f);
    await assert.rejects(() => edit(f, [{ sentenceId: 's8', action: 'add' }]), { code: 'RECUT_STATE_INVALID' });
    await assert.rejects(() => f.service.restoreSelection(options(f)), { code: 'RECUT_STATE_INVALID' });
    await assert.rejects(() => f.service.approveScript(options(f)), { code: 'RECUT_STATE_INVALID' });
  });
  it('採納多個建議共用一個任務與額度，未採納的不傳入步驟', async () => {
    const f = await setup(); install(f); const a = await suggest(f), b = await suggest(f, { proposedChange: '縮短第二張字幕' }), c = await suggest(f);
    const task = await f.service.applySuggestions(options(f, { suggestionIds: [String(a._id), String(b._id)] })); await f.q.idle();
    assert.equal(store.recutTasks.length, 1); assert.equal(taskFor(task).callLimit, 5); assert.equal(taskFor(task).callsUsed, 2);
    assert.deepEqual(taskFor(task).input.adoptedSuggestions.map((s) => s.id), [String(a._id), String(b._id)]);
    assert.equal(store.recutReviewEvents.find((s) => String(s._id) === String(c._id)).adopted, false);
  });
  it('推翻教師鎖定選段須明確確認，確認後才排任務', async () => {
    const f = await setup({ locked: ['s7'] }); install(f); const s = await suggest(f, { kind: 'selection', changes: [{ sentenceId: 's7', action: 'add' }], impact: '加回教師移除的例子' });
    assert.equal((await f.service.getReview(options(f))).suggestions[0].requiresSelectionConfirmation, true);
    await assert.rejects(() => f.service.applySuggestions(options(f, { suggestionIds: [String(s._id)] })), { code: 'RECUT_LOCK_CONFIRM_REQUIRED' });
    assert.equal(store.recutTasks.length, 0);
    const task = await f.service.applySuggestions(options(f, { suggestionIds: [String(s._id)], confirmedSelectionChangeIds: [String(s._id)] }));
    await f.q.idle(); assert.equal(taskFor(task).status, 'succeeded');
    const audit = store.recutReviewEvents.find((e) => e.kind === 'edit' && String(e.suggestionId) === String(s._id));
    assert.equal(audit.originalLabel, '離題');
  });
  it('模型不得改到未採納的呈現範圍', async () => {
    const f = await setup(); install(f); const a = await suggest(f, { allowedPaths: ['/plan/title'] });
    const task = await f.service.applySuggestions(options(f, { suggestionIds: [String(a._id)] })); await f.q.idle();
    assert.equal(taskFor(task).status, 'failed'); assert.equal(taskFor(task).error.code, 'RECUT_SUGGESTION_SCOPE_CHANGED');
    assert.equal(String(snapshot(f.script).currentVersionId), String(f.version._id));
  });
  it('建議與檢查重試共用修改任務上限，不另開新額度', async () => {
    const f = await setup({ queueOptions: { getSetting: () => 2 } }); const a = await suggest(f);
    registerRecutReviewSteps({ cards: { id: 'budget-cards', stage: 'cards', run: async ({ runAttempt }) => {
      for (let i = 0; i < 3; i++) await runAttempt({ consumesCall: true, input: {}, modelId: 'fake', execute: async () => ({ output: {} }) });
    } }, wholeCheck: { id: 'budget-check', stage: 'wholeCheck', run: async () => ({}) } }, f.q);
    const task = await f.service.applySuggestions(options(f, { suggestionIds: [String(a._id)] })); await f.q.idle();
    assert.equal(taskFor(task).callsUsed, 2); assert.equal(taskFor(task).error.code, 'RECUT_CALL_LIMIT_EXCEEDED'); assert.equal(store.recutTasks.length, 1);
  });
  it('只改呈現保留講稿核准、清成品並重審；改內容回講稿審閱', async () => {
    const f = await setup(); install(f); await f.service.approveScript(options(f)); await f.service.queueRender(options(f)); await assetFor(f);
    const a = await suggest(f); const task = await f.service.applySuggestions(options(f, { suggestionIds: [String(a._id)] })); await f.q.idle();
    assert.equal(taskFor(task).status, 'succeeded'); assert.equal(snapshot(f.script).state, 'script_approved'); assert.equal(snapshot(f.script).currentAssetId, null);
    assert.equal(store.recutApprovals.filter((a) => a.type === 'script').length, 2);
    await edit(f, [{ sentenceId: 's7', action: 'add' }]); await apply(f); await f.q.idle(); assert.equal(snapshot(f.script).state, 'script_review');
  });
  it('講稿核准記版本，未核准不得排製作；成品核准須精確MP4', async () => {
    const f = await setup(); await assert.rejects(() => f.service.queueRender(options(f)), { code: 'RECUT_STATE_INVALID' });
    await f.service.approveScript(options(f)); await f.service.queueRender(options(f)); const asset = await assetFor(f);
    await assert.rejects(() => f.service.approveAsset(options(f, { assetId: String(asset._id), generationVersion: 2 })), { code: 'RECUT_STATE_INVALID' });
    await f.service.approveAsset(options(f, { assetId: String(asset._id), generationVersion: 1 })); assert.equal(snapshot(f.script).state, 'asset_approved');
    assert.equal(asset.status, 'draft'); assert.equal(store.recutApprovals.filter((a) => a.type === 'asset').length, 1);
  });
  it('全部不採納仍能核准，未決定建議結算false', async () => {
    const f = await setup(); const s = await suggest(f); await f.service.approveScript(options(f));
    assert.equal(store.recutReviewEvents.find((e) => String(e._id) === String(s._id)).adopted, false);
  });
  it('儲存講稿若與原話選段不一致，不能核准另一份文字', async () => {
    const f = await setup(); store.recutVersions.find((v) => String(v._id) === String(f.version._id)).fullScript = '不在來源的講稿';
    await assert.rejects(() => f.service.approveScript(options(f)), { code: 'RECUT_STATE_INVALID' }); assert.equal(store.recutApprovals.length, 0);
  });
  it('計時跨新版仍可停止，但其他操作者不能接管', async () => {
    let clock = 0; const f = await setup({ now: () => new Date(clock) }); install(f);
    const time = await f.service.recordTime(options(f, { action: 'start', phase: 'script_review' }));
    await edit(f, [{ sentenceId: 's7', action: 'add' }]); await apply(f); await f.q.idle(); clock = 3000;
    const stop = { ...options(f), versionId: String(f.version._id), action: 'stop', phase: 'script_review', timingId: time.id };
    await assert.rejects(() => f.service.recordTime({ ...stop, user: { id: ids.admin, role: 'admin' } }), { code: 'VALIDATION_ERROR' });
    assert.equal((await f.service.recordTime(stop)).durationMs, 3000);
  });
  it('三段操作時間分開記錄，重送停止不改時間', async () => {
    let clock = 0; const f = await setup({ now: () => new Date(clock) });
    const start = (phase) => f.service.recordTime(options(f, { phase, action: 'start' }));
    const stop = (t, phase) => f.service.recordTime(options(f, { phase, action: 'stop', timingId: t.id }));
    const scriptTime = await start('script_review'); clock = 5000; assert.equal((await stop(scriptTime, 'script_review')).durationMs, 5000);
    clock = 10000; await f.service.approveScript(options(f)); await f.service.queueRender(options(f)); const wait = await start('production_wait');
    clock = 12000; assert.equal((await stop(wait, 'production_wait')).durationMs, 2000); await assetFor(f);
    clock = 20000; const assetTime = await start('asset_review'); clock = 27000; assert.equal((await stop(assetTime, 'asset_review')).durationMs, 7000);
    clock = 99000; assert.equal((await stop(assetTime, 'asset_review')).durationMs, 7000);
    assert.deepEqual(store.recutReviewEvents.filter((e) => e.kind === 'timing').map((e) => e.phase), ['script_review', 'production_wait', 'asset_review']);
  });
  it('無法回答版本可讀原因但不能從零選句或核准', async () => {
    const f = await setup(); const selection = { answerable: false, unanswerableReason: '原話未回答', ranges: [], openingSentenceId: null, lockedSentenceIds: [],
      sentenceLabels: f.version.selection.sentenceLabels.map((s) => ({ ...s, label: '離題' })) };
    const version = await RecutVersion.create({ scriptId: f.script._id, sourceId: f.source._id, selection, modelId: 'fake', shortRenderVersion: 'not-rendered' });
    await transitionRecut({ scriptId: f.script._id, event: 'revise', versionId: version._id });
    assert.equal((await f.service.getReview(options(f))).current.selection.unanswerableReason, '原話未回答');
    await assert.rejects(() => edit(f, [{ sentenceId: 's7', action: 'add' }]), { code: 'RECUT_REVIEW_NOT_READY' });
  });
});
