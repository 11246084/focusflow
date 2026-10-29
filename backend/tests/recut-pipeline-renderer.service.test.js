const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const renderer = require(process.env.RECUT_TEST_RENDERER_ROOT || '../../short_render/src/plan');
const { fixture, context } = require('./helpers/recutPipelineFixtures');
const { createRecutPipeline } = require('../src/services/recutPipeline.service');
const { validateSubtitleSources } = require('../src/services/recutCardsValidation.service');
const { createRecutCodeCardHandler } = require('../src/services/recutCodeCard.service');
async function runCards(output, extras = {}) {
  const c = context(); c.task.callLimit = 2;
  const pipeline = createRecutPipeline({ renderer, decide: async () => ({ output }), loadSource: async () => c.source, sourceSteps: [], selectionStep: { run: async () => ({}) }, ...extras });
  return { result: await pipeline.cards.run(c), c };
}
describe('recut RC4 與 RC5 真實句子契約', () => {
  it('真assembler/validator產出recut-v1與正確gain、模型、素材、renderer版號', async () => {
    const { result, c } = await runCards(fixture().cards);
    const plan = result.plan;
    assert.equal(plan.schemaVersion, 'recut-v1'); assert.equal(plan.contractVersion, 'sentence-v1'); assert.equal(plan.audio.gainDb, 2);
    assert.equal(plan.versions.modelId, 'fake'); assert.equal(plan.versions.shortRender, renderer.SHORT_RENDER_VERSION);
    assert.deepEqual(plan.versions.assets, renderer.ASSET_VERSIONS);
    assert.equal(renderer.validatePlan(plan, { sentences: c.source.sentences, evidence: c.source }).valid, true);
  });
  for (const [label, mutate] of [
    ['卡片超過十二秒', (v) => { v.scenes[0].to = 's3'; }],
    ['缺少句子圖卡', (v) => { v.scenes.shift(); }],
    ['非法icon', (v) => { v.scenes[0].params.icon = 'fluent:beer-mug'; }],
    ['句中換卡', (v) => { v.scenes[0].startAt = 'OpenCV'; }],
    ['字幕新增數字', (v) => { v.subtitles[0].runs[0].t = 'OpenCV 工具999'; }],
    ['字幕新增英文專名', (v) => { v.subtitles[0].runs[0].t = 'TensorFlow'; }],
    ['cue跨句錨點', (v) => { v.scenes[0].cues = { text: { sentenceId: 's1', text: '是工具2。' } }; }],
  ]) it(`${label} 由實際契約拒絕，不能存版本`, async () => {
    const output = fixture().cards; mutate(output); await assert.rejects(runCards(output), { code: 'RECUT_CALL_LIMIT_EXCEEDED' });
  });
  it('字幕來源對證保留負號、小數與程式語言符號，課程詞典只看對應句', () => {
    for (const [sourceText, subtitle] of [['-1', '1'], ['1.5', '15'], ['C#', 'C']]) {
      const f = fixture(); f.source.sentences[0].text = sourceText;
      assert.equal(validateSubtitleSources({ subtitles: [{ from: { sentenceId: 's1' }, runs: [{ t: subtitle }] }] }, f.source).valid, false);
    }
    const f = fixture(); assert.equal(validateSubtitleSources({ subtitles: [{ from: { sentenceId: 's1' }, runs: [{ t: '卷積神經網路' }] }] }, f.source, ['卷積神經網路']).valid, false);
  });
  it('RC6畫面來源code卡可通過真renderer，故意錯誤逐行資料保留', async () => {
    const codeCardHandler = createRecutCodeCardHandler({ capture: async () => ({ frames: ['synthetic'], variables: ['x'], intentionalErrorLines: [1] }),
      extract: async () => ({ output: { readable: true, lines: ['x == 1'] } }), review: async () => ({ output: { readable: true, lines: ['x == 1'] } }) });
    const output = fixture().cards; output.scenes[0] = { ...output.scenes[0], component: 'code', params: { language: 'python' } };
    const { result } = await runCards(output, { codeCardHandler });
    assert.equal(result.plan.scenes[0].params.lines[0].intentionalError, true);
    assert.equal(result.plan.scenes[0].params.lines[0].source, '畫面原樣');
  });
});
