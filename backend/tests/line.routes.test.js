const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  env,
  ids,
  resetStore,
  startServer,
  stopServer,
  createLineSignature,
  postLineWebhook,
  store,
  jsonRequest,
  loginAs,
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

describe('line webhook routes', () => {
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

  it('rejects missing and invalid signatures', async () => {
    const payload = {
      events: [
        {
          type: 'message',
          replyToken: 'reply-1',
          source: { userId: 'unknown-line-user' },
          message: { type: 'text', text: 'What is JWT?' },
        },
      ],
    };

    const missingResult = await postLineWebhook(serverContext.baseUrl, payload);
    const rawBody = JSON.stringify(payload);
    const invalidResult = await postLineWebhook(serverContext.baseUrl, rawBody, {
      'x-line-signature': 'invalid-signature',
    });

    assert.equal(missingResult.status, 401);
    assert.equal(missingResult.body.error.code, 'LINE_SIGNATURE_MISSING');
    assert.equal(invalidResult.status, 401);
    assert.equal(invalidResult.body.error.code, 'LINE_SIGNATURE_INVALID');
  });

  it('handles empty event payloads and reports non-live line runtime', async () => {
    const payload = JSON.stringify({ events: [] });
    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.received, 0);
    assert.equal(result.body.data.processed, 0);
    assert.deepEqual(result.body.data.results, []);
    assert.equal(result.body.data.lineRuntime.liveFlowReady, false);
    assert.equal(result.body.data.lineRuntime.missingConfig.includes('LINE_CHANNEL_ACCESS_TOKEN'), true);
  });

  it('covers bind token not found and expired branches with explicit reply-skip reasons', async () => {
    store.lineBindTokens.push({
      _id: 'line-token-expired',
      token: ids.expiredLineBindTokenText,
      userId: ids.student,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const unknownPayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-bind-missing',
          source: { userId: 'line-student-001' },
          message: { type: 'text', text: ids.lineBindTokenText },
        },
      ],
    });
    const unknownResult = await postLineWebhook(serverContext.baseUrl, unknownPayload, {
      'x-line-signature': createLineSignature(unknownPayload),
    });

    const expiredPayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-bind-expired',
          source: { userId: 'line-student-001' },
          message: { type: 'text', text: ids.expiredLineBindTokenText },
        },
      ],
    });
    const expiredResult = await postLineWebhook(serverContext.baseUrl, expiredPayload, {
      'x-line-signature': createLineSignature(expiredPayload),
    });

    assert.equal(unknownResult.status, 200);
    assert.equal(unknownResult.body.data.results[0].reason, 'token_not_found');
    assert.equal(unknownResult.body.data.results[0].replySkipped, true);
    assert.equal(unknownResult.body.data.results[0].replyReason, 'line_channel_access_token_missing');
    assert.equal(expiredResult.status, 200);
    assert.equal(expiredResult.body.data.results[0].reason, 'token_expired');
    assert.equal(expiredResult.body.data.results[0].replySkipped, true);
    assert.equal(store.lineBindTokens.some((token) => token.token === ids.expiredLineBindTokenText), false);
  });

  it('binds a user and resets the conversation state to idle', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.lineUserId = null;
    student.lineConversationState = 'awaiting_course_selection';

    store.lineBindTokens.push({
      _id: 'line-token-valid',
      token: ids.lineBindTokenText,
      userId: ids.student,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const payload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-bind-success',
          source: { userId: 'line-student-001' },
          message: { type: 'text', text: ids.lineBindTokenText },
        },
      ],
    });
    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.results[0].handled, true);
    assert.equal(result.body.data.results[0].replySkipped, true);
    assert.equal(result.body.data.results[0].replyReason, 'line_channel_access_token_missing');
    assert.equal(student.lineUserId, 'line-student-001');
    assert.equal(student.lineConversationState, 'idle');
    assert.equal(student.lineBindAt instanceof Date, true);
  });

  it('accepts legacy text= prefixed bind messages from older QR links', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.lineUserId = null;

    store.lineBindTokens.push({
      _id: 'line-token-text-param',
      token: ids.lineBindTokenText,
      userId: ids.student,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const payload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-bind-text-param',
          source: { userId: 'line-student-text-param' },
          message: { type: 'text', text: `text=${ids.lineBindTokenText}` },
        },
      ],
    });
    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.results[0].handled, true);
    assert.equal(student.lineUserId, 'line-student-text-param');
  });

  it('issues a bind token and completes bind -> switch course -> ask flow with backend-only observability', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.lineUserId = null;
    student.activeCourseId = null;
    student.lineConversationState = 'idle';

    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const bindTokenResult = await jsonRequest(serverContext.baseUrl, '/api/v1/line/bind-token', {
      method: 'POST',
      token: studentToken,
    });

    assert.equal(bindTokenResult.status, 201);
    assert.match(bindTokenResult.body.data.token, /^[a-f0-9]{64}$/);
    assert.ok(bindTokenResult.body.data.expiresAt);
    assert.equal(bindTokenResult.body.meta.lineRuntime.readiness, 'degraded');
    assert.equal(bindTokenResult.body.meta.lineRuntime.deliveryMode, 'backend_only');
    assert.equal(bindTokenResult.body.meta.lineRuntime.liveFlowReady, false);
    assert.equal(
      store.lineBindTokens.some((token) => token.token === bindTokenResult.body.data.token),
      true,
    );

    const bindPayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-bind-issued-token',
          source: { userId: 'line-student-issued-token' },
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
    assert.equal(student.lineUserId, 'line-student-issued-token');
    assert.equal(
      store.lineBindTokens.some((token) => token.token === bindTokenResult.body.data.token),
      false,
    );

    const switchPayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-switch-issued-token',
          source: { userId: 'line-student-issued-token' },
          message: { type: 'text', text: '切換課程' },
        },
      ],
    });
    const switchResult = await postLineWebhook(serverContext.baseUrl, switchPayload, {
      'x-line-signature': createLineSignature(switchPayload),
    });

    assert.equal(switchResult.status, 200);
    assert.equal(switchResult.body.data.results[0].handled, true);
    assert.equal(switchResult.body.data.results[0].replySkipped, true);
    assert.equal(student.lineConversationState, 'awaiting_course_selection');

    const selectPayload = JSON.stringify({
      events: [
        {
          type: 'postback',
          replyToken: 'reply-select-issued-token',
          source: { userId: 'line-student-issued-token' },
          postback: { data: `action=select_course&courseId=${ids.publishedCourse}` },
        },
      ],
    });
    const selectResult = await postLineWebhook(serverContext.baseUrl, selectPayload, {
      'x-line-signature': createLineSignature(selectPayload),
    });

    assert.equal(selectResult.status, 200);
    assert.equal(selectResult.body.data.results[0].handled, true);
    assert.equal(selectResult.body.data.results[0].replySkipped, true);
    assert.equal(String(student.activeCourseId), ids.publishedCourse);

    const askPayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-ask-issued-token',
          source: { userId: 'line-student-issued-token' },
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
    assert.equal(askResult.body.data.results[0].qaRuntime.matchStatus, 'matched');
    assert.equal(
      askResult.body.data.results[0].qaRuntime.fallbackCodes.includes('SEGMENT_EMBEDDING_MISSING'),
      true,
    );
    const lineAskLog = store.usageLogs.find((entry) => entry.event === 'ask' && entry.metadata?.source === 'line');
    const lineQuestion = store.questions.find((entry) => (
      entry.source === 'line'
      && entry.question === 'What does the course say about JWT authentication?'
    ));

    assert.ok(lineAskLog);
    assert.ok(lineQuestion);
    assert.equal(String(lineQuestion.userId), ids.student);
    assert.equal(lineQuestion.studentId, undefined);
    assert.equal(String(lineQuestion.sourceUsageLogId), String(lineAskLog._id));
  });

  it('binds a LINE user and selects a course from a single QR message', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    const admin = store.users.find((user) => user._id === ids.admin);
    student.lineUserId = null;
    student.activeCourseId = null;
    admin.lineUserId = 'line-current-phone';

    store.lineBindTokens.push({
      _id: 'line-token-bind-course',
      token: ids.lineBindTokenText,
      userId: ids.student,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const payload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-bind-course',
          source: { userId: 'line-current-phone' },
          message: { type: 'text', text: `BIND:${ids.lineBindTokenText}:COURSE:${ids.publishedCourse}` },
        },
      ],
    });
    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.results[0].type, 'bind_course');
    assert.equal(result.body.data.results[0].handled, true);
    assert.equal(student.lineUserId, 'line-current-phone');
    assert.equal(admin.lineUserId, undefined);
    assert.equal(String(student.activeCourseId), ids.publishedCourse);
    assert.equal(
      store.lineBindTokens.some((token) => token.token === ids.lineBindTokenText),
      false,
    );
  });

  it('surfaces qa hard-fail details explicitly instead of collapsing question events into generic internal errors', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.activeCourseId = ids.publishedCourse;
    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = '';

    const payload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-qa-hard-fail',
          source: { userId: 'line-student-001' },
          message: { type: 'text', text: 'What does the course say about JWT authentication?' },
        },
      ],
    });
    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.results[0].handled, false);
    assert.equal(result.body.data.results[0].reason, 'qa_runtime_misconfigured');
    assert.equal(result.body.data.results[0].errorCode, 'QA_RUNTIME_MISCONFIGURED');
    assert.equal(result.body.data.results[0].qaRuntime.readiness, 'hard_fail');
    assert.equal(result.body.data.results[0].qaRuntime.readyForAsk, false);
    assert.equal(
      result.body.data.results[0].qaRuntime.hardFailureCodes.includes('GEMINI_API_KEY_MISSING'),
      true,
    );
    assert.equal(result.body.data.results[0].replySkipped, true);
    assert.equal(result.body.data.results[0].replyReason, 'line_channel_access_token_missing');
    const failedAskLog = store.usageLogs.find((entry) => entry.event === 'ask' && entry.metadata?.source === 'line');
    const failedQuestion = store.questions.find((entry) => (
      entry.source === 'line'
      && entry.status === 'failed'
      && entry.question === 'What does the course say about JWT authentication?'
    ));

    assert.ok(failedAskLog);
    assert.ok(failedQuestion);
    assert.equal(String(failedQuestion.userId), ids.student);
    assert.equal(failedQuestion.studentId, undefined);
    assert.equal(String(failedQuestion.sourceUsageLogId), String(failedAskLog._id));
  });

  it('handles unbound users and missing active courses for question events', async () => {
    const unboundPayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-unbound',
          source: { userId: 'unknown-line-user' },
          message: { type: 'text', text: 'What is JWT?' },
        },
      ],
    });
    const unboundResult = await postLineWebhook(serverContext.baseUrl, unboundPayload, {
      'x-line-signature': createLineSignature(unboundPayload),
    });

    const noCoursePayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-no-course',
          source: { userId: 'line-student-001' },
          message: { type: 'text', text: 'What is JWT?' },
        },
      ],
    });
    const noCourseResult = await postLineWebhook(serverContext.baseUrl, noCoursePayload, {
      'x-line-signature': createLineSignature(noCoursePayload),
    });

    assert.equal(unboundResult.status, 200);
    assert.equal(unboundResult.body.data.results[0].reason, 'user_not_bound');
    assert.equal(unboundResult.body.data.results[0].replySkipped, true);
    assert.equal(noCourseResult.status, 200);
    assert.equal(noCourseResult.body.data.results[0].reason, 'active_course_missing');
    assert.equal(noCourseResult.body.data.results[0].replySkipped, true);
  });

  it('switches courses and handles select_course postbacks', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    const switchPayload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-switch',
          source: { userId: 'line-student-001' },
          message: { type: 'text', text: '切換課程' },
        },
      ],
    });
    const switchResult = await postLineWebhook(serverContext.baseUrl, switchPayload, {
      'x-line-signature': createLineSignature(switchPayload),
    });

    assert.equal(switchResult.status, 200);
    assert.equal(switchResult.body.data.results[0].handled, true);
    assert.equal(student.lineConversationState, 'awaiting_course_selection');

    const selectPayload = JSON.stringify({
      events: [
        {
          type: 'postback',
          replyToken: 'reply-select',
          source: { userId: 'line-student-001' },
          postback: { data: `action=select_course&courseId=${ids.publishedCourse}` },
        },
      ],
    });
    const selectResult = await postLineWebhook(serverContext.baseUrl, selectPayload, {
      'x-line-signature': createLineSignature(selectPayload),
    });

    assert.equal(selectResult.status, 200);
    assert.equal(selectResult.body.data.results[0].handled, true);
    assert.equal(String(student.activeCourseId), ids.publishedCourse);
    assert.equal(student.lineConversationState, 'idle');
  });

  it('rejects select_course postbacks when course switching was not started', async () => {
    const payload = JSON.stringify({
      events: [
        {
          type: 'postback',
          replyToken: 'reply-select-without-switch',
          source: { userId: 'line-student-001' },
          postback: { data: `action=select_course&courseId=${ids.publishedCourse}` },
        },
      ],
    });
    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.results[0].handled, false);
    assert.equal(result.body.data.results[0].reason, 'conversation_state_invalid');
  });

  it('blocks questions while course selection is pending', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.lineConversationState = 'awaiting_course_selection';
    student.activeCourseId = ids.publishedCourse;

    const payload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-pending-selection',
          source: { userId: 'line-student-001' },
          message: { type: 'text', text: 'What is JWT?' },
        },
      ],
    });
    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.results[0].handled, false);
    assert.equal(result.body.data.results[0].reason, 'course_selection_pending');
  });

  it('handles successful question events and unsupported events in the same batch', async () => {
    store.users.find((user) => user._id === ids.student).activeCourseId = ids.publishedCourse;

    const payload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-question',
          source: { userId: 'line-student-001' },
          message: { type: 'text', text: 'What does the course say about JWT authentication?' },
        },
        {
          type: 'beacon',
          replyToken: 'reply-beacon',
          source: { userId: 'line-student-001' },
        },
      ],
    });
    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.processed, 1);
    assert.equal(result.body.data.results[0].handled, true);
    assert.equal(result.body.data.results[0].matchCount > 0, true);
    assert.equal(result.body.data.results[0].replySkipped, true);
    assert.equal(result.body.data.results[0].qaRuntime.status, 'degraded');
    assert.equal(result.body.data.results[1].reason, 'unsupported_event');
  });

  it('clears an invalid active course without failing the batch', async () => {
    store.users.find((user) => user._id === ids.student).activeCourseId = 'not-an-object-id';

    const payload = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-broken',
          source: { userId: 'line-student-001' },
          message: { type: 'text', text: 'What is JWT?' },
        },
        {
          type: 'beacon',
          replyToken: 'reply-still-ok',
          source: { userId: 'line-student-001' },
        },
      ],
    });
    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.results[0].reason, 'course_access_denied');
    assert.equal(result.body.data.results[0].replySkipped, true);
    assert.equal(result.body.data.results[1].reason, 'unsupported_event');
  });
});

