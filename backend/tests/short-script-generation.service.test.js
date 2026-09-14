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
      narration: `第 ${shotNo} 拍口白`,
      subtitle: '字幕',
      hookQuestion: `埋問題 ${shotNo}`,
      brollStage: 'S1',
      sfx: '字卡輕點',
      basedOn,
    };
  });
}

function buildPayload(overrides = {}) {
  return {
    arcApplicable: true,
    // 鏡 4（index 3）引用 EVIDENCE[3] = chunk_0004，轉折片段必須落在這一拍。
    reversalBasedOn: ['chunk_0004'],
    globalSettings: {
      coreEvent: '核心事件',
      coreView: '核心觀點',
      audienceAssumption: '觀眾原本以為',
      audienceTakeaway: '看完後發現',
      targetAudience: '目標受眾',
    },
    writingPlan: {
      curiosity: '想知道差在哪',
      delayedAnswer: '延後的答案',
      reversal: '中途的反轉',
      takeaway: '要記住的一句話',
    },
    stageMeanings: { s1: '概念一', s2: '概念二', s3: '概念三' },
    visualMetaphorOptions: [
      { label: '光點', s1: 'a', s2: 'b', s3: 'c', rationale: '光點的輕重對應兩種工具' },
      { label: '光帶', s1: 'a', s2: 'b', s3: 'c', rationale: '光帶的粗細對應兩種工具' },
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

  describe('模板固定規則（10-teacher-avatar-metaphor.md §5）', () => {
    it('拍次角色與時間依位置寫入，第 4 拍是反轉，時間照模板不均分', async () => {
      stubGemini([buildPayload()]);

      const { payload } = await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

      assert.deepEqual(
        payload.shots.map((shot) => shot.arcRole),
        ['hook', 'context', 'reveal', 'reversal', 'evidence', 'climax', 'conclusion', 'ending'],
      );
      // 反轉給最多空間、結尾 1 秒收掉——平均切會抹掉這個節奏。
      assert.deepEqual(
        payload.shots.map((shot) => shot.timeRange),
        ['0:00–0:03', '0:03–0:08', '0:08–0:13', '0:13–0:19', '0:19–0:23', '0:23–0:27', '0:27–0:29', '0:29–0:30'],
      );
    });

    it('模型自己給的 arcRole 與 timeRange 一律不採用', async () => {
      const shots = buildShots().map((shot) => ({ ...shot, arcRole: 'deepen', timeRange: '0:00–0:04' }));
      stubGemini([buildPayload({ shots })]);

      const { payload } = await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

      assert.equal(payload.shots[3].arcRole, 'reversal');
      assert.equal(payload.shots[3].timeRange, '0:13–0:19');
    });

    it('剪輯節奏照模板寫死，埋問題保留模型寫的內容', async () => {
      stubGemini([buildPayload()]);

      const { payload } = await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

      assert.equal(payload.shots[0].cut, '快切');
      assert.equal(payload.shots[3].cut, '突停｜音樂抽掉一拍');
      assert.equal(payload.shots[7].cut, '留白');
      assert.equal(payload.shots[3].hookQuestion, '埋問題 4');
    });

    it('素材依模板分配，只有鏡 01 採用模型的選擇', async () => {
      const shots = buildShots().map((shot) => ({ ...shot, brollStage: 'S3' }));
      stubGemini([buildPayload({ shots })]);

      const { payload } = await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

      assert.deepEqual(
        payload.shots.map((shot) => shot.brollStage),
        ['S3', 'S1', 'S2', 'S2', 'S2', 'S3', 'S3', 'S3'],
      );
      assert.match(payload.shots[3].brollNote, /不換素材/);
    });

    it('鏡 01 的素材不合法時退回預設 S2，不留給教師自己挑', async () => {
      const shots = buildShots();
      shots[0] = { ...shots[0], brollStage: 'S1 / S2 / S3' };
      stubGemini([buildPayload({ shots })]);

      const { payload } = await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

      assert.equal(payload.shots[0].brollStage, 'S2');
    });
  });

  describe('反轉必須落在第 4 拍（規格書 R-06）', () => {
    it('第 4 拍沒有引用轉折片段時退回重生', async () => {
      // 轉折標在 chunk_0001，但第 4 拍引用的是 chunk_0004：形式上有 8 拍，弧線卻沒有轉折。
      const calls = stubGemini([buildPayload({ reversalBasedOn: ['chunk_0001'] })]);

      await assert.rejects(
        () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
        (error) => error.code === 'SHORT_SCRIPT_CITATION_INVALID'
          && error.details.errors.some((message) => message.includes('反轉')),
      );
      assert.equal(calls.length, 3);
    });

    it('沒有標出轉折片段時退回重生', async () => {
      stubGemini([buildPayload({ reversalBasedOn: [] })]);

      await assert.rejects(
        () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
        (error) => error.details.errors.some((message) => message.includes('reversalBasedOn')),
      );
    });

    it('轉折片段不在證據包內時退回重生', async () => {
      stubGemini([buildPayload({ reversalBasedOn: ['chunk_0004', 'chunk_9999'] })]);

      await assert.rejects(
        () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
        (error) => error.details.errors.some((message) => message.includes('chunk_9999')),
      );
    });

    it('第一次反轉放錯拍、第二次修正後通過，且重試時把原因告訴模型', async () => {
      const calls = stubGemini([buildPayload({ reversalBasedOn: ['chunk_0001'] }), buildPayload()]);

      const result = await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

      assert.equal(result.attempts, 2);
      assert.match(calls[1].body.contents[0].parts[0].text, /反轉/);
    });
  });

  describe('模板必填欄位', () => {
    it('寫作四題缺答案時退回重生', async () => {
      stubGemini([buildPayload({ writingPlan: { curiosity: '有', delayedAnswer: '', reversal: '有', takeaway: '有' } })]);

      await assert.rejects(
        () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
        (error) => error.details.errors.some((message) => message.includes('故意延後')),
      );
    });

    it('視覺隱喻缺對應概念時退回重生', async () => {
      stubGemini([buildPayload({ stageMeanings: { s1: '有', s2: '', s3: '有' } })]);

      await assert.rejects(
        () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
        (error) => error.details.errors.some((message) => message.includes('S2')),
      );
    });

    it('視覺隱喻缺「為什麼用這個隱喻」時退回重生', async () => {
      stubGemini([buildPayload({ visualMetaphorOptions: [{ label: '光點', s1: 'a', s2: 'b', s3: 'c' }] })]);

      await assert.rejects(
        () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
        (error) => error.details.errors.some((message) => message.includes('為什麼用這個隱喻')),
      );
    });

    it('前 6 拍缺埋問題時退回重生', async () => {
      const shots = buildShots();
      shots[1] = { ...shots[1], hookQuestion: '' };
      stubGemini([buildPayload({ shots })]);

      await assert.rejects(
        () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
        (error) => error.details.errors.some((message) => message.includes('鏡 2：缺少埋問題')),
      );
    });

    it('鏡 07、08 沒有埋問題不擋（範例也省略，收尾本身就是問句）', async () => {
      const shots = buildShots().map((shot) => (shot.shotNo >= 7 ? { ...shot, hookQuestion: '' } : shot));
      stubGemini([buildPayload({ shots })]);

      const result = await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

      assert.equal(result.attempts, 1);
    });
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

  it('口白出現簡體字時視為驗證失敗並重試（DR-18）', async () => {
    const badShots = buildShots();
    badShots[6].narration = '经典功能直接拿來用，不用自己訓練';

    const calls = stubGemini([
      buildPayload({ shots: badShots }),
      buildPayload(),
    ]);

    const result = await generation.generateScript({ topic: '主題', evidence: EVIDENCE });

    const retryPrompt = calls[1].body.contents[0].parts[0].text;
    assert.equal(result.attempts, 2);
    assert.ok(retryPrompt.includes('簡體字'), '重試的 prompt 應指出簡體字問題');
    assert.ok(retryPrompt.includes('经'), '應指出是哪個字');
  });

  it('字幕出現簡體字也會被攔下', async () => {
    const badShots = buildShots();
    badShots[2].subtitle = '选择合適的工具';

    stubGemini([buildPayload({ shots: badShots })]);

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
      (error) => error.code === 'SHORT_SCRIPT_CITATION_INVALID',
    );
  });

  it('字幕直接複製口白時視為驗證失敗（DR-19）', async () => {
    const badShots = buildShots();
    badShots[0].subtitle = badShots[0].narration;

    stubGemini([buildPayload({ shots: badShots })]);

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
      (error) => error.details.errors.some((message) => message.includes('字幕與口白完全相同')),
    );
  });

  it('字幕過長時視為驗證失敗', async () => {
    const badShots = buildShots();
    badShots[1].subtitle = '這是一段非常長的字幕內容，長到完全不可能在三秒內讀完，違反短字卡的設計';

    stubGemini([buildPayload({ shots: badShots })]);

    await assert.rejects(
      () => generation.generateScript({ topic: '主題', evidence: EVIDENCE }),
      (error) => error.details.errors.some((message) => message.includes('超過上限')),
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

  it('短字卡型字幕不會被誤判', () => {
    const shots = buildShots();
    shots[0].narration = '差別在於，OpenCV 能直接用 CPU 運算；YOLO 通常要靠 GPU。';
    shots[0].subtitle = 'CPU vs GPU';

    const result = generation.validateSubtitles({ shots });
    assert.equal(result.valid, true, `誤判：${result.errors.join('；')}`);
  });

  it('純繁體內容不會被誤判為簡體', () => {
    const shots = buildShots();
    shots[0].narration = '這些工具各有各自的用途，選擇適合的設備與資源，不要殺雞用牛刀。';
    shots[0].subtitle = '經典功能直接拿來用，不需要自己訓練模型。';

    const result = generation.validateTraditionalChinese({ shots });
    assert.equal(result.valid, true, `誤判：${result.errors.join('；')}`);
  });
});
