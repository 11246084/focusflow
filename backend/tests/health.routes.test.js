const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const { env, startServer, stopServer, jsonRequest } = require('./helpers/backendTestHarness');

function resetRuntimeEnv() {
  env.qaQueryEmbeddingProvider = 'mock';
  env.qaVectorSearchMode = 'memory';
  env.qaAnswerProvider = 'template';
  env.qaAtlasVectorIndexName = '';
  env.qaAtlasFilterMode = 'bridge_course_or_video';
  env.hierarchicalRetrievalEnabled = false;
  env.hierarchicalRetrievalFallbackToLeaf = true;
  env.qaMockEmbeddingDimensions = 32;
  env.openaiEmbeddingModel = 'text-embedding-3-small';
  env.qaEstimatedTokensPerAsk = 1000;
  env.qaMonthlyTokenBudget = 0;
  env.qaUserMonthlyTokenQuota = 0;
  env.videoSegmentVideoCollection = 'video_segments_video';
  env.videoSegmentVideoVectorIndexName = '';
  env.geminiApiKey = '';
  env.openaiApiKey = '';
  env.lineChannelSecret = 'line-secret-for-tests';
  env.lineChannelAccessToken = '';
  env.shortsSyncIntervalMs = 600000;
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
    assert.equal(result.body.data.runtime.qa.costControl.enabled, false);
    assert.equal(result.body.data.runtime.qa.costControl.resetCadence, 'calendar_month_utc');
    assert.equal(result.body.data.runtime.qa.warnings.some((item) => item.code === 'PHASE1_MEMORY_SEARCH'), true);
    assert.equal(result.body.data.runtime.line.signatureValidationConfigured, true);
    assert.equal(result.body.data.runtime.line.liveReplyConfigured, false);
    assert.equal(result.body.data.runtime.line.readiness, 'degraded');
    assert.equal(result.body.data.runtime.line.deliveryMode, 'backend_only');
    assert.equal(result.body.data.runtime.line.degradedReasons.some((item) => item.code === 'LINE_CHANNEL_ACCESS_TOKEN_MISSING'), true);
    assert.equal(result.body.data.runtime.multimodal.segmentCollection, 'video_segments_video');
    assert.equal(result.body.data.runtime.multimodal.expectedVectorIndexName, 'video_embedding_index');
    assert.equal(result.body.data.runtime.multimodal.setupCommand, 'npm run db:ensure-video-vector-index');
    assert.equal(result.body.data.runtime.multimodal.readyForQa, false);
    assert.equal(
      result.body.data.runtime.multimodal.hardFailures.some((item) => item.code === 'VIDEO_SEGMENTS_VIDEO_VECTOR_INDEX_MISSING'),
      true,
    );
    assert.equal(result.body.data.runtime.shortsSync.enabled, true);
    assert.equal('lastAttemptAt' in result.body.data.runtime.shortsSync, true);
    assert.equal('lastSuccessAt' in result.body.data.runtime.shortsSync, true);
    assert.equal('lastError' in result.body.data.runtime.shortsSync, true);
    assert.equal('degraded' in result.body.data.runtime.shortsSync, true);
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

  it('reports configured QA cost guardrails in the health snapshot', async () => {
    env.qaMonthlyTokenBudget = 5000;
    env.qaUserMonthlyTokenQuota = 2000;

    const result = await jsonRequest(serverContext.baseUrl, '/health');

    assert.equal(result.status, 200);
    assert.equal(result.body.data.runtime.qa.costControl.enabled, true);
    assert.equal(result.body.data.runtime.qa.costControl.monthlyTokenBudget, 5000);
    assert.equal(result.body.data.runtime.qa.costControl.userMonthlyTokenQuota, 2000);
  });

  it('marks incompatible Parent query embeddings as degraded when Leaf fallback is available', async () => {
    env.hierarchicalRetrievalEnabled = true;
    env.hierarchicalRetrievalFallbackToLeaf = true;
    env.qaQueryEmbeddingProvider = 'openai';
    env.openaiApiKey = 'test-openai-key';

    const result = await jsonRequest(serverContext.baseUrl, '/health');

    assert.equal(result.body.data.runtime.qa.readiness, 'degraded');
    assert.equal(result.body.data.runtime.qa.readyForAsk, true);
    assert.equal(result.body.data.runtime.qa.warnings.some(
      (item) => item.code === 'HIERARCHICAL_QUERY_EMBEDDING_INCOMPATIBLE',
    ), true);
  });

  it('hard-fails incompatible Parent query embeddings when Leaf fallback is disabled', async () => {
    env.hierarchicalRetrievalEnabled = true;
    env.hierarchicalRetrievalFallbackToLeaf = false;
    env.qaQueryEmbeddingProvider = 'openai';
    env.openaiApiKey = 'test-openai-key';

    const result = await jsonRequest(serverContext.baseUrl, '/health');

    assert.equal(result.body.data.runtime.qa.readiness, 'hard_fail');
    assert.equal(result.body.data.runtime.qa.readyForAsk, false);
    assert.equal(result.body.data.runtime.qa.hardFailures.some(
      (item) => item.code === 'HIERARCHICAL_QUERY_EMBEDDING_INCOMPATIBLE',
    ), true);
  });

  it('SHORTS_SYNC_INTERVAL_MS=0 時回報 shorts sync disabled', async () => {
    env.shortsSyncIntervalMs = 0;
    const result = await jsonRequest(serverContext.baseUrl, '/health');

    assert.equal(result.status, 200);
    assert.equal(result.body.data.runtime.shortsSync.enabled, false);
  });
});