describe('line question summary lines', () => {
  const { buildQuestionSummaryLines } = require('../src/services/line.service');

  it('命中片段有 jumpUrl 時回覆包含跳轉連結', () => {
    const lines = buildQuestionSummaryLines({
      answer: 'JWT 用於身分驗證。',
      matches: [],
      citations: [{
        videoTitle: 'JWT 課程影片',
        timestamp: {
          startSec: 12,
          endSec: 32,
          jumpUrl: 'https://youtu.be/abc123def45?t=12',
        },
      }],
      clip: null,
      runtime: {},
    });

    assert.equal(lines.includes('跳轉：https://youtu.be/abc123def45?t=12'), true);
    assert.equal(lines.includes('片段：12s - 32s'), true);
  });

  it('命中片段沒有 jumpUrl 時回覆包含改用網站觀看的提示，而非整行消失', () => {
    const lines = buildQuestionSummaryLines({
      answer: 'JWT 用於身分驗證。',
      matches: [],
      citations: [{
        videoTitle: '本地上傳影片',
        timestamp: { startSec: 12, endSec: 32, jumpUrl: null },
      }],
      clip: null,
      runtime: {},
    });

    assert.equal(lines.some((line) => line.startsWith('跳轉：')), false);
    assert.equal(
      lines.includes('此片段「本地上傳影片」尚未提供跳轉連結，請到 FocusFlow 網站的課程頁播放對應時間點。'),
      true,
    );
  });

  it('快取 clip 的 jumpUrl 優先於 match 的 jumpUrl', () => {
    const lines = buildQuestionSummaryLines({
      answer: 'JWT 用於身分驗證。',
      matches: [],
      citations: [{ timestamp: { startSec: 12, endSec: 32, jumpUrl: 'https://youtu.be/matchurl0001?t=12' } }],
      clip: { jumpUrl: 'https://videos.local/watch?v=cached&t=12' },
      runtime: {},
    });

    assert.equal(lines.includes('跳轉：https://videos.local/watch?v=cached&t=12'), true);
  });

  it('拒答時不會用 raw retrieval match 補回使用者可見來源', () => {
    const lines = buildQuestionSummaryLines({
      answer: '目前資料庫片段不足以回答這個問題。',
      matches: [{
        segmentId: 'raw-match', startSec: 12, endSec: 32,
        jumpUrl: 'https://youtu.be/rawmatch001?t=12',
      }],
      citations: [],
      clip: { jumpUrl: 'https://youtu.be/rawmatch001?t=12' },
      runtime: { matchStatus: 'matched' },
    });

    assert.deepEqual(lines, ['目前資料庫片段不足以回答這個問題。']);
  });
});
