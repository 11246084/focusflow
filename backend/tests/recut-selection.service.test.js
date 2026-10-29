const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids } = require('./helpers/backendTestHarness');
const { sourceData, selection } = require('./helpers/recutSelectionFixtures');
const { seedScript, snapshot } = require('./helpers/recutFixtures');
const { createRecutSource } = require('../src/services/recutState.service');
const { validateSelection: validate } = require('../src/services/recutSelectionValidation.service');
const { createRecutSelectionStep } = require('../src/services/recutSelection.service');
const { createRecutDecisionPoint } = require('../src/services/recutDecision.service');
const { createRecutQueue } = require('../src/services/recutQueue.service');
const { getSetting } = require('../src/services/recutSettings.service');
const queues = [];
const source = sourceData();
const label = (s, id, value) => { s.sentenceLabels.find((l) => l.sentenceId === id).label = value; return s; };
async function pipeline(outputs, { limit = 5, model = 'fixed-gemini' } = {}) {
  const script = seedScript({ sourceQuestions: Array.from({ length: 8 }, (_, i) => ({ question: `問法${i}`, askCount: i })) });
  const src = await createRecutSource({ ...sourceData(), scriptId: script._id });
  const calls = [];
  const decide = createRecutDecisionPoint({ apiKey: 'fixture-key', fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const output = outputs[Math.min(calls.length - 1, outputs.length - 1)];
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: typeof output === 'string' ? output : JSON.stringify(output) }] } }],
      modelVersion: 'provider-version', usageMetadata: { totalTokenCount: 11 } }) };
  } });
  const q = createRecutQueue({ getSetting: async () => limit, captureSettings: () => ({ model: { provider: 'gemini', model } }) }); queues.push(q);
  let downstreamCalls = 0;
  q.registerSteps('generate', [createRecutSelectionStep({ decide, readSetting: () => { throw new Error('固定後不得重讀設定'); } }),
    { id: 'fake-cards-final', stage: 'cards', run: async ({ data }) => { downstreamCalls++; return { version: { sourceId: src._id, selection: data.selection,
      fullScript: data.fullScript, modelId: data.modelId, shortRenderVersion: 'fixture', plan: { schemaVersion: 'recut-v1' } } }; } }]);
  const task = await q.enqueue({ script, requestedBy: ids.teacher, input: { sourceId: src._id } }); await q.idle();
  return { script, calls, task: store.recutTasks.find((t) => String(t._id) === String(task._id)), downstreamCalls,
    attempts: store.recutAttempts.filter((a) => a.consumesCall), version: store.recutVersions.find((v) => String(v._id) === String(snapshot(script).currentVersionId)) };
}
describe('recut 第一步選段與逐字驗證', () => {
  beforeEach(resetStore);
  afterEach(async () => { for (const q of queues) { q.stop(); await q.idle(); } queues.length = 0; });
  it('正常範圍以實際剪點計算，保留片段內停頓與原話', () => {
    const result = validate(source, selection()); assert.equal(result.valid, true); assert.equal(result.durationSec, 37);
    assert.equal(result.clips[0].startSec, 108); assert.match(result.fullScript, /句2的定義/);
  });
  it('多段範圍依時間播放，不把片段間空隙算入總長', () => {
    const s = selection(2, 10); s.ranges = [{ from: 's2', to: 's4' }, { from: 's8', to: 's10' }];
    for (const id of ['s5', 's6', 's7']) label(s, id, '離題');
    assert.equal(validate(source, s).durationSec, 42);
  });
  it('句內微調只比對邊界那一句，找不到或跨句不得採用', () => {
    const s = selection(); s.ranges[0].startAt = '工具'; assert.equal(validate(source, s).valid, false);
    s.ranges[0].startAt = '句2'; s.ranges[0].endAt = '的定義'; assert.equal(validate(source, s).valid, true);
  });
  it('句內錨點不唯一或切在缺時間的字詞內時拒絕', () => {
    const s = selection(); s.ranges[0].startAt = '定'; assert.equal(validate(source, s).valid, false);
    const src = structuredClone(source); src.sentences[1].words[1].text = '句2句2'; s.ranges[0].startAt = '句2';
    assert.equal(validate(src, s).valid, false);
  });
  it('錨點不得混同小數點、負號與程式符號', () => {
    for (const [original, anchor] of [['1.5', '15'], ['C#', 'C'], ['-1', '1']]) {
      const src = structuredClone(source); src.sentences[1].words[0].text = original;
      const s = selection(); s.ranges[0].startAt = anchor; s.ranges[0].endAt = undefined;
      delete s.ranges[0].endAt;
      // startAt:'C' 是同字詞的前綴，無法證明完整原話片語，必須拒絕。
      assert.equal(validate(src, s).valid, false);
    }
  });
  it('保留標籤與範圍矛盾拒絕', () => { assert.equal(validate(source, label(selection(), 's3', '離題')).valid, false); });
  it('漏標、重複標籤與未知句子拒絕', () => {
    const s = selection(); s.sentenceLabels.pop(); assert.equal(validate(source, s).valid, false);
    s.sentenceLabels.push(s.sentenceLabels[0]); assert.equal(validate(source, s).valid, false);
    s.sentenceLabels[0].sentenceId = 's999'; assert.equal(validate(source, s).valid, false);
  });
  it('總長不足或超過均拒絕', () => { assert.equal(validate(source, selection(2, 3)).valid, false); assert.equal(validate(source, selection(2, 12)).valid, false); });
  it('頭尾指畫面先自動剪除再重算，原始輸出不被改寫', () => {
    const s = label(label(selection(2, 8), 's2', '指畫面'), 's8', '指畫面');
    const result = validate(source, s); assert.equal(result.valid, true); assert.equal(result.durationSec, 37);
    assert.deepEqual(result.selection.ranges, [{ from: 's3', to: 's7' }]); assert.equal(s.ranges[0].from, 's2');
    assert.equal(validate(source, label(label(selection(), 's2', '指畫面'), 's6', '指畫面')).valid, false);
  });
  it('中間指畫面不自動剪，矛盾須重試而不是默默跳句', () => { assert.equal(validate(source, label(selection(), 's4', '指畫面')).valid, false); });
  it('冷開場搬到最前僅一次、長句不得冒充短片頭', () => {
    const s = label(selection(1, 6), 's1', '冷開場'); s.openingSentenceId = 's1';
    const result = validate(source, s); assert.equal(result.valid, true); assert.equal(result.durationSec, 39);
    assert.deepEqual(result.selection.ranges, [{ from: 's2', to: 's6' }]); assert.equal(result.clips.filter((c) => c.sentenceIds.includes('s1')).length, 1);
    label(s, 's1', '結論或定義'); label(s, 's2', '冷開場'); s.openingSentenceId = 's2'; assert.equal(validate(source, s).valid, false);
  });
  it('倒序、重疊範圍與未定義欄位拒絕', () => {
    const s = selection(); s.ranges.push({ from: 's4', to: 's6' }); assert.equal(validate(source, s).valid, false);
    assert.equal(validate(source, { ...selection(), invented: 1 }).valid, false);
    assert.equal(validate(source, { ...selection(), lockedSentenceIds: ['s2'] }).valid, false);
  });
  it('假 fetch 正常選段記用量與模型版本，問題只取次數最高五個且加星', async () => {
    const r = await pipeline([selection()]); assert.equal(r.task.status, 'succeeded'); assert.equal(r.task.callsUsed, 1);
    const request = r.calls[0].body; assert.equal(Object.hasOwn(request.generationConfig, 'temperature'), false);
    for (const key of ['topP', 'topK']) assert.equal(Object.hasOwn(request.generationConfig, key), false);
    assert.ok(request.generationConfig.responseSchema); assert.match(r.calls[0].url, /fixed-gemini/);
    const input = JSON.parse(request.contents[0].parts[0].text); assert.deepEqual(input.variants.map((v) => v.askCount), [7, 6, 5, 4, 3]);
    assert.equal(input.sentences[2].marker, '★'); assert.equal(r.attempts[0].modelId, 'provider-version');
    assert.equal(r.attempts[0].usageMetadata.totalTokenCount, 11); assert.ok(r.attempts[0].durationMs >= 0);
  });
  it('無法回答存每句跳過與原因，停止且不重試、不配圖', async () => {
    const output = selection(20, 21, { answerable: false, ranges: [], unanswerableReason: '沒有解釋差異' });
    const r = await pipeline([output]); assert.equal(r.calls.length, 1); assert.equal(r.downstreamCalls, 0); assert.equal(r.task.status, 'succeeded');
    assert.equal(r.version.plan, null); assert.equal(r.version.selection.unanswerableReason, '沒有解釋差異');
  });
  it('格式錯誤重試附前次輸出與錯誤，使用同一池且保留失敗紀錄', async () => {
    const r = await pipeline([label(selection(), 's3', '離題'), selection()]); assert.equal(r.task.callsUsed, 2);
    const input = JSON.parse(r.calls[1].body.contents[0].parts[0].text); assert.match(input.previousOutput, /離題/); assert.match(input.errors[0], /矛盾/);
    assert.equal(r.attempts[0].status, 'failed'); assert.equal(r.attempts[1].status, 'succeeded');
  });
  it('JSON 錯誤保留原始回應並附錯誤重試', async () => {
    const r = await pipeline(['not-json', selection()]); assert.equal(r.task.status, 'succeeded'); assert.equal(r.attempts[0].output, 'not-json');
  });
  it('額度耗盡任務失敗還原，所有嘗試與最後錯誤保留', async () => {
    const r = await pipeline([selection(2, 3)], { limit: 3 }); assert.equal(r.calls.length, 3); assert.equal(r.task.status, 'failed');
    assert.equal(r.task.error.code, 'RECUT_CALL_LIMIT_EXCEEDED'); assert.equal(snapshot(r.script).state, 'idle'); assert.equal(r.attempts.length, 3);
  });
  it('設定轉接讀模型物件與兩種上限，非法值交由 queue 拒絕', () => {
    assert.equal(getSetting('recut.geminiModel').provider, 'gemini'); assert.equal(getSetting('recut.initialCallLimit'), 5);
    assert.equal(getSetting('recut.modificationCallLimit'), 5); assert.throws(() => getSetting('missing'));
  });
  it('HTTP 失敗保留用量，不洩漏金鑰到 URL 或輸入紀錄', async () => {
    let url;
    const decide = createRecutDecisionPoint({ apiKey: 'secret-fixture', fetchImpl: async (u) => { url = u; return { ok: false, json: async () => ({ usageMetadata: { totalTokenCount: 7 } }) }; } });
    await assert.rejects(() => decide({ model: { provider: 'gemini', model: 'fake' }, input: {}, instructions: '', responseSchema: {} }), (e) => e.code === 'RECUT_MODEL_FAILED' && e.usageMetadata.totalTokenCount === 7);
    assert.equal(url.includes('secret-fixture'), false);
  });
  it('排隊時固定模型與上限，後來設定改動不影響該任務', async () => {
    const script = seedScript(); const src = await createRecutSource({ ...sourceData(), scriptId: script._id });
    let model = 'old-model', limit = 3, seen;
    const q = createRecutQueue({ getSetting: () => limit, captureSettings: () => ({ model: { provider: 'gemini', model } }) }); queues.push(q); q.stop();
    q.registerSteps('generate', [createRecutSelectionStep({ decide: async (r) => { seen = r.model.model;
      return { output: selection(20, 21, { answerable: false, unanswerableReason: '沒有答案', ranges: [] }), modelId: r.model.model }; } })]);
    const task = await q.enqueue({ script, requestedBy: ids.teacher, input: { sourceId: src._id } }); model = 'new-model'; limit = 9;
    await q.recover(); assert.equal(seen, 'old-model'); assert.equal(task.callLimit, 3);
  });
  it('其他腳本的來源拒絕，不呼叫模型', async () => {
    const script = seedScript(), other = seedScript(); const src = await createRecutSource({ ...sourceData(), scriptId: other._id });
    let calls = 0; const step = createRecutSelectionStep({ decide: async () => { calls++; } });
    await assert.rejects(() => step.run({ task: { scriptId: script._id }, data: { sourceId: src._id } }), { code: 'RECUT_SOURCE_INVALID' });
    assert.equal(calls, 0);
  });
});
