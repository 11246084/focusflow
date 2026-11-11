const assert = require('node:assert/strict');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
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
const { mapLineHistoryForContextualizer } = require('../src/services/line.service');

const PHASE35_IDS = {
  courseB: '507f191e810c19729de860f2',
  videoB: '507f191e810c19729de860f3',
  enrollmentB: '507f191e810c19729de860f4',
  segmentB: 'phase35-course-b-segment',
  rewriteSegment: 'phase35-rewrite-segment',
};

let lineEventSequence = 0;

async function postLineText(baseUrl, text, lineUserId = 'line-student-001') {
  lineEventSequence += 1;
  const payload = JSON.stringify({
    events: [{
      type: 'message',
      replyToken: `reply-phase35-${lineEventSequence}`,
      source: { userId: lineUserId },
      message: { type: 'text', text },
    }],
  });

  return postLineWebhook(baseUrl, payload, {
    'x-line-signature': createLineSignature(payload),
  });
}

async function postCourseMenuSelection(baseUrl, courseId, lineUserId = 'line-student-001') {
  const switchResult = await postLineText(baseUrl, '切換課程', lineUserId);
  assert.equal(switchResult.body.data.results[0].handled, true);

  lineEventSequence += 1;
  const payload = JSON.stringify({
    events: [{
      type: 'postback',
      replyToken: `reply-phase35-${lineEventSequence}`,
      source: { userId: lineUserId },
      postback: { data: `action=select_course&courseId=${courseId}` },
    }],
  });

  return postLineWebhook(baseUrl, payload, {
    'x-line-signature': createLineSignature(payload),
  });
}

