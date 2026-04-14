const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const { env } = require('./helpers/backendTestHarness');
const { buildTemplateAnswer, generateAnswer } = require('../src/services/answerGeneration.service');

const originalFetch = global.fetch;

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
  ];
}

afterEach(() => {
  global.fetch = originalFetch;
  env.qaAnswerProvider = 'template';
  env.geminiApiKey = '';
  env.geminiChatModel = 'gemini-2.5-flash';
});

describe('answer generation service', () => {
  it('uses Gemini to generate grounded answers when configured', async () => {
    const matches = createMatches();
    const capturedRequests = [];

    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = 'gemini-test-key';
    env.geminiChatModel = 'gemini-2.5-flash';
    global.fetch = async (url, options) => {
      capturedRequests.push({ url, options });

      return {
        ok: true,
        async json() {
          return {
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
          };
        },
      };
    };

    const result = await generateAnswer('學生與老師的權限差在哪裡？', matches);

    assert.equal(result.text, 'Gemini grounded answer.');
    assert.equal(result.provider, 'gemini');
    assert.equal(result.fallback, null);
    assert.equal(capturedRequests.length, 1);
    assert.match(capturedRequests[0].url, /models\/gemini-2\.5-flash:generateContent$/);
    assert.equal(capturedRequests[0].options.headers['x-goog-api-key'], 'gemini-test-key');
    assert.match(capturedRequests[0].options.body, /學生與老師的權限差在哪裡/);
    assert.match(capturedRequests[0].options.body, /teacher 與 admin 可以管理課程與影片/);
  });

  it('marks template fallback explicitly when Gemini fails', async () => {
    const matches = createMatches();

    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = 'gemini-test-key';
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

  it('fails fast when gemini is selected without an API key', async () => {
    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = '';

    await assert.rejects(
      () => generateAnswer('學生與老師的權限差在哪裡？', createMatches()),
      (error) => error.code === 'ANSWER_PROVIDER_NOT_CONFIGURED',
    );
  });
});
