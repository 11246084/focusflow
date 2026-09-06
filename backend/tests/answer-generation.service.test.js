const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const { env } = require('./helpers/backendTestHarness');
const {
  buildPrompt,
  buildTemplateAnswer,
  generateAnswer,
  isNoAnswerReply,
  parseStructuredAnswer,
  NO_ANSWER_INSUFFICIENT,
  NO_ANSWER_UNDETERMINED,
} = require('../src/services/answerGeneration.service');

const originalFetch = global.fetch;
const originalConsoleError = console.error;

function createMatches() {
  return [
    {
      segmentId: 'segment-1',
      videoId: 'video-1',
      startSec: 12,
      endSec: 34,
      transcript: '學生只能存取已發布課程或已選課課程，teacher 與 admin 可以管理課程與影片。',
      score: 0.9,
    },
    {
      segmentId: 'segment-2',
      videoId: 'video-1',
      startSec: 35,
      endSec: 50,
      transcript: '第二段說明教師可以發布課程。',
      score: 0.8,
    },
    {
      segmentId: 'segment-3',
      videoId: 'video-1',
      startSec: 51,
      endSec: 70,
      transcript: '第三段補充管理員可以管理所有使用者。',
      score: 0.7,
    },
  ];
}

afterEach(() => {
  global.fetch = originalFetch;
  console.error = originalConsoleError;
  env.qaAnswerProvider = 'template';
  env.openaiApiKey = '';
  env.openaiChatModel = 'gpt-4o-mini';
  env.geminiApiKey = '';
  env.geminiChatModel = 'gemini-3.5-flash';
});

describe('isNoAnswerReply', () => {
  it('辨識「資料庫片段不足」的罐頭回覆', () => {
    assert.equal(isNoAnswerReply(NO_ANSWER_INSUFFICIENT), true);
  });

  it('辨識「無法從提供的影片片段判斷」的罐頭回覆', () => {
    assert.equal(isNoAnswerReply(NO_ANSWER_UNDETERMINED), true);
  });

  it('容許模型多包引號或改動結尾標點', () => {
    assert.equal(isNoAnswerReply('「目前資料庫片段不足以回答這個問題」'), true);
  });

  it('不誤判正常答案', () => {
    assert.equal(
      isNoAnswerReply('這門課主要講授 AI 應用中的影像處理部分。（依據：第一講 4.53-32.22s）'),
      false,
    );
  });

  it('不誤判只是提到片段不足的長答案', () => {
    assert.equal(
      isNoAnswerReply('目前資料庫片段不足以回答這個問題，但根據第三講可以推測影像處理的流程。'),
      false,
    );
  });

  it('空值不算罐頭回覆', () => {
    assert.equal(isNoAnswerReply(''), false);
    assert.equal(isNoAnswerReply(null), false);
    assert.equal(isNoAnswerReply(undefined), false);
  });
});

describe('buildPrompt', () => {
  it('用 opaque S1...Sn 列出所有命中片段，不暴露內部 segment/video ID', () => {
    const prompt = buildPrompt('教師可以做什麼？', createMatches());

    assert.match(prompt, /證據 ID：S1/);
    assert.match(prompt, /證據 ID：S2/);
    assert.match(prompt, /證據 ID：S3/);
    assert.equal(prompt.includes('segment-1'), false);
    assert.equal(prompt.includes('video-1'), false);
  });

  it('要求整合所有相關片段而非只取分數最高的一筆', () => {
    const prompt = buildPrompt('教師可以做什麼？', createMatches());

    assert.match(prompt, /必須逐一整合成一個完整答案/);
    assert.match(prompt, /不可只取分數最高的一筆/);
  });

  it('要求時間定位題把時間區間當成答案主體', () => {
    const prompt = buildPrompt('這段在哪裡講的？', createMatches());

    assert.match(prompt, /時間區間就是答案主體/);
  });

  it('允許部分回答，只有完全沒提到主題時才拒答', () => {
    const prompt = buildPrompt('教師可以做什麼？', createMatches());

    assert.match(prompt, /只要片段能支持部分答案，就先回答能確定的部分/);
    assert.match(prompt, /只有在所有片段都沒有提到問題的主題時/);
    assert.ok(prompt.includes(NO_ANSWER_INSUFFICIENT));
  });

  it('不再要求模型在片段不夠明確時回覆 NO_ANSWER_UNDETERMINED', () => {
    const prompt = buildPrompt('教師可以做什麼？', createMatches());

    assert.equal(prompt.includes(NO_ANSWER_UNDETERMINED), false);
  });

  it('要求把 STT 誤寫的專有名詞寫成正確名稱，且不列出錯字變體', () => {
    const prompt = buildPrompt('這門課提到哪些大語言模型？', createMatches());

    assert.match(prompt, /答案要直接寫成正確名稱/);
    assert.match(prompt, /不要在答案中列出逐字稿的錯字變體/);
  });

  it('要求排除口頭數數並禁止自相矛盾', () => {
    const prompt = buildPrompt('那篇論文被引用幾次？', createMatches());

    assert.match(prompt, /口頭數數/);
    assert.match(prompt, /答案本身不可自相矛盾/);
  });

  it('要求每個結論有直接證據且只回實際使用的證據 ID', () => {
    const prompt = buildPrompt('比較兩種方法。', createMatches());

    assert.match(prompt, /每個事實結論都必須由至少一個證據 ID 的內容直接支持/);
    assert.match(prompt, /不可把所有片段一律列為依據/);
    assert.match(prompt, /supportingEvidenceIds/);
  });

  it('要求遵守教材明示分類並維持同句多例的同類關係', () => {
    const prompt = buildPrompt('請整理教材中的分類。', createMatches());

    assert.match(prompt, /教材若明示某個項目的分類、定義或歸屬/);
    assert.match(prompt, /不可用常識或外部知識改成另一種分類/);
    assert.match(prompt, /多個例子列為同一類/);
    assert.match(prompt, /不可自行拆成不同類/);
    assert.match(prompt, /逐項核對問題中的每個項目與教材的明示結論/);
    assert.match(prompt, /緊接的同影片片段/);
    assert.match(prompt, /不可依項目的外觀或用途自行補判/);
  });

  it('同影片片段依時間連續呈現且保留原 retrieval 證據 ID', () => {
    const prompt = buildPrompt('請依教材判斷分類。', [
      {
        videoId: 'video-a', startSec: 80, endSec: 96, transcript: 'A 後段結論',
      },
      {
        videoId: 'video-b', startSec: 10, endSec: 20, transcript: 'B 片段',
      },
      {
        videoId: 'video-a', startSec: 65, endSec: 80, transcript: 'A 前段項目',
      },
    ]);

    assert.ok(prompt.indexOf('證據 ID：S3') < prompt.indexOf('證據 ID：S1'));
    assert.ok(prompt.indexOf('證據 ID：S1') < prompt.indexOf('證據 ID：S2'));
    assert.match(prompt, /證據 ID：S3[\s\S]*A 前段項目[\s\S]*證據 ID：S1[\s\S]*A 後段結論/);
  });
});