function addCourseBFixture({ enrolled = true, segmentText = 'Course B explains BETAORBIT scheduling.' } = {}) {
  const baselineVideo = store.videos.find((video) => video._id === ids.publishedVideo);

  store.courses.push({
    _id: PHASE35_IDS.courseB,
    title: 'Published Course B',
    description: 'Phase 3.5 isolation fixture',
    teacherId: ids.otherTeacher,
    videoIds: [PHASE35_IDS.videoB],
    status: 'published',
    createdAt: '2026-09-07T00:00:00.000Z',
  });
  store.videos.push({
    ...baselineVideo,
    _id: PHASE35_IDS.videoB,
    courseId: PHASE35_IDS.courseB,
    title: 'Published Course B Video',
    video_id: 'video-phase35-course-b',
    sourceUrl: '/uploads/phase35-course-b.mp4',
    video_url: '/uploads/phase35-course-b.mp4',
  });
  store.videoSegments.push({
    _id: '507f191e810c19729de860f5',
    segmentId: PHASE35_IDS.segmentB,
    chunkId: PHASE35_IDS.segmentB,
    courseId: PHASE35_IDS.courseB,
    videoId: PHASE35_IDS.videoB,
    startSec: 5,
    endSec: 20,
    text: segmentText,
    embedding: [],
  });

  if (enrolled) {
    store.enrollments.push({
      _id: PHASE35_IDS.enrollmentB,
      studentId: ids.student,
      courseId: PHASE35_IDS.courseB,
      status: 'active',
      progress: 0,
      lineNotify: false,
    });
  }
}

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
  env.lineLoginCallbackUrl = '';
  env.maxConversationTurns = 4;
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

  it('已綁定的使用者重新加好友時不會再被要求綁定', async () => {
    const postFollow = async (lineUserId) => {
      const payload = JSON.stringify({
        events: [{ type: 'follow', replyToken: `reply-follow-${lineUserId}`, source: { type: 'user', userId: lineUserId } }],
      });
      return postLineWebhook(serverContext.baseUrl, payload, {
        'x-line-signature': createLineSignature(payload),
      });
    };

    const boundResult = await postFollow('line-student-001');
    const unboundResult = await postFollow('never-bound-line-user');

    assert.equal(boundResult.status, 200);
    assert.equal(boundResult.body.data.results[0].alreadyBound, true);
    assert.equal(unboundResult.body.data.results[0].alreadyBound, false);
  });

  it('封鎖與解除封鎖只更新好友狀態，不解除綁定', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.lineFriendStatus = 'friend';
    const send = (type) => {
      const payload = JSON.stringify({ events: [{ type, source: { userId: 'line-student-001' } }] });
      return postLineWebhook(serverContext.baseUrl, payload, {
        'x-line-signature': createLineSignature(payload),
      });
    };

    const unfollow = await send('unfollow');
    assert.equal(unfollow.body.data.results[0].handled, true);
    assert.equal(student.lineFriendStatus, 'not_friend');
    assert.equal(student.lineUserId, 'line-student-001');

    await send('follow');
    assert.equal(student.lineFriendStatus, 'friend');
  });

  it('解除綁定時一併清掉好友狀態，未綁定的 LINE 封鎖時不影響任何帳號', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.lineFriendStatus = 'friend';
    const payload = JSON.stringify({ events: [{ type: 'unfollow', source: { userId: 'line-unbound' } }] });
    await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });
    assert.equal(student.lineFriendStatus, 'friend');

    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    await jsonRequest(serverContext.baseUrl, '/api/v1/line/binding', { method: 'DELETE', token });

    assert.equal(student.lineFriendStatus, undefined);
  });

  it('回答用卡片送出；卡片被 LINE 拒收時改送純文字，學生仍收到答案', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.activeCourseId = ids.publishedCourse;
    env.lineChannelAccessToken = 'flex-test-access-token';
    const originalFetch = global.fetch;
    const sent = [];
    let rejectFlex = false;
    global.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.line.me/')) return originalFetch(url, options);
      if (String(url).endsWith('/chat/loading/start')) return { ok: true, text: async () => '' };
      const body = JSON.parse(options.body);
      sent.push({ url: String(url), type: body.messages[0].type });
      if (rejectFlex && body.messages[0].type === 'flex') {
        return { ok: false, status: 400, text: async () => '{"message":"A message is invalid"}' };
      }
      return { ok: true, text: async () => '{}' };
    };

    try {
      const accepted = await postLineText(serverContext.baseUrl, 'What does the course say about JWT authentication?');
      assert.equal(accepted.body.data.results[0].replyFormat, 'flex');
      assert.equal(sent.at(-1).type, 'flex');

      rejectFlex = true;
      const rejected = await postLineText(serverContext.baseUrl, 'How is JWT authentication verified?');
      assert.equal(rejected.body.data.results[0].handled, true);
      assert.equal(rejected.body.data.results[0].replyFormat, 'text');
      assert.equal(sent.at(-1).type, 'text');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('切換課程用卡片輪播送出；輪播被 LINE 拒收時改送舊的課程按鈕', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.activeCourseId = ids.publishedCourse;
    env.lineChannelAccessToken = 'carousel-test-access-token';
    const originalFetch = global.fetch;
    const sent = [];
    let rejectFlex = false;
    global.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.line.me/')) return originalFetch(url, options);
      const [message] = JSON.parse(options.body).messages;
      sent.push(message);
      if (rejectFlex && message.type === 'flex') {
        return { ok: false, status: 400, text: async () => '{"message":"A message is invalid"}' };
      }
      return { ok: true, text: async () => '{}' };
    };

    try {
      const accepted = await postLineText(serverContext.baseUrl, '切換課程');
      const carousel = sent.at(-1);
      assert.equal(accepted.body.data.results[0].replyFormat, 'flex');
      assert.equal(carousel.contents.type, 'carousel');
      assert.match(JSON.stringify(carousel), new RegExp(`action=select_course&courseId=${ids.publishedCourse}`));
      assert.match(JSON.stringify(carousel), /目前選擇/);

      rejectFlex = true;
      const rejected = await postLineText(serverContext.baseUrl, '切換課程');
      assert.equal(rejected.body.data.results[0].handled, true);
      assert.equal(rejected.body.data.results[0].replyFormat, 'template');
      assert.equal(sent.at(-1).template.type, 'buttons');
      assert.equal(student.lineConversationState, 'awaiting_course_selection');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('未綁定的學生收到「連結 LINE」按鈕，連到網站的 LINE 提問頁', async () => {
    env.lineChannelAccessToken = 'bind-prompt-access-token';
    env.lineLoginCallbackUrl = 'https://focusflow.example/line/callback';
    const originalFetch = global.fetch;
    const payloads = [];
    global.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.line.me/')) return originalFetch(url, options);
      payloads.push(JSON.parse(options.body));
      return { ok: true, text: async () => '{}' };
    };

    try {
      const result = await postLineText(serverContext.baseUrl, '切換課程', 'line-not-bound-yet');
      const [message] = payloads.at(-1).messages;

      assert.equal(result.body.data.results[0].reason, 'user_not_bound');
      assert.equal(message.type, 'flex');
      assert.match(JSON.stringify(message), /"label":"連結 LINE","uri":"https:\/\/focusflow\.example\/app\/line"/);
    } finally {
      global.fetch = originalFetch;
      env.lineLoginCallbackUrl = '';
    }
  });

  it('沒設定網站網址時，未綁定提示退回純文字', async () => {
    env.lineChannelAccessToken = 'bind-prompt-access-token';
    const originalFetch = global.fetch;
    const payloads = [];
    global.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.line.me/')) return originalFetch(url, options);
      payloads.push(JSON.parse(options.body));
      return { ok: true, text: async () => '{}' };
    };

    try {
      await postLineText(serverContext.baseUrl, '切換課程', 'line-not-bound-yet');
      assert.equal(payloads.at(-1).messages[0].type, 'text');
    } finally {
      global.fetch = originalFetch;
    }
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
    student.lineUserId = null;
    student.activeCourseId = null;

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
    assert.equal(String(student.activeCourseId), ids.publishedCourse);
    assert.equal(
      store.lineBindTokens.some((token) => token.token === ids.lineBindTokenText),
      false,
    );
  });

  it('QR 綁定遇到 LINE 已綁定別的帳號時拒絕，對方的綁定不變也不切換課程', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    const admin = store.users.find((user) => user._id === ids.admin);
    student.lineUserId = null;
    student.activeCourseId = null;
    admin.lineUserId = 'line-current-phone';

    store.lineBindTokens.push({
      _id: 'line-token-bind-course-conflict',
      token: ids.lineBindTokenText,
      userId: ids.student,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await postLineText(
      serverContext.baseUrl,
      `BIND:${ids.lineBindTokenText}:COURSE:${ids.publishedCourse}`,
      'line-current-phone',
    );

    assert.equal(result.body.data.results[0].handled, false);
    assert.equal(result.body.data.results[0].reason, 'line_bound_to_other_account');
    assert.equal(admin.lineUserId, 'line-current-phone');
    assert.equal(student.lineUserId, null);
    assert.equal(student.activeCourseId, null);
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

  it('課程卡片的選課按鈕不必先輸入「切換課程」，較早送出的卡片也能直接選', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.lineConversationState = 'idle';
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
    assert.equal(result.body.data.results[0].handled, true);
    assert.equal(String(student.activeCourseId), ids.publishedCourse);
  });

  it('選課按鈕仍會重新檢查修課權限與課程 ID 格式', async () => {
    const send = async (courseId) => {
      const payload = JSON.stringify({
        events: [{
          type: 'postback',
          replyToken: `reply-select-${courseId}`,
          source: { userId: 'line-student-001' },
          postback: { data: `action=select_course&courseId=${courseId}` },
        }],
      });
      return postLineWebhook(serverContext.baseUrl, payload, { 'x-line-signature': createLineSignature(payload) });
    };

    const invalid = await send('not-an-id');
    assert.equal(invalid.body.data.results[0].reason, 'course_id_invalid');
    const notEnrolled = await send(ids.teacherCourse);
    assert.equal(notEnrolled.body.data.results[0].reason, 'course_access_denied');
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

  it('uses MAX_CONVERSATION_TURNS to change the persisted LINE history limit', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.activeCourseId = ids.publishedCourse;
    env.maxConversationTurns = 2;

    await postLineText(serverContext.baseUrl, 'JWT authentication turn one');
    await postLineText(serverContext.baseUrl, 'JWT authentication turn two');
    await postLineText(serverContext.baseUrl, 'JWT authentication turn three');

    assert.equal(student.lineConversationHistory.length, 4);
    assert.equal(student.lineConversationHistory[0].content, 'JWT authentication turn two');
    assert.deepEqual(student.lineConversationHistory.map((item) => item.role), [
      'user', 'model', 'user', 'model',
    ]);

    env.maxConversationTurns = 1;
    await postLineText(serverContext.baseUrl, 'JWT authentication turn four');

    assert.equal(student.lineConversationHistory.length, 2);
    assert.equal(student.lineConversationHistory[0].content, 'JWT authentication turn four');
    assert.equal(student.lineConversationHistory[1].role, 'model');
  });

  it('maps LINE model history to assistant before contextualization', () => {
    assert.deepEqual(mapLineHistoryForContextualizer([
      { role: 'user', content: '什麼是 JWT？' },
      { role: 'model', content: 'JWT 是權杖。' },
    ]), [
      { role: 'user', content: '什麼是 JWT？' },
      { role: 'assistant', content: 'JWT 是權杖。' },
    ]);
  });

  it('uses the rewritten standalone question for LINE retrieval', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.activeCourseId = ids.publishedCourse;
    student.lineConversationHistory = [
      { role: 'user', content: '什麼是 ALPHAZEBRA？' },
      { role: 'model', content: '這是課程中的追問改寫測試主題。' },
    ];
    store.videoSegments.push({
      _id: '507f191e810c19729de860f6',
      segmentId: PHASE35_IDS.rewriteSegment,
      chunkId: PHASE35_IDS.rewriteSegment,
      courseId: ids.publishedCourse,
      videoId: ids.publishedVideo,
      startSec: 70,
      endSec: 80,
      text: 'ALPHAZEBRA is the only retrieval sentinel in this course segment.',
      embedding: [],
    });

    const result = await postLineText(serverContext.baseUrl, '那它呢？');
    const recordedQuestion = store.questions.at(-1);

    assert.equal(result.status, 200);
    assert.equal(result.body.data.results[0].matchCount > 0, true);
    assert.equal(recordedQuestion.question, '那它呢？');
    assert.equal(recordedQuestion.topSegmentId, PHASE35_IDS.rewriteSegment);
    assert.equal(student.lineConversationHistory.at(-2).content, '那它呢？');
  });

  it('passes P5 after three A-course turns without returning unauthorized B matches or citations', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.activeCourseId = ids.publishedCourse;
    addCourseBFixture({ enrolled: false, segmentText: '紫鯨螺旋術只在 B 課程中教授。' });
    const originalFetch = global.fetch;
    const lineReplyPayloads = [];
    env.lineChannelAccessToken = 'phase35-line-access-token';
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.line.me/')) {
        lineReplyPayloads.push(JSON.parse(options.body));
        return { ok: true };
      }
      return originalFetch(url, options);
    };

    let forbiddenResult;
    try {
      const firstTurn = await postLineText(
        serverContext.baseUrl,
        'What does Course A say about JWT authentication?',
      );
      const secondTurn = await postLineText(
        serverContext.baseUrl,
        '那 JWT authentication 如何運作？',
      );
      const thirdTurn = await postLineText(serverContext.baseUrl, '那它有哪些用途？');

      assert.equal(firstTurn.body.data.results[0].matchCount > 0, true);
      assert.equal(secondTurn.body.data.results[0].matchCount > 0, true);
      assert.equal(thirdTurn.body.data.results[0].matchCount > 0, true);

      forbiddenResult = await postLineText(serverContext.baseUrl, '紫鯨螺旋術');
    } finally {
      global.fetch = originalFetch;
      env.lineChannelAccessToken = '';
    }
    const forbiddenQuestion = store.questions.at(-1);
    const forbiddenReply = JSON.stringify(lineReplyPayloads.at(-1)?.messages || []);

    assert.equal(forbiddenResult.status, 200);
    assert.equal(forbiddenResult.body.data.results[0].handled, true);
    assert.equal(forbiddenResult.body.data.results[0].matchCount, 0);
    assert.equal(forbiddenQuestion.matchCount, 0);
    assert.equal(forbiddenQuestion.matches.some((match) => (
      match.videoId === PHASE35_IDS.videoB || match.segmentId === PHASE35_IDS.segmentB
    )), false);
    assert.doesNotMatch(forbiddenReply, /Published Course B Video|來源：/);
    assert.equal(student.lineConversationHistory.length, 8);

    const historyBeforeDeniedSwitch = structuredClone(student.lineConversationHistory);
    const deniedSwitch = await postLineText(serverContext.baseUrl, `COURSE:${PHASE35_IDS.courseB}`);

    assert.equal(deniedSwitch.body.data.results[0].handled, false);
    assert.equal(deniedSwitch.body.data.results[0].reason, 'course_access_denied');
    assert.equal(String(student.activeCourseId), ids.publishedCourse);
    assert.deepEqual(student.lineConversationHistory, historyBeforeDeniedSwitch);
  });

  it('clears A history on direct A-to-B selection, preserves B history on B-to-B, and isolates the first B question', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.activeCourseId = ids.publishedCourse;
    student.lineConversationHistory = [
      { role: 'user', content: '什麼是 CROSSCOURSELEAKTOKEN？' },
      { role: 'model', content: '這是 A 課內容。' },
    ];
    addCourseBFixture({
      enrolled: true,
      segmentText: 'CROSSCOURSELEAKTOKEN is a sentinel that must not be reached by leaked A history.',
    });

    const switchResult = await postLineText(serverContext.baseUrl, `COURSE:${PHASE35_IDS.courseB}`);

    assert.equal(switchResult.body.data.results[0].handled, true);
    assert.equal(String(student.activeCourseId), PHASE35_IDS.courseB);
    assert.deepEqual(student.lineConversationHistory, []);

    const firstQuestion = await postLineText(serverContext.baseUrl, '那它呢？');
    assert.equal(firstQuestion.body.data.results[0].matchCount, 0);

    const currentCourseHistory = structuredClone(student.lineConversationHistory);
    const sameCourseResult = await postLineText(serverContext.baseUrl, `COURSE:${PHASE35_IDS.courseB}`);
    assert.equal(sameCourseResult.body.data.results[0].handled, true);
    assert.deepEqual(student.lineConversationHistory, currentCourseHistory);
  });

  it('clears A history on bind-and-select A-to-B', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.activeCourseId = ids.publishedCourse;
    student.lineConversationHistory = [
      { role: 'user', content: 'A course history' },
      { role: 'model', content: 'A course answer' },
    ];
    addCourseBFixture();
    store.lineBindTokens.push({
      _id: 'phase35-bind-course-token',
      token: ids.lineBindTokenText,
      userId: ids.student,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await postLineText(
      serverContext.baseUrl,
      `BIND:${ids.lineBindTokenText}:COURSE:${PHASE35_IDS.courseB}`,
    );

    assert.equal(result.body.data.results[0].handled, true);
    assert.equal(String(student.activeCourseId), PHASE35_IDS.courseB);
    assert.deepEqual(student.lineConversationHistory, []);
  });

  it('clears A history on course-switch menu A-to-B', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.activeCourseId = ids.publishedCourse;
    student.lineConversationHistory = [
      { role: 'user', content: 'A course history' },
      { role: 'model', content: 'A course answer' },
    ];
    addCourseBFixture();

    const result = await postCourseMenuSelection(serverContext.baseUrl, PHASE35_IDS.courseB);

    assert.equal(result.body.data.results[0].handled, true);
    assert.equal(String(student.activeCourseId), PHASE35_IDS.courseB);
    assert.equal(student.lineConversationState, 'idle');
    assert.deepEqual(student.lineConversationHistory, []);
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

  it('缺少 userId 或來自群組的訊息不會被當成任何使用者處理', async () => {
    const teacher = store.users.find((user) => user._id === ids.teacher);
    teacher.activeCourseId = ids.publishedCourse;
    const payload = JSON.stringify({
      events: [
        { type: 'message', replyToken: 'r1', source: { type: 'group', groupId: 'Cgroup' }, message: { type: 'text', text: 'What does the course say about JWT authentication?' } },
        { type: 'message', replyToken: 'r2', message: { type: 'text', text: `COURSE:${ids.publishedCourse}` } },
        { type: 'message', replyToken: 'r3', source: { type: 'group', groupId: 'Cgroup', userId: 'line-student-001' }, message: { type: 'text', text: '切換課程' } },
        { type: 'postback', replyToken: 'r4', source: { type: 'room', roomId: 'Rroom' }, postback: { data: `action=select_course&courseId=${ids.publishedCourse}` } },
      ],
    });

    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.data.results.map((item) => item.reason),
      ['line_user_unidentified', 'line_user_unidentified', 'line_user_unidentified', 'line_user_unidentified'],
    );
    assert.equal(store.questions.length, 0);
    assert.equal(String(teacher.activeCourseId), String(ids.publishedCourse));
  });

  it('已綁定學生可從網站解除 LINE 綁定並清除 LINE 對話狀態', async () => {
    const student = store.users.find((user) => user._id === ids.student);
    student.lineUserId = 'line-student-to-unbind';
    student.lineBindAt = new Date();
    student.activeCourseId = ids.course;
    student.lineConversationState = 'awaiting_course_selection';
    student.lineConversationHistory = [{ role: 'user', content: '舊問題' }];

    const studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/line/binding', {
      method: 'DELETE',
      token: studentToken,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.unbound, true);
    assert.equal(student.lineUserId, undefined);
    assert.equal(student.activeCourseId, undefined);
    assert.equal(student.lineBindAt, null);
    assert.equal(student.lineConversationState, 'idle');
    assert.deepEqual(student.lineConversationHistory, []);
  });

  it('未登入時不可解除 LINE 綁定', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/line/binding', {
      method: 'DELETE',
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'UNAUTHORIZED');
  });
});

