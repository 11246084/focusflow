const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const { env } = require('./helpers/backendTestHarness');
const {
  buildPrompt,
  buildTemplateAnswer,
  generateAnswer,
  isNoAnswerReply,
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
  it('列出所有命中片段，不只第一筆', () => {
    const prompt = buildPrompt('教師可以做什麼？', createMatches());

    assert.match(prompt, /片段 1/);
    assert.match(prompt, /片段 2/);
    assert.match(prompt, /片段 3/);
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
                      text: 'Gemini grounded answer.',
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
    assert.equal(capturedRequests.length, 1);
    assert.match(capturedRequests[0].url, /models\/gemini-3\.5-flash:generateContent$/);
    assert.equal(capturedRequests[0].options.headers['x-goog-api-key'], 'gemini-test-key');
    assert.match(capturedRequests[0].options.body, /學生與老師的權限差在哪裡/);
    assert.match(capturedRequests[0].options.body, /teacher 與 admin 可以管理課程與影片/);
    assert.match(capturedRequests[0].options.body, /第二段說明教師可以發布課程/);
    assert.match(capturedRequests[0].options.body, /第三段補充管理員可以管理所有使用者/);
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
