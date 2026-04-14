const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  env,
  ids,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
  postLineWebhook,
  createLineSignature,
  store,
} = require('./helpers/backendTestHarness');

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

describe('phase-1 mvp acceptance smoke', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(() => {
    resetStore();
    resetRuntimeEnv();
  });

  it('locks the backend-only demo mainline from health to line question flow', async () => {
    const healthResult = await jsonRequest(serverContext.baseUrl, '/health');

    assert.equal(healthResult.status, 200);
    assert.equal(healthResult.body.data.runtime.qa.readiness, 'ready');
    assert.equal(healthResult.body.data.runtime.qa.readyForAsk, true);
    assert.equal(healthResult.body.data.runtime.line.readiness, 'degraded');
    assert.equal(healthResult.body.data.runtime.line.deliveryMode, 'backend_only');

    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const meResult = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me', {
      token: studentToken,
    });
    const coursesResult = await jsonRequest(serverContext.baseUrl, '/api/v1/courses', {
      token: studentToken,
    });
    const qaResult = await jsonRequest(serverContext.baseUrl, '/api/v1/qa/ask', {
      method: 'POST',
      token: studentToken,
      body: {
        courseId: ids.publishedCourse,
        question: 'What does the course say about JWT authentication?',
      },
    });

    assert.equal(meResult.status, 200);
    assert.equal(meResult.body.data.user.email, 'student@focusflow.local');
    assert.equal(coursesResult.status, 200);
    assert.equal(coursesResult.body.data.courses.some((course) => course._id === ids.publishedCourse), true);
    assert.equal(qaResult.status, 200);
    assert.equal(qaResult.body.data.runtime.status, 'degraded');
    assert.equal(qaResult.body.data.runtime.degraded, true);
    assert.equal(qaResult.body.data.runtime.matchStatus, 'matched');
    assert.equal(qaResult.body.data.runtime.fallbacks.some((item) => item.code === 'SEGMENT_EMBEDDING_MISSING'), true);

    const bindTokenResult = await jsonRequest(serverContext.baseUrl, '/api/v1/line/bind-token', {
      method: 'POST',
      token: studentToken,
    });

    assert.equal(bindTokenResult.status, 201);
    assert.equal(bindTokenResult.body.meta.lineRuntime.readiness, 'degraded');

    const bindPayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-acceptance-bind',
          source: { userId: 'line-student-acceptance' },
          message: { type: 'text', text: bindTokenResult.body.data.token },
        },
      ],
    });
    const bindResult = await postLineWebhook(serverContext.baseUrl, bindPayload, {
      'x-line-signature': createLineSignature(bindPayload),
    });

    assert.equal(bindResult.status, 200);
    assert.equal(bindResult.body.data.results[0].handled, true);
    assert.equal(bindResult.body.data.results[0].replySkipped, true);
    assert.equal(store.users.find((user) => user._id === ids.student).lineUserId, 'line-student-acceptance');

    const switchPayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-acceptance-switch',
          source: { userId: 'line-student-acceptance' },
          message: { type: 'text', text: '切換課程' },
        },
      ],
    });
    const switchResult = await postLineWebhook(serverContext.baseUrl, switchPayload, {
      'x-line-signature': createLineSignature(switchPayload),
    });

    assert.equal(switchResult.status, 200);
    assert.equal(switchResult.body.data.results[0].handled, true);

    const selectPayload = JSON.stringify({
      events: [
        {
          type: 'postback',
          replyToken: 'reply-acceptance-select',
          source: { userId: 'line-student-acceptance' },
          postback: { data: `action=select_course&courseId=${ids.publishedCourse}` },
        },
      ],
    });
    const selectResult = await postLineWebhook(serverContext.baseUrl, selectPayload, {
      'x-line-signature': createLineSignature(selectPayload),
    });

    assert.equal(selectResult.status, 200);
    assert.equal(selectResult.body.data.results[0].handled, true);

    const askPayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-acceptance-ask',
          source: { userId: 'line-student-acceptance' },
          message: { type: 'text', text: 'What does the course say about JWT authentication?' },
        },
      ],
    });
    const askResult = await postLineWebhook(serverContext.baseUrl, askPayload, {
      'x-line-signature': createLineSignature(askPayload),
    });

    assert.equal(askResult.status, 200);
    assert.equal(askResult.body.data.results[0].handled, true);
    assert.equal(askResult.body.data.results[0].replySkipped, true);
    assert.equal(askResult.body.data.results[0].qaRuntime.status, 'degraded');
    assert.equal(askResult.body.data.results[0].qaRuntime.degraded, true);
    assert.equal(
      askResult.body.data.results[0].qaRuntime.fallbackCodes.includes('SEGMENT_EMBEDDING_MISSING'),
      true,
    );
  });
});