describe('LINE 回答卡片與時間格式', () => {
  const { buildAnswerFlexMessage, formatClock } = require('../src/services/line.service');
  const citation = (title, startSec, endSec, jumpUrl = null) => ({
    videoTitle: title,
    timestamp: { startSec, endSec, jumpUrl },
  });

  afterEach(() => {
    env.lineLoginCallbackUrl = '';
  });

  it('時間顯示成分:秒，超過一小時加上時，小數秒捨去', () => {
    assert.deepEqual([0, 12.9, 75, 120, 3725].map(formatClock), ['0:00', '0:12', '1:15', '2:00', '1:02:05']);
  });

  it('回答卡上方是課程、中間是回答、最多 3 筆引用，每筆可跳到該秒', () => {
    const message = buildAnswerFlexMessage({
      courseTitle: 'AI入門基礎課',
      qaResult: {
        answer: '老師用廣告說明品牌形象。',
        citations: [
          citation('第 3 支影片', 760, 785, 'https://youtu.be/a?t=760'),
          citation('第 3 支影片', 785, 810, 'https://youtu.be/a?t=785'),
          citation('第 4 支影片', 12, 40, 'https://youtu.be/b?t=12'),
          citation('第 5 支影片', 1, 2, 'https://youtu.be/c?t=1'),
        ],
      },
    });
    const flat = JSON.stringify(message);
    const buttons = flat.match(/▶ 看這段/g) || [];

    assert.equal(message.type, 'flex');
    assert.equal(message.contents.header.contents[0].text, 'AI入門基礎課');
    assert.equal(message.contents.body.contents[0].text, '老師用廣告說明品牌形象。');
    assert.equal(buttons.length, 3);
    assert.match(flat, /第 3 支影片・12:40 - 13:05/);
    assert.match(flat, /https:\/\/youtu\.be\/a\?t=760/);
    assert.doesNotMatch(flat, /第 5 支影片/);
    assert.ok(message.altText.length <= 400);
  });

  it('快取 clip 的連結優先用在第一筆引用', () => {
    const message = buildAnswerFlexMessage({
      courseTitle: '課程',
      qaResult: {
        answer: '回答',
        clip: { jumpUrl: 'https://videos.local/watch?v=cached&t=12' },
        citations: [citation('影片', 12, 32, 'https://youtu.be/match?t=12')],
      },
    });

    assert.match(JSON.stringify(message), /videos\.local\/watch\?v=cached&t=12/);
  });

  it('沒有 YouTube 連結的片段改開網站課程頁；沒設定網站網址時只顯示文字', () => {
    const qaResult = { answer: '回答', citations: [citation('本地上傳影片', 12, 32)] };

    const withoutSite = JSON.stringify(buildAnswerFlexMessage({ courseTitle: '課程', qaResult }));
    env.lineLoginCallbackUrl = 'https://focusflow.example/line/callback';
    const withSite = JSON.stringify(buildAnswerFlexMessage({ courseTitle: '課程', qaResult }));

    assert.doesNotMatch(withoutSite, /▶ 看這段/);
    assert.match(withoutSite, /本地上傳影片・0:12 - 0:32/);
    assert.match(withSite, /https:\/\/focusflow\.example\/app\/courses/);
  });

  it('拒答時沒有引用列', () => {
    const message = buildAnswerFlexMessage({
      courseTitle: '課程',
      qaResult: { answer: '目前資料庫片段不足以回答這個問題。', citations: [] },
    });

    assert.doesNotMatch(JSON.stringify(message), /▶ 看這段|separator/);
  });

  it('降級時卡片保留 [MVP…] 警示，排在回答上方', () => {
    const message = buildAnswerFlexMessage({
      courseTitle: '課程',
      qaResult: {
        answer: '回答',
        citations: [],
        runtime: { fallbacks: [{ stage: 'retrieval' }, { stage: 'answer' }] },
      },
    });
    const texts = message.contents.body.contents.map((item) => item.text);

    assert.deepEqual(texts, [
      '[MVP fallback] 檢索已改走 lexical ranking。',
      '[MVP fallback] Gemini 暫時不可用，已改用 template answer。',
      '回答',
    ]);
  });
});