describe('parseStructuredAnswer', () => {
  it('接受合法證據 ID 並移除重複值', () => {
    const result = parseStructuredAnswer(JSON.stringify({
      answer: '教材指出教師可以發布課程。',
      supportingEvidenceIds: ['S2', 'S2'],
    }), createMatches());

    assert.deepEqual(result, {
      text: '教材指出教師可以發布課程。',
      supportingEvidenceIds: ['S2'],
    });
  });

  it('拒答一律不攜帶證據 ID', () => {
    const result = parseStructuredAnswer(JSON.stringify({
      answer: NO_ANSWER_INSUFFICIENT,
      supportingEvidenceIds: ['S1'],
    }), createMatches());

    assert.deepEqual(result, {
      text: NO_ANSWER_INSUFFICIENT,
      supportingEvidenceIds: [],
    });
  });

  it('拒絕 answered response 的未知證據 ID', () => {
    assert.throws(
      () => parseStructuredAnswer(JSON.stringify({
        answer: '有根據的答案。',
        supportingEvidenceIds: ['S99'],
      }), createMatches()),
      (error) => error.code === 'ANSWER_PROVIDER_INVALID_RESPONSE'
        && error.details.reason === 'unknown_supporting_evidence',
    );
  });
});

describe('answer generation service', () => {
  it('uses Gemini to generate grounded answers when configured', async () => {
    const matches = createMatches();
    const capturedRequests = [];

    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = 'gemini-test-key';
    env.geminiChatModel = 'gemini-3.5-flash';
    global.fetch = async (url, options) => {
      capturedRequests.push({ url, options });

      return {
        ok: true,
        async text() {
          return JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        answer: 'Gemini grounded answer.',
                        supportingEvidenceIds: ['S1', 'S3'],
                      }),
                    },
                  ],
                },
              },
            ],
          });
        },
      };
    };

    const result = await generateAnswer('學生與老師的權限差在哪裡？', matches);

    assert.equal(result.text, 'Gemini grounded answer.');
    assert.equal(result.provider, 'gemini');
    assert.equal(result.fallback, null);
    assert.deepEqual(result.supportingEvidenceIds, ['S1', 'S3']);
    assert.equal(capturedRequests.length, 1);
    assert.match(capturedRequests[0].url, /models\/gemini-3\.5-flash:generateContent$/);
    assert.equal(capturedRequests[0].options.headers['x-goog-api-key'], 'gemini-test-key');
    assert.match(capturedRequests[0].options.body, /學生與老師的權限差在哪裡/);
    assert.match(capturedRequests[0].options.body, /teacher 與 admin 可以管理課程與影片/);
    assert.match(capturedRequests[0].options.body, /第二段說明教師可以發布課程/);
    assert.match(capturedRequests[0].options.body, /第三段補充管理員可以管理所有使用者/);
    const requestBody = JSON.parse(capturedRequests[0].options.body);
    assert.equal(requestBody.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(
      requestBody.generationConfig.responseSchema.required,
      ['answer', 'supportingEvidenceIds'],
    );
  });

  it('uses the same structured answer parser for OpenAI', async () => {
    env.qaAnswerProvider = 'openai';
    env.openaiApiKey = 'openai-test-key';
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                answer: 'OpenAI grounded answer.',
                supportingEvidenceIds: ['S2'],
              }),
            },
          }],
        };
      },
    });

    const result = await generateAnswer('教師可以做什麼？', createMatches());

    assert.equal(result.text, 'OpenAI grounded answer.');
    assert.equal(result.provider, 'openai');
    assert.equal(result.fallback, null);
    assert.deepEqual(result.supportingEvidenceIds, ['S2']);
  });

  it('falls back to the S1 template when an answered Gemini response has no evidence IDs', async () => {
    const matches = createMatches();
    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = 'gemini-test-key';
    console.error = () => {};
    global.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async text() {
        return JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  answer: '沒有證據 ID 的回答。',
                  supportingEvidenceIds: [],
                }),
              }],
            },
          }],
        });
      },
    });

    const result = await generateAnswer('教師可以做什麼？', matches);

    assert.equal(result.text, buildTemplateAnswer('教師可以做什麼？', matches));
    assert.equal(result.provider, 'template');
    assert.equal(result.fallback.code, 'ANSWER_PROVIDER_INVALID_RESPONSE');
    assert.deepEqual(result.supportingEvidenceIds, ['S1']);
  });

  it('falls back to the S1 template when OpenAI returns an unknown evidence ID', async () => {
    const matches = createMatches();
    env.qaAnswerProvider = 'openai';
    env.openaiApiKey = 'openai-test-key';
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                answer: '引用未知 ID 的回答。',
                supportingEvidenceIds: ['S4'],
              }),
            },
          }],
        };
      },
    });

    const result = await generateAnswer('教師可以做什麼？', matches);

    assert.equal(result.provider, 'template');
    assert.equal(result.fallback.from, 'openai');
    assert.equal(result.fallback.code, 'ANSWER_PROVIDER_INVALID_RESPONSE');
    assert.deepEqual(result.supportingEvidenceIds, ['S1']);
  });

  it('template answers cite S1 and empty retrieval cites nothing', async () => {
    const withMatches = await generateAnswer('教師可以做什麼？', createMatches());
    const withoutMatches = await generateAnswer('教師可以做什麼？', []);

    assert.deepEqual(withMatches.supportingEvidenceIds, ['S1']);
    assert.deepEqual(withoutMatches.supportingEvidenceIds, []);
  });

  it('marks template fallback explicitly when Gemini fails', async () => {
    const matches = createMatches();

    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = 'gemini-test-key';
    console.error = () => {};
    global.fetch = async () => {
      throw new Error('network timeout');
    };

    const result = await generateAnswer('學生與老師的權限差在哪裡？', matches);

    assert.equal(result.text, buildTemplateAnswer('學生與老師的權限差在哪裡？', matches));
    assert.equal(result.provider, 'template');
    assert.equal(result.fallback.stage, 'answer');
    assert.equal(result.fallback.from, 'gemini');
    assert.equal(result.fallback.to, 'template');
    assert.equal(result.fallback.code, 'ANSWER_PROVIDER_ERROR');
    assert.deepEqual(result.supportingEvidenceIds, ['S1']);
  });

  it('logs only provider response length and the first 80 characters', async () => {
    const responseBody = `${'P'.repeat(80)}${'SECRET_AFTER_PREVIEW'.repeat(4)}`;
    const logged = [];

    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = 'gemini-test-key';
    console.error = (...args) => logged.push(args);
    global.fetch = async () => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      async text() { return responseBody; },
    });

    await generateAnswer('學生與老師的權限差在哪裡？', createMatches());

    const failureLog = logged.find(([event]) => event === '[answer-generation] Gemini request failed');
    assert.ok(failureLog);
    assert.equal(failureLog[1].responseBodyLength, responseBody.length);
    assert.equal(failureLog[1].responseBodyPreview, 'P'.repeat(80));
    assert.equal(Object.hasOwn(failureLog[1], 'responseBody'), false);
    assert.equal(JSON.stringify(failureLog).includes('SECRET_AFTER_PREVIEW'), false);
  });

  it('treats empty Gemini content as a provider failure', async () => {
    const matches = createMatches();
    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = 'gemini-test-key';
    console.error = () => {};
    global.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async text() {
        return JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] });
      },
    });

    const result = await generateAnswer('學生與老師的權限差在哪裡？', matches);

    assert.equal(result.provider, 'template');
    assert.equal(result.fallback.code, 'ANSWER_PROVIDER_EMPTY_RESPONSE');
    assert.deepEqual(result.supportingEvidenceIds, ['S1']);
  });

  it('fails fast when gemini is selected without an API key', async () => {
    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = '';

    await assert.rejects(
      () => generateAnswer('學生與老師的權限差在哪裡？', createMatches()),
      (error) => error.code === 'ANSWER_PROVIDER_NOT_CONFIGURED',
    );
  });
});
