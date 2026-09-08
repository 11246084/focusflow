const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const generation = require('../src/services/shortScriptGeneration.service');
const env = require('../src/config/env');

const originalFetch = global.fetch;
const originalApiKey = env.geminiApiKey;
const originalRetryLimit = env.shortScriptGenerationRetryLimit;

const EVIDENCE = ['A', 'B', 'C', 'D', 'E', 'F'].map((code, index) => ({
  code,
  chunkId: `chunk_000${index + 1}`,
  videoId: 'video-1',
  videoTitle: '第十講',
  startSec: index * 12,
  endSec: (index * 12) + 11,
  rawText: `這是第 ${index + 1} 段逐字稿。`,
}));

function buildShots({ badChunkId = null, templateAtShot = 8, shotCount = 8 } = {}) {
  return Array.from({ length: shotCount }, (unused, index) => {
    const shotNo = index + 1;
    const basedOn = shotNo === templateAtShot
      ? 'template'
      : [badChunkId && shotNo === 3 ? badChunkId : EVIDENCE[index % EVIDENCE.length].chunkId];

    return {
      shotNo,
      arcRole: 'hook',
      timeRange: '0:00–0:03',
      narration: `第 ${shotNo} 拍口白`,
      subtitle: '字幕',
      editing: '快切',
      sfx: '字卡輕點',
      basedOn,
    };
  });
}

function buildPayload(overrides = {}) {
  return {
    arcApplicable: true,
    reversalBasedOn: ['chunk_0003'],
    globalSettings: {
      coreEvent: '核心事件',
      coreView: '核心觀點',
      audienceAssumption: '觀眾原本以為',
      audienceTakeaway: '看完後發現',
      targetAudience: '目標受眾',
    },
    writingFourQuestions: ['一', '二', '三', '四'],
    visualMetaphorOptions: [
      { label: '光點', s1: 'a', s2: 'b', s3: 'c' },
      { label: '光帶', s1: 'a', s2: 'b', s3: 'c' },
    ],
    shots: buildShots(),
    ...overrides,
  };
}

// 依序回傳預設的假回應，並記錄呼叫次數。
function stubGemini(payloads) {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const payload = payloads[Math.min(calls.length - 1, payloads.length - 1)];
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      }),
    };
  };
  return calls;
}