describe('line question summary lines', () => {
  const { buildQuestionSummaryLines } = require('../src/services/line.service');

  it('純文字備援保留 [MVP…] 降級警示', () => {
    const lines = buildQuestionSummaryLines({
      answer: 'JWT 用於身分驗證。',
      citations: [],
      clip: null,
      runtime: {
        matchStatus: 'no_searchable_segments',
        fallbacks: [{ stage: 'retrieval' }, { stage: 'answer' }],
      },
    });

    assert.deepEqual(lines, [
      '[MVP提示] 這門課目前沒有可搜尋片段。',
      '[MVP fallback] 檢索已改走 lexical ranking。',
      '[MVP fallback] Gemini 暫時不可用，已改用 template answer。',
      'JWT 用於身分驗證。',
    ]);
  });

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
    assert.equal(lines.includes('片段：0:12 - 0:32'), true);
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

describe('LINE 切換課程輪播', () => {
  const { buildCourseCarouselMessage } = require('../src/services/line.service');
  const courses = (count) => Array.from({ length: count }, (_, index) => ({
    _id: `course-${index + 1}`,
    title: `課程 ${index + 1}`,
  }));

  afterEach(() => {
    env.lineLoginCallbackUrl = '';
  });

  it('每門課一張卡，超過 4 門也全部列出，只有目前的課標「目前選擇」', () => {
    const message = buildCourseCarouselMessage(courses(6), 'course-2');
    const bubbles = message.contents.contents;

    assert.equal(bubbles.length, 6);
    assert.equal(bubbles[5].footer.contents[0].action.data, 'action=select_course&courseId=course-6');
    assert.equal(bubbles[1].footer.contents[0].action.displayText, '切換到「課程 2」');
    assert.equal(JSON.stringify(message).match(/目前選擇/g).length, 1);
    assert.match(JSON.stringify(bubbles[1]), /目前選擇/);
  });

  it('超過 12 門課時列前 11 門，最後一張說明還有幾門並連到網站課程頁', () => {
    env.lineLoginCallbackUrl = 'https://focusflow.example/line/callback';
    const bubbles = buildCourseCarouselMessage(courses(15), null).contents.contents;
    const last = JSON.stringify(bubbles.at(-1));

    assert.equal(bubbles.length, 12);
    assert.match(last, /還有 4 門課/);
    assert.match(last, /https:\/\/focusflow\.example\/app\/courses/);
    assert.doesNotMatch(JSON.stringify(bubbles), /course-12/);
  });

  it('剛好 12 門課時全部列出，沒有「還有幾門」卡', () => {
    const bubbles = buildCourseCarouselMessage(courses(12), null).contents.contents;

    assert.equal(bubbles.length, 12);
    assert.doesNotMatch(JSON.stringify(bubbles), /還有/);
  });
});

describe('LINE 審查修正回歸', () => {
  const { buildAnswerFlexMessage, buildQuestionSummaryLines } = require('../src/services/line.service');
  const INACTIVE_TEXT = '這個 FocusFlow 帳號已停用，目前無法使用 LINE 提問，請聯絡老師或管理員。';
  const URL_CLIP = 'https://videos.local/watch?v=clip&t=1';
  const URL_CITATION = 'https://youtu.be/citation?t=2';
  let serverContext;
  let originalFetch;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(() => {
    resetStore();
    resetRuntimeEnv();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    env.lineLoginCallbackUrl = '';
  });

  // 攔截 LINE API：記錄回覆文字，並可在讀取動畫（回答前一刻）時插入 hook。
  function stubLineApi({ onLoading } = {}) {
    env.lineChannelAccessToken = 'review-regression-access-token';
    const calls = { replies: [], loading: 0 };
    global.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.line.me/')) return originalFetch(url, options);
      if (String(url).endsWith('/chat/loading/start')) {
        calls.loading += 1;
        if (onLoading) onLoading();
        return { ok: true, text: async () => '' };
      }
      const body = JSON.parse(options.body);
      if (body.messages) calls.replies.push(...body.messages);
      return { ok: true, text: async () => '{}' };
    };
    return calls;
  }

  async function postPostbackSelect(courseId, lineUserId = 'line-student-001') {
    lineEventSequence += 1;
    const payload = JSON.stringify({
      events: [{
        type: 'postback',
        replyToken: `reply-review-${lineEventSequence}`,
        source: { userId: lineUserId },
        postback: { data: `action=select_course&courseId=${courseId}` },
      }],
    });
    return postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });
  }

  describe('停用帳號', () => {
    function setupInactiveStudent() {
      addCourseBFixture();
      const student = store.users.find((user) => user._id === ids.student);
      student.activeCourseId = ids.publishedCourse;
      student.isActive = false;
      return student;
    }

    function assertNothingRecorded(student, result, calls) {
      assert.equal(result.status, 200);
      assert.equal(result.body.data.results[0].handled, false);
      assert.equal(result.body.data.results[0].reason, 'user_inactive');
      assert.equal(calls.replies.at(-1).text, INACTIVE_TEXT);
      assert.equal(calls.loading, 0);
      assert.equal(store.questions.length, 0);
      assert.equal(store.usageLogs.length, 0);
      assert.equal(String(student.activeCourseId), ids.publishedCourse);
    }

    it('停用的已綁定使用者傳文字提問：回停用提示，不呼叫問答也不留紀錄', async () => {
      const student = setupInactiveStudent();
      const calls = stubLineApi();

      const result = await postLineText(serverContext.baseUrl, 'JWT authentication 是什麼？');

      assertNothingRecorded(student, result, calls);
      assert.equal(student.lineConversationHistory?.length ?? 0, 0);
    });

    it('停用的已綁定使用者傳「切換課程」：回停用提示，不出現課程輪播', async () => {
      const student = setupInactiveStudent();
      const calls = stubLineApi();

      const result = await postLineText(serverContext.baseUrl, '切換課程');

      assertNothingRecorded(student, result, calls);
      assert.equal(calls.replies.some((message) => message.type === 'flex'), false);
    });

    it('停用的已綁定使用者按課程選單 postback：不切換 activeCourseId', async () => {
      const student = setupInactiveStudent();
      const calls = stubLineApi();

      const result = await postPostbackSelect(PHASE35_IDS.courseB);

      assertNothingRecorded(student, result, calls);
    });

    it('isActive 為 true 或欄位不存在的使用者照常提問', async () => {
      const student = store.users.find((user) => user._id === ids.student);
      student.activeCourseId = ids.publishedCourse;
      const calls = stubLineApi();

      student.isActive = true;
      const activeResult = await postLineText(serverContext.baseUrl, 'JWT authentication 是什麼？');
      delete student.isActive;
      const missingResult = await postLineText(serverContext.baseUrl, 'JWT authentication 是什麼？');

      assert.equal(activeResult.body.data.results[0].handled, true);
      assert.equal(missingResult.body.data.results[0].handled, true);
      assert.notEqual(calls.replies.at(-1).text, INACTIVE_TEXT);
      assert.equal(store.questions.length, 2);
    });

    it('停用的已綁定使用者重新加好友：歡迎訊息改為停用提示', async () => {
      const student = setupInactiveStudent();
      const calls = stubLineApi();
      const payload = JSON.stringify({
        events: [{ type: 'follow', replyToken: 'reply-review-follow', source: { type: 'user', userId: student.lineUserId } }],
      });

      const result = await postLineWebhook(serverContext.baseUrl, payload, {
        'x-line-signature': createLineSignature(payload),
      });

      assert.equal(result.status, 200);
      assert.equal(calls.replies.at(-1).text, INACTIVE_TEXT);
    });

    it('綁定碼發出後帳號被停用：傳給 bot 不會綁定，回停用提示', async () => {
      const student = store.users.find((user) => user._id === ids.student);
      student.lineUserId = null;
      store.lineBindTokens.push({
        _id: 'line-token-inactive',
        token: ids.lineBindTokenText,
        userId: ids.student,
        expiresAt: new Date(Date.now() + 60_000),
      });
      student.isActive = false;
      const calls = stubLineApi();

      const result = await postLineText(serverContext.baseUrl, ids.lineBindTokenText, 'line-student-inactive-bind');

      assert.equal(result.body.data.results[0].handled, false);
      assert.equal(result.body.data.results[0].reason, 'user_inactive');
      assert.equal(student.lineUserId == null, true);
      assert.equal(calls.replies.at(-1).text, INACTIVE_TEXT);
    });
  });

  describe('引用跳轉連結防呆', () => {
    const citation = (segmentId, jumpUrl) => ({
      segmentId,
      videoTitle: '影片',
      timestamp: { startSec: 12, endSec: 32, jumpUrl },
    });
    const firstButtonUri = (qaResult) => {
      const message = buildAnswerFlexMessage({ courseTitle: '課程', qaResult });
      return JSON.stringify(message);
    };

    it('clip 與第一筆引用的 segmentId 不同時，卡片按鈕用引用自己的連結', () => {
      const flat = firstButtonUri({
        answer: '回答',
        clip: { segmentId: 'A', jumpUrl: URL_CLIP },
        citations: [citation('B', URL_CITATION)],
      });

      assert.match(flat, /youtu\.be\/citation\?t=2/);
      assert.doesNotMatch(flat, /videos\.local/);
    });

    it('clip 與第一筆引用的 segmentId 不同時，純文字「跳轉：」用引用自己的連結', () => {
      const lines = buildQuestionSummaryLines({
        answer: '回答',
        matches: [],
        clip: { segmentId: 'A', jumpUrl: URL_CLIP },
        citations: [citation('B', URL_CITATION)],
        runtime: {},
      });

      assert.equal(lines.includes(`跳轉：${URL_CITATION}`), true);
      assert.equal(lines.some((line) => line.includes(URL_CLIP)), false);
    });

    it('segmentId 相同時仍用快取 clip 的連結', () => {
      const qaResult = {
        answer: '回答',
        clip: { segmentId: 'A', jumpUrl: URL_CLIP },
        citations: [citation('A', URL_CITATION)],
        matches: [],
        runtime: {},
      };

      assert.match(firstButtonUri(qaResult), /videos\.local\/watch\?v=clip&t=1/);
      assert.equal(buildQuestionSummaryLines(qaResult).includes(`跳轉：${URL_CLIP}`), true);
    });

    it('segmentId 不同且引用沒有連結時：卡片改開網站課程頁，純文字顯示尚未提供跳轉連結', () => {
      env.lineLoginCallbackUrl = 'https://focusflow.example/line/callback';
      const qaResult = {
        answer: '回答',
        clip: { segmentId: 'A', jumpUrl: URL_CLIP },
        citations: [citation('B', null)],
        matches: [],
        runtime: {},
      };

      const flat = firstButtonUri(qaResult);
      const lines = buildQuestionSummaryLines(qaResult);

      assert.doesNotMatch(flat, /videos\.local/);
      assert.match(flat, /https:\/\/focusflow\.example\/app\/courses/);
      assert.equal(lines.some((line) => line.startsWith('跳轉：')), false);
      assert.equal(lines.some((line) => line.includes('尚未提供跳轉連結')), true);
    });
  });

  describe('對話歷史寫回防呆', () => {
    it('沒有異動時，本輪兩筆對話照常寫入歷史', async () => {
      const student = store.users.find((user) => user._id === ids.student);
      student.activeCourseId = ids.publishedCourse;
      student.lineConversationHistory = [];
      stubLineApi();

      const result = await postLineText(serverContext.baseUrl, 'JWT authentication 是什麼？');

      assert.equal(result.body.data.results[0].handled, true);
      assert.deepEqual(student.lineConversationHistory.map((item) => item.role), ['user', 'model']);
      assert.equal(student.lineConversationHistory[0].content, 'JWT authentication 是什麼？');
    });

    it('等待回答期間學生切換了課程，舊課程的對話不寫回歷史', async () => {
      addCourseBFixture();
      const student = store.users.find((user) => user._id === ids.student);
      student.activeCourseId = ids.publishedCourse;
      student.lineConversationHistory = [];
      stubLineApi({ onLoading: () => { student.activeCourseId = PHASE35_IDS.courseB; } });
      // harness 的 User.findOne 回傳 store 裡的同一個物件，handleQuestion 手上的 user 會跟著被改，
      // 與真實 Mongoose 回傳快照不同；這個測試暫時改回傳快照，結束後還原。
      const User = require('../src/models/user.model');
      const harnessFindOne = User.findOne;
      User.findOne = async (query) => {
        const found = await harnessFindOne(query);
        return found ? { ...found } : found;
      };

      let result;
      try {
        result = await postLineText(serverContext.baseUrl, 'JWT authentication 是什麼？');
      } finally {
        User.findOne = harnessFindOne;
      }

      assert.equal(result.body.data.results[0].handled, true);
      assert.equal(student.activeCourseId, PHASE35_IDS.courseB);
      assert.equal(student.lineConversationHistory.length, 0);
    });

    it('等待回答期間學生解除了綁定，對話不寫回已清空的歷史', async () => {
      const student = store.users.find((user) => user._id === ids.student);
      student.activeCourseId = ids.publishedCourse;
      student.lineConversationHistory = [];
      stubLineApi({
        onLoading: () => {
          student.lineUserId = null;
          student.lineConversationHistory = [];
        },
      });

      const result = await postLineText(serverContext.baseUrl, 'JWT authentication 是什麼？');

      assert.equal(result.body.data.results[0].handled, true);
      assert.equal(student.lineConversationHistory.length, 0);
    });
  });

  describe('Webhook 重送去重', () => {
    async function postQuestionEvent(webhookEventId, { isRedelivery = false } = {}) {
      lineEventSequence += 1;
      const payload = JSON.stringify({
        events: [{
          type: 'message',
          ...(webhookEventId ? { webhookEventId } : {}),
          deliveryContext: { isRedelivery },
          replyToken: `reply-dedup-${lineEventSequence}`,
          source: { type: 'user', userId: 'line-student-001' },
          message: { type: 'text', text: 'JWT authentication 是什麼？' },
        }],
      });
      return postLineWebhook(serverContext.baseUrl, payload, {
        'x-line-signature': createLineSignature(payload),
      });
    }

    function setupAskingStudent() {
      const student = store.users.find((user) => user._id === ids.student);
      student.activeCourseId = ids.publishedCourse;
      student.lineConversationHistory = [];
      return student;
    }

    it('同一個 webhookEventId 送來第二次：不再提問、不再回覆、不重複計次', async () => {
      setupAskingStudent();
      const calls = stubLineApi();
      const eventId = `evt-dedup-${Date.now()}-a`;

      const first = await postQuestionEvent(eventId);
      const repliesAfterFirst = calls.replies.length;
      const usageLogsAfterFirst = store.usageLogs.length;
      const second = await postQuestionEvent(eventId, { isRedelivery: true });

      assert.equal(first.body.data.results[0].handled, true);
      assert.equal(second.status, 200);
      assert.equal(second.body.data.results[0].handled, false);
      assert.equal(second.body.data.results[0].reason, 'duplicate_event');
      assert.equal(calls.replies.length, repliesAfterFirst);
      assert.equal(store.questions.length, 1);
      assert.equal(usageLogsAfterFirst > 0, true);
      assert.equal(store.usageLogs.length, usageLogsAfterFirst);
    });

    it('不同的 webhookEventId 或沒有 webhookEventId 的事件照常各處理一次', async () => {
      setupAskingStudent();
      stubLineApi();

      const first = await postQuestionEvent(`evt-dedup-${Date.now()}-b`);
      const second = await postQuestionEvent(`evt-dedup-${Date.now()}-c`);
      const third = await postQuestionEvent(null);
      const fourth = await postQuestionEvent(null);

      for (const result of [first, second, third, fourth]) {
        assert.equal(result.body.data.results[0].handled, true);
      }
      assert.equal(store.questions.length, 4);
    });

    it('第一次處理失敗的事件，重送時會再處理一次', async () => {
      setupAskingStudent();
      env.lineChannelAccessToken = 'review-regression-access-token';
      const eventId = `evt-dedup-${Date.now()}-d`;
      // 第一次：LINE 的 reply 與 push 都失敗，事件以 internal_error 結束。
      global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://api.line.me/')) return originalFetch(url, options);
        if (String(url).endsWith('/chat/loading/start')) return { ok: true, text: async () => '' };
        return { ok: false, text: async () => 'line api down' };
      };
      const failed = await postQuestionEvent(eventId);
      assert.equal(failed.body.data.results[0].reason, 'internal_error');

      const calls = stubLineApi();
      const retried = await postQuestionEvent(eventId, { isRedelivery: true });

      assert.equal(retried.body.data.results[0].handled, true);
      assert.equal(calls.replies.length > 0, true);
    });
  });

  describe('Webhook 簽章比對', () => {
    it('長度相同但內容錯誤的簽章回 401 LINE_SIGNATURE_INVALID', async () => {
      const payload = JSON.stringify({ events: [] });
      const valid = createLineSignature(payload);
      // 只改最後一個有效字元，長度與格式都跟正確簽章一樣
      const forged = `${valid.slice(0, 42)}${valid[42] === 'A' ? 'B' : 'A'}=`;
      assert.equal(forged.length, valid.length);
      assert.notEqual(forged, valid);

      const result = await postLineWebhook(serverContext.baseUrl, payload, { 'x-line-signature': forged });

      assert.equal(result.status, 401);
      assert.equal(result.body.error.code, 'LINE_SIGNATURE_INVALID');
    });

    it('長度不同的簽章回 401 而不是 500', async () => {
      const payload = JSON.stringify({ events: [] });
      const valid = createLineSignature(payload);

      for (const signature of [valid.slice(0, -4), `${valid}AAAA`, 'x']) {
        const result = await postLineWebhook(serverContext.baseUrl, payload, { 'x-line-signature': signature });
        assert.equal(result.status, 401);
        assert.equal(result.body.error.code, 'LINE_SIGNATURE_INVALID');
      }
    });

    it('正確簽章仍可通過', async () => {
      const payload = JSON.stringify({ events: [] });

      const result = await postLineWebhook(serverContext.baseUrl, payload, {
        'x-line-signature': createLineSignature(payload),
      });

      assert.equal(result.status, 200);
    });
  });
});
