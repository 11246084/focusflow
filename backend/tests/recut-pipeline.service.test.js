const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, fakeRenderer, context } = require('./helpers/recutPipelineFixtures');
const { createRecutPipeline } = require('../src/services/recutPipeline.service');
const { validateIssues } = require('../src/services/recutWholeCheck.service');
const { restrictPresentation } = require('../src/services/recutCards.service');
const { ISSUE_TYPES } = require('../src/prompts/recutWholeCheck');
function issue(type, extra = {}) { return { type, problem: '待修問題', proposedChange: '修正此處', impact: '圖卡文字變更', sentenceIds: ['s1'], selectionChanges: ISSUE_TYPES[type].target === 'selection' ? [{ sentenceId: 's1', action: 'remove' }] : [],
  presentationPaths: ISSUE_TYPES[type].target === 'cards' ? ['/plan/scenes/0/params'] : [], ...extra }; }
function pipeline(outputs, c = context(), extra = {}) {
  let calls = 0;
  const p = createRecutPipeline({ decide: async () => ({ output: outputs[calls++], usageMetadata: { totalTokenCount: 9 } }),
    renderer: fakeRenderer(), loadSource: async () => c.source, sourceSteps: [], selectionStep: { id: 'selection', stage: 'selection', run: async () => ({}) }, ...extra });
  return { p, c, get calls() { return calls; } };
}
async function run(r) { Object.assign(r.c.data, await r.p.cards.run(r.c)); Object.assign(r.c.data, await r.p.wholeCheck.run(r.c)); return r.c.data; }
describe('recut RC4 生成與整段檢查', () => {
  it('正常配圖後驗證才回版本，固定增益與版本來自程式', async () => {
    const r = pipeline([fixture().cards, { issues: [] }]); const data = await run(r);
    assert.equal(data.version.plan.audio.gainDb, 2); assert.equal(data.version.shortRenderVersion, 'fixture-renderer');
    assert.equal(r.c.task.callsUsed, 3); assert.ok(r.c.attempts.every((a) => a.usageMetadata.totalTokenCount === 9));
  });
  it('不允許模型輸出剪接欄位，修正記前次輸出與錯誤', async () => {
    const bad = { ...fixture().cards, clips: [] }; const r = pipeline([bad, fixture().cards, { issues: [] }]); await run(r);
    assert.equal(r.c.task.callsUsed, 4); assert.deepEqual(r.c.attempts[1].input.previousOutput, bad); assert.ok(r.c.attempts[1].input.errors.length);
  });
  for (const [type, routing] of Object.entries(ISSUE_TYPES)) it(`${type} 由程式分類為 ${routing.severity}/${routing.target}`, () => {
    const f = fixture(); const result = validateIssues({ issues: [issue(type)] }, f.source, { scenes: f.cards.scenes, subtitles: f.cards.subtitles });
    assert.equal(result.valid, true); assert.equal(result.issues[0].target, routing.target); assert.equal(result.issues[0].severity, routing.severity);
  });
  it('模型不可指定severity、未知句或越界呈現路徑', () => {
    const f = fixture(); for (const bad of [issue('card_mismatch', { severity: 'quality' }), issue('card_mismatch', { sentenceIds: ['s99'] }), issue('card_mismatch', { presentationPaths: ['/plan/clips/0'] })]) {
      assert.equal(validateIssues({ issues: [bad] }, f.source, f.cards).valid, false);
    }
  });
  it('只剩一次先修可信度，品質轉建議', async () => {
    const c = context(); c.task.callsUsed = 2;
    const r = pipeline([fixture().cards, { issues: [issue('card_mismatch'), issue('unsupported_number')] }, fixture().cards], c);
    const data = await run(r); assert.equal(c.task.callsUsed, 5); assert.equal(data.suggestions.length, 1);
    assert.equal(data.suggestions[0].suggestionType, 'card_mismatch');
    assert.deepEqual(c.attempts[2].input.errors.map((i) => i.type), ['unsupported_number']);
  });
  it('可信度錯誤沒有額度時失敗，不回版本', async () => {
    const c = context(); c.task.callsUsed = 3; const r = pipeline([fixture().cards, { issues: [issue('unsupported_number')] }], c);
    await assert.rejects(run(r), { code: 'RECUT_CALL_LIMIT_EXCEEDED' }); assert.equal(c.data.version, undefined);
  });
  it('品質沒額度照樣產出，建議保留明確scope', async () => {
    const c = context(); c.task.callsUsed = 3; const r = pipeline([fixture().cards, { issues: [issue('subtitle_drift')] }], c);
    const data = await run(r); assert.ok(data.version); assert.deepEqual(data.suggestions[0].proposal.allowedPaths, ['/plan/scenes/0/params']);
  });
  it('locked selection的退回第一步問題只轉建議', async () => {
    const c = context({ selectionLocked: true }); let selections = 0;
    const r = pipeline([fixture().cards, { issues: [issue('disconnected_passage')] }], c, { selectionStep: { run: async () => { selections++; } } });
    const data = await run(r); assert.equal(selections, 0); assert.deepEqual(data.version.selection, c.selection); assert.equal(data.suggestions[0].proposal.kind, 'selection');
  });
  it('呈現建議只套指定欄位，其餘保留原版', () => {
    const before = { plan: { scenes: [{ params: { text: '原文' } }, { params: { text: '不變' } }], source: { videoId: 'x' } }, theme: 'N2' };
    const after = structuredClone(before); after.plan.scenes[0].params.text = '採納'; after.plan.scenes[1].params.text = '越界';
    const result = restrictPresentation(after, { before, allowedPaths: ['/plan/scenes/0/params/text'] });
    assert.equal(result.plan.scenes[0].params.text, '採納'); assert.equal(result.plan.scenes[1].params.text, '不變');
    assert.throws(() => restrictPresentation(after, { before, allowedPaths: ['/plan/source'] }));
  });
  it('取消在模型呼叫前停止，沒有產生版本', async () => {
    const c = context(); c.checkCancelled = async () => { throw Object.assign(new Error('cancel'), { code: 'RECUT_TASK_CANCELLED' }); };
    const r = pipeline([fixture().cards], c); await assert.rejects(run(r), { code: 'RECUT_TASK_CANCELLED' }); assert.equal(r.calls, 0);
  });
});
