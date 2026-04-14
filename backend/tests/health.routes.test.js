const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const { env, startServer, stopServer, jsonRequest } = require('./helpers/backendTestHarness');

function resetRuntimeEnv() {
  env.qaQueryEmbeddingProvider = 'mock';
  env.qaVectorSearchMode = 'memory';
  env.qaAnswerProvider = 'template';
  env.qaAtlasVectorIndexName = '';
  env.qaAtlasFilterMode = 'bridge_course_or_video';
  env.geminiApiKey = '';
  env.openaiApiKey = '';
  env.lineChannelSecret = 'line-secret-for-tests';
  env.lineChannelAccessToken = '';
}

describe('health routes', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(() => {
    resetRuntimeEnv();
  });

  it('returns runtime snapshots for QA and LINE observability', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/health');

    assert.equal(result.status, 200);
    assert.equal(result.body.data.service, 'focusflow-backend');
    assert.ok(result.body.data.timestamp);
    assert.equal(result.body.data.runtime.qa.queryEmbeddingProvider, 'mock');
    assert.equal(result.body.data.runtime.qa.vectorSearchMode, 'memory');
    assert.equal(result.body.data.runtime.qa.readiness, 'ready');
    assert.equal(result.body.data.runtime.qa.readyForAsk, true);
    assert.equal(result.body.data.runtime.qa.warnings.some((item) => item.code === 'PHASE1_MEMORY_SEARCH'), true);
    assert.equal(result.body.data.runtime.line.signatureValidationConfigured, true);
    assert.equal(result.body.data.runtime.line.liveReplyConfigured, false);
    assert.equal(result.body.data.runtime.line.readiness, 'degraded');
    assert.equal(result.body.data.runtime.line.deliveryMode, 'backend_only');
    assert.equal(result.body.data.runtime.line.degradedReasons.some((item) => item.code === 'LINE_CHANNEL_ACCESS_TOKEN_MISSING'), true);
  });

  it('marks qa runtime as hard-fail when the configured answer provider is missing required keys', async () => {
    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = '';

    const result = await jsonRequest(serverContext.baseUrl, '/health');

    assert.equal(result.status, 200);
    assert.equal(result.body.data.runtime.qa.readiness, 'hard_fail');
    assert.equal(result.body.data.runtime.qa.readyForAsk, false);
    assert.equal(result.body.data.runtime.qa.hardFailures.some((item) => item.code === 'GEMINI_API_KEY_MISSING'), true);
  });
});
