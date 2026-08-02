const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const env = require('../src/config/env');
const {
  GEMINI_EMBEDDING_MODEL,
  GEMINI_QUERY_EMBEDDING_DIMENSIONS,
  embedWithGemini,
} = require('../src/services/queryEmbedding.service');

const originalFetch = global.fetch;
const originalGeminiApiKey = env.geminiApiKey;

afterEach(() => {
  global.fetch = originalFetch;
  env.geminiApiKey = originalGeminiApiKey;
});

describe('query embedding service', () => {
  it('uses the Gemini retrieval-query contract paired with Parent document embeddings', async () => {
    env.geminiApiKey = 'test-gemini-key';
    let request;
    const providerVector = Array.from({ length: GEMINI_QUERY_EMBEDDING_DIMENSIONS }, () => 0);
    providerVector[0] = 3;
    providerVector[1] = 4;
    global.fetch = async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        async json() { return { embedding: { values: providerVector } }; },
      };
    };

    const result = await embedWithGemini('how does hierarchy work?');

    assert.equal(result.length, GEMINI_QUERY_EMBEDDING_DIMENSIONS);
    assert.equal(result[0], 0.6);
    assert.equal(result[1], 0.8);
    assert.equal(request.url.includes(`/models/${GEMINI_EMBEDDING_MODEL}:embedContent`), true);
    assert.equal(request.body.embedContentConfig.taskType, 'RETRIEVAL_QUERY');
    assert.equal(
      request.body.embedContentConfig.outputDimensionality,
      GEMINI_QUERY_EMBEDDING_DIMENSIONS,
    );
    assert.equal(request.body.model, `models/${GEMINI_EMBEDDING_MODEL}`);
  });
});