describe('shortScriptGeneration.service', () => {
  beforeEach(() => {
    env.geminiApiKey = 'test-key';
    env.shortScriptGenerationRetryLimit = 2;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    env.geminiApiKey = originalApiKey;
    env.shortScriptGenerationRetryLimit = originalRetryLimit;
  });

  it('引用全部合法時回傳腳本', async () => {
    stubGemini([buildPayload()]);

    const result = await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

    assert.equal(result.payload.shots.length, 8);
    assert.equal(result.attempts, 1);
    assert.equal(result.payload.shots[7].basedOn, 'template');
  });

  it('引用證據包外的 chunkId 時整份退回，重試上限內未通過即回 SHORT_SCRIPT_CITATION_INVALID', async () => {
    const calls = stubGemini([buildPayload({ shots: buildShots({ badChunkId: 'chunk_9999' }) })]);

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
      (error) => error.code === 'SHORT_SCRIPT_CITATION_INVALID',
    );

    // 重試 2 次＝共生成 3 次（DR-07）
    assert.equal(calls.length, 3);
  });

  it('失敗時保留最後一次原始輸出供人工檢視', async () => {
    stubGemini([buildPayload({ shots: buildShots({ badChunkId: 'chunk_9999' }) })]);

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
      (error) => typeof error.details?.rawOutput === 'string' && error.details.rawOutput.length > 0,
    );
  });

  it('第一次失敗、第二次成功時回報嘗試次數', async () => {
    stubGemini([
      buildPayload({ shots: buildShots({ badChunkId: 'chunk_9999' }) }),
      buildPayload(),
    ]);

    const result = await generation.generateScript({ topic: '主題', evidence: EVIDENCE });
    assert.equal(result.attempts, 2);
  });

  it('重試時會把上一次的驗證錯誤帶進 prompt', async () => {
    const calls = stubGemini([
      buildPayload({ shots: buildShots({ badChunkId: 'chunk_9999' }) }),
      buildPayload(),
    ]);

    await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

    const secondPrompt = calls[1].body.contents[0].parts[0].text;
    assert.ok(secondPrompt.includes('chunk_9999'), '重試的 prompt 應指出上次錯在哪');
  });

  it('template 出現在非最後一拍時視為驗證失敗', async () => {
    stubGemini([buildPayload({ shots: buildShots({ templateAtShot: 2 }) })]);

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
      (error) => error.code === 'SHORT_SCRIPT_CITATION_INVALID',
    );
  });

  it('拍數不足 8 拍時視為驗證失敗', async () => {
    stubGemini([buildPayload({ shots: buildShots({ shotCount: 6, templateAtShot: 6 }) })]);

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
      (error) => error.code === 'SHORT_SCRIPT_CITATION_INVALID',
    );
  });

  it('模型判定證據沒有轉折句時回 SHORT_SCRIPT_ARC_NOT_APPLICABLE，不硬生成', async () => {
    stubGemini([{ arcApplicable: false, shots: [] }]);

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
      (error) => error.code === 'SHORT_SCRIPT_ARC_NOT_APPLICABLE',
    );
  });

  it('provider 未設定時 fail-fast，不得靜默 fallback', async () => {
    env.geminiApiKey = '';
    stubGemini([buildPayload()]);

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
      (error) => error.code === 'SHORT_SCRIPT_PROVIDER_NOT_CONFIGURED',
    );
  });

  it('證據包為空時不呼叫 provider', async () => {
    const calls = stubGemini([buildPayload()]);

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: [] }),
      (error) => error.code === 'SHORT_SCRIPT_EVIDENCE_EMPTY',
    );
    assert.equal(calls.length, 0);
  });

  it('輸出不是 JSON 時回 SHORT_SCRIPT_OUTPUT_INVALID', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '這不是 JSON' }] } }] }),
    });

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
      (error) => error.code === 'SHORT_SCRIPT_OUTPUT_INVALID',
    );
  });

  it('輸出被 ```json 包起來時仍能解析', () => {
    const parsed = generation.parseJsonPayload('```json\n{"arcApplicable":true}\n```');
    assert.equal(parsed.arcApplicable, true);
  });

  it('prompt 只包含證據包內的 chunkId', async () => {
    const calls = stubGemini([buildPayload()]);

    await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

    const prompt = calls[0].body.contents[0].parts[0].text;
    for (const item of EVIDENCE) {
      assert.ok(prompt.includes(item.chunkId), `prompt 應含 ${item.chunkId}`);
    }
    assert.ok(prompt.includes('這是第 1 段逐字稿。'), 'prompt 應含 STT 原文');
  });

  it('已用過的視覺隱喻會寫進 prompt 要求避開', async () => {
    const calls = stubGemini([buildPayload()]);

    await generation.generateScript({
      topic: '主題',
      evidence: EVIDENCE,
      usedMetaphors: ['光帶拆解', '節點網路擴張'],
    });

    const prompt = calls[0].body.contents[0].parts[0].text;
    assert.ok(prompt.includes('光帶拆解'));
    assert.ok(prompt.includes('節點網路擴張'));
  });

  it('教師回饋會寫進 prompt', async () => {
    const calls = stubGemini([buildPayload()]);

    await generation.generateScript({
      topic: '主題',
      evidence: EVIDENCE,
      feedback: '開頭不夠吸引人',
    });

    assert.ok(calls[0].body.contents[0].parts[0].text.includes('開頭不夠吸引人'));
  });
});

describe('shortScriptGeneration.validateCitations', () => {
  it('缺少 basedOn 的拍會被指出', () => {
    const shots = buildShots();
    delete shots[2].basedOn;

    const result = generation.validateCitations({ shots }, EVIDENCE);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((message) => message.includes('缺少 basedOn')));
  });

  it('全部合法時 valid 為 true', () => {
    const result = generation.validateCitations({ shots: buildShots() }, EVIDENCE);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });
});
