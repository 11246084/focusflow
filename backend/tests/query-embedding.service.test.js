const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const env = require('../src/config/env');
const {
  GEMINI_EMBEDDING_MODEL,
  GEMINI_QUERY_EMBEDDING_DIMENSIONS,
  embedWithGemini,
} = require('../src/services/queryEmbedding.service');

const originalFetch = global.fetch;
const originalKey = env.geminiApiKey;
const originalModel = env.geminiEmbeddingModelName;

afterEach(() => {
  global.fetch = originalFetch;
  env.geminiApiKey = originalKey;
  env.geminiEmbeddingModelName = originalModel;
});

describe('query embedding service', () => {
  it('uses the stable Gemini text-search instruction without taskType and normalizes 3072 dimensions', async () => {
    env.geminiApiKey = 'test-gemini-key';
    let request;
    const vector = Array.from({ length: GEMINI_QUERY_EMBEDDING_DIMENSIONS }, () => 0);
    vector[0] = 3;
    vector[1] = 4;

    global.fetch = async (url, options) => {
      request = { url, headers: options.headers, body: JSON.parse(options.body) };
      return {
        ok: true,
        async json() {
          return { embedding: { values: vector } };
        },
      };
    };

    const result = await embedWithGemini('  how does hierarchy work?  ');

    assert.equal(GEMINI_EMBEDDING_MODEL, 'gemini-embedding-2');
    assert.equal(result.length, GEMINI_QUERY_EMBEDDING_DIMENSIONS);
    assert.equal(result[0], 0.6);
    assert.equal(result[1], 0.8);
    assert.equal(Math.hypot(...result), 1);
    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent');
    assert.equal(request.url.includes('test-gemini-key'), false);
    assert.equal(request.headers['x-goog-api-key'], 'test-gemini-key');
    assert.equal(request.body.model, 'models/gemini-embedding-2');
    assert.equal(
      request.body.content.parts[0].text,
      'task: search result | query: how does hierarchy work?',
    );
    assert.equal(Object.hasOwn(request.body, 'embedContentConfig'), false);
    assert.equal(Object.hasOwn(request.body, 'taskType'), false);
    assert.equal(request.body.output_dimensionality, 3072);
  });

  it('rejects preview or non-contract Gemini models before making a request', async () => {
    env.geminiApiKey = 'test-gemini-key';
    env.geminiEmbeddingModelName = 'gemini-embedding-2-preview';
    let called = false;
    global.fetch = async () => {
      called = true;
    };

    await assert.rejects(
      embedWithGemini('question'),
      (error) => error.code === 'EMBEDDING_CONTRACT_INVALID',
    );
    assert.equal(called, false);
  });

  for (const [name, response] of [
    ['wrong dimensions', { embedding: { values: [1] } }],
    ['non-finite values', {
      embedding: {
        values: Array.from({ length: GEMINI_QUERY_EMBEDDING_DIMENSIONS }, (_, index) => (
          index ? 0 : Infinity
        )),
      },
    }],
    ['zero vector', {
      embedding: { values: Array(GEMINI_QUERY_EMBEDDING_DIMENSIONS).fill(0) },
    }],
  ]) {
    it(`returns a safe provider error for ${name}`, async () => {
      env.geminiApiKey = 'secret-key';
      global.fetch = async () => ({
        ok: true,
        async json() {
          return response;
        },
      });

      await assert.rejects(
        embedWithGemini('question'),
        (error) => error.code === 'EMBEDDING_PROVIDER_ERROR'
          && !String(error.message).includes('secret-key'),
      );
    });
  }

  it('returns a safe provider error for HTTP and invalid JSON responses', async () => {
    env.geminiApiKey = 'secret-key';
    global.fetch = async () => ({
      ok: false,
      async text() {
        return 'secret-key';
      },
    });

    await assert.rejects(
      embedWithGemini('question'),
      (error) => error.code === 'EMBEDDING_PROVIDER_ERROR',
    );

    global.fetch = async () => ({
      ok: true,
      async json() {
        throw new Error('bad json');
      },
    });

    await assert.rejects(
      embedWithGemini('question'),
      (error) => error.code === 'EMBEDDING_PROVIDER_ERROR',
    );
  });

  it('classifies provider network failures without exposing credentials', async () => {
    env.geminiApiKey = 'secret-key';
    global.fetch = async () => {
      throw new Error('network failure');
    };

    await assert.rejects(
      embedWithGemini('question'),
      (error) => error.code === 'EMBEDDING_PROVIDER_ERROR'
        && !String(error.message).includes('secret-key'),
    );
  });
});

describe('Gemini embedding 的逾時與重試', () => {
  const originalDelay = env.qaProviderRetryDelayMs;
  const originalTimeout = env.qaEmbeddingTimeoutMs;
  const vectorReply = () => {
    const values = Array.from({ length: GEMINI_QUERY_EMBEDDING_DIMENSIONS }, () => 0);
    values[0] = 1;
    return { ok: true, status: 200, json: async () => ({ embedding: { values } }) };
  };

  afterEach(() => {
    env.qaProviderRetryDelayMs = originalDelay;
    env.qaEmbeddingTimeoutMs = originalTimeout;
  });

  it('暫時失敗（429、503）時重試，第三次成功就回傳向量', async () => {
    env.geminiApiKey = 'test-gemini-key';
    env.qaProviderRetryDelayMs = 0;
    const statuses = [429, 503];
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      const status = statuses[calls - 1];
      return status ? { ok: false, status } : vectorReply();
    };

    const result = await embedWithGemini('問題');

    assert.equal(calls, 3);
    assert.equal(result[0], 1);
  });

  it('一直卡住時逾時重試，用完次數回報 EMBEDDING_PROVIDER_ERROR', async () => {
    env.geminiApiKey = 'test-gemini-key';
    env.qaProviderRetryDelayMs = 0;
    env.qaEmbeddingTimeoutMs = 30;
    let calls = 0;
    global.fetch = async (_url, options) => {
      calls += 1;
      // Keep only this fake pending transport alive, with a bounded failure
      // deadline; the production AbortSignal timeout remains under test.
      let watchdog, onAbort;
      return new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('timeout signal did not fire')), 1500);
        onAbort = () => reject(options.signal.reason);
        options.signal.addEventListener('abort', onAbort, { once: true });
        if (options.signal.aborted) onAbort();
      }).finally(() => {
        clearTimeout(watchdog);
        options.signal.removeEventListener('abort', onAbort);
      });
    };
    const startedAt = Date.now();

    await assert.rejects(embedWithGemini('問題'), { code: 'EMBEDDING_PROVIDER_ERROR' });

    assert.equal(calls, 3);
    assert.ok(Date.now() - startedAt < 2000);
  });

  it('金鑰錯誤（403）不重試', async () => {
    env.geminiApiKey = 'test-gemini-key';
    env.qaProviderRetryDelayMs = 0;
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return { ok: false, status: 403 };
    };

    await assert.rejects(embedWithGemini('問題'), { code: 'EMBEDDING_PROVIDER_ERROR' });

    assert.equal(calls, 1);
  });
});
