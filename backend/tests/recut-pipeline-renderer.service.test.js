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
  it('初次製作依保留的原音替換無出處字幕，剪掉的詞不會再進入模型、字幕或錨點', async () => {
    const c = context();
    c.task.type = 'generate';
    const clip = c.data.selectionResult.clips[0];
    clip.words = clip.words.slice(1);
    clip.startSec = clip.words[0].startSec;
    const output = structuredClone(c.cards);
    output.subtitles[0].runs = [{ t: 'OpenCV是工具999' }];
    output.scenes[0].component = 'stat';
    output.scenes[0].params = { value: '工具', unit: '' };
    let input;
    const pipeline = createRecutPipeline({ renderer, loadSource: async () => c.source, sourceSteps: [],
      decide: async (request) => { input = request.input; return { output }; } });
    const result = await pipeline.cards.run(c);
    assert.equal(input.sentences[0].text, '是工具1。');
    assert.deepEqual(result.plan.subtitles[0].runs, [{ t: '是工具1。' }]);
    assert.equal(result.plan.subtitles[0].from.text, '是工具1。');
    assert.equal(result.plan.scenes[0].params.unit, undefined);
    assert.equal(output.scenes[0].params.unit, '');
  });
  for (const [subject, lines] of [
    ['地理', ['等高線連接相同高度', '山頂附近形成閉合曲線', '相鄰線的高差叫等高距', '線距密集表示坡度較陡', '線距寬表示坡度較緩', '沿稜線判讀地勢']],
    ['音樂', ['節拍提供規律的脈動', '小節用來組織節拍', '強拍是重音的位置', '切分音改變重音位置', '休止符表示暫停', '先拍手再唱出節奏']],
  ]) it(`${subject}課的錯誤錨點與倒序字幕依當堂原音修復`, async () => {
    const c = context();
    c.task.type = 'generate';
    c.source.sentences.forEach((s, i) => {
      s.words[0].text = lines[i].slice(0, 2);
      s.words[1].text = lines[i].slice(2);
      s.text = lines[i];
      c.cards.scenes[i].params.text = lines[i];
      c.cards.subtitles[i].runs = [{ t: lines[i] }];
    });
    c.data.selectionResult = require('../src/services/recutSelectionValidation.service').resolveSelection(c.source, c.selection);
    const first = c.cards.subtitles[0];
    first.from.text = '其他課的詞';
    first.runs = [{ t: '錯誤字幕999' }];
    c.cards.scenes[0].cues = { text: first.from };
    c.cards.subtitles.reverse();
    const pipeline = createRecutPipeline({ renderer, loadSource: async () => c.source, sourceSteps: [],
      decide: async () => ({ output: c.cards }) });
    const { plan } = await pipeline.cards.run(c);
    assert.deepEqual(plan.subtitles.map((s) => s.runs.map((r) => r.t).join('')), lines);
    assert.deepEqual(plan.scenes[0].cues, {});
    assert.equal(renderer.validatePlan(plan, { sentences: c.source.sentences, evidence: c.source }).valid, true);
    assert.equal(c.attempts.length, 1);
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
