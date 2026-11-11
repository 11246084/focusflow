const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./helpers/recutPipelineFixtures');
const { createRecutCodeCardHandler, validateCodeLines, toRendererCodeParams } = require('../src/services/recutCodeCard.service');
function setup(options = {}) {
  const c = context(); const scene = { id: 'code1', component: 'code', from: 's1', to: 's2', params: { language: 'python' } };
  let calls = 0;
  const handler = createRecutCodeCardHandler({ capture: async () => ({ frames: ['fake-frame'], variables: ['x'] }),
    extract: async () => { calls++; return { output: { readable: true, lines: ['x = 1'] }, usageMetadata: { totalTokenCount: 10 } }; },
    review: async () => { calls++; return { output: { readable: true, lines: ['x = 1', 'print(x)'] }, usageMetadata: { totalTokenCount: 12 } }; },
    toCodeParams: toRendererCodeParams, ...options });
  return { c: { ...c, source: c.source, scene }, handler, get calls() { return calls; } };
}
describe('recut 程式碼圖卡分離額度與來源', () => {
  it('最多兩次額外呼叫，逐次記用量且不扣共用額度', async () => {
    const r = setup(); const result = await r.handler(r.c);
    assert.equal(result.component, 'code'); assert.equal(r.calls, 2); assert.equal(r.c.task.callsUsed, 1);
    assert.deepEqual(r.c.attempts.map((a) => a.usageMetadata.totalTokenCount), [10, 12]); assert.ok(r.c.attempts.every((a) => a.consumesCall === false));
    assert.deepEqual(result.params.lines.map((l) => l.source), ['畫面原樣', 'AI 補寫']);
    const next = await r.handler({ ...r.c, scene: { ...r.c.scene, id: 'renamed' } }); assert.equal(next.component, 'quote-reveal'); assert.equal(r.calls, 2);
  });
  it('看不清楚時替換文字圖卡，不失敗整支片', async () => {
    const r = setup({ capture: async () => ({ readable: false }) }); assert.equal((await r.handler(r.c)).component, 'quote-reveal'); assert.equal(r.calls, 0);
  });
  it('外部辨識錯誤也fallback且不洩漏provider錯誤', async () => {
    const r = setup({ extract: async () => { throw new Error('private provider error'); } }); assert.equal((await r.handler(r.c)).component, 'quote-reveal');
  });
  it('行數、字數、完整變數名稱皆驗證', () => {
    for (const lines of [Array(13).fill('x'), ['x'.repeat(37)], ['xx = 1']]) assert.equal(validateCodeLines({ readable: true, lines }, { variables: ['x'] }).valid, false);
  });
  it('故意錯誤保留原行，修正它會fallback', async () => {
    const r = setup({ capture: async () => ({ frames: ['fake'], variables: ['x'], intentionalErrorLines: [1] }),
      review: async () => ({ output: { readable: true, lines: ['x = 2'] } }) });
    assert.equal((await r.handler(r.c)).component, 'quote-reveal');
    assert.equal(validateCodeLines({ readable: true, lines: ['x = 1'] }, { originals: ['x = 1'], intentionalErrorLines: [1] }).valid, true);
  });
  it('取消不轉fallback', async () => {
    const r = setup(); r.c.checkCancelled = async () => { throw Object.assign(new Error('cancel'), { code: 'RECUT_TASK_CANCELLED' }); };
    await assert.rejects(r.handler(r.c), { code: 'RECUT_TASK_CANCELLED' });
  });
});
