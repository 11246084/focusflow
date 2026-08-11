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
