const assert = require('node:assert/strict');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
const {
  env,
  ids,
  store,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
  createLineSignature,
  postLineWebhook,
} = require('./helpers/backendTestHarness');
const { getTaipeiDayWindow } = require('../src/services/askLimits.service');

const originalFetch = global.fetch;
const QUESTION = 'What does the course say about JWT authentication?';

function resetQaEnv() {
  env.qaQueryEmbeddingProvider = 'mock';
  env.qaVectorSearchMode = 'memory';
  env.qaAnswerProvider = 'template';
  env.geminiApiKey = '';
  env.lineChannelAccessToken = '';
  env.qaMaxQuestionLength = 0;
  env.qaDailyAskLimitPerStudent = 0;
}

function seedQuestions(count, { userId = ids.student, status = 'answered', askedAt = new Date() } = {}) {
  for (let index = 0; index < count; index += 1) {
    store.questions.push({
      _id: newObjectId(),
      userId,
      courseId: ids.publishedCourse,
      question: `seed-${index}`,
      status,
      askedAt,
    });
  }
}

let lineSequence = 0;
async function postLineText(baseUrl, text, lineUserId = 'line-student-001') {
  lineSequence += 1;
  const payload = JSON.stringify({
    events: [{
      type: 'message',
      replyToken: `reply-ask-limit-${lineSequence}`,
      source: { userId: lineUserId },
      message: { type: 'text', text },
    }],
  });
  return postLineWebhook(baseUrl, payload, { 'x-line-signature': createLineSignature(payload) });
}

describe('提問限制與失敗紀錄', () => {
  let context;

  before(async () => { context = await startServer(); });
  after(async () => {
    resetQaEnv();
    await stopServer(context.server);
  });
  beforeEach(() => {
    resetStore();
    resetQaEnv();
    global.fetch = originalFetch;
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('台灣時間的每日區間從當天 00:00（UTC 前一天 16:00）開始', () => {
    const { start, end } = getTaipeiDayWindow(new Date('2026-09-18T01:00:00+08:00'));
    assert.equal(start.toISOString(), '2026-09-17T16:00:00.000Z');
    assert.equal(end.toISOString(), '2026-09-18T16:00:00.000Z');
  });

  it('問題超過字數上限時回 400 QUESTION_TOO_LONG 且不記錄提問', async () => {
    env.qaMaxQuestionLength = 50;
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(context.baseUrl, '/api/v1/qa/ask', {
      method: 'POST', token, body: { courseId: ids.publishedCourse, question: '問'.repeat(51) },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'QUESTION_TOO_LONG');
    assert.equal(store.questions.length, 0);
  });

  it('剛好 50 字的問題可以正常提問', async () => {
    env.qaMaxQuestionLength = 50;
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(context.baseUrl, '/api/v1/qa/ask', {
      method: 'POST', token, body: { courseId: ids.publishedCourse, question: `JWT${'問'.repeat(47)}` },
    });

    assert.equal(result.status, 200);
  });

  it('學生當天已提問 5 次時回 429 QA_DAILY_LIMIT_EXCEEDED', async () => {
    env.qaDailyAskLimitPerStudent = 5;
    seedQuestions(5);
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(context.baseUrl, '/api/v1/qa/ask', {
      method: 'POST', token, body: { courseId: ids.publishedCourse, question: QUESTION },
    });

    assert.equal(result.status, 429);
    assert.equal(result.body.error.code, 'QA_DAILY_LIMIT_EXCEEDED');
    assert.equal(store.questions.length, 5);
  });

  it('系統失敗（failed）與前一天的提問不計入今天的次數', async () => {
    env.qaDailyAskLimitPerStudent = 5;
    seedQuestions(5, { status: 'failed' });
    seedQuestions(5, { askedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(context.baseUrl, '/api/v1/qa/ask', {
      method: 'POST', token, body: { courseId: ids.publishedCourse, question: QUESTION },
    });

    assert.equal(result.status, 200);
  });

  it('教師不受每日提問次數限制', async () => {
    env.qaDailyAskLimitPerStudent = 5;
    seedQuestions(5, { userId: ids.teacher });
    const token = await loginAs(context.baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const result = await jsonRequest(context.baseUrl, '/api/v1/qa/ask', {
      method: 'POST', token, body: { courseId: ids.publishedCourse, question: QUESTION },
    });

    assert.notEqual(result.status, 429);
  });

  it('多輪對話達每日上限時直接拒絕且不建立訊息', async () => {
    env.qaDailyAskLimitPerStudent = 5;
    seedQuestions(5);
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });

    const result = await jsonRequest(
      context.baseUrl,
      `/api/v1/conversations/${created.body.data.id}/messages`,
      { method: 'POST', token, body: { content: QUESTION } },
    );

    assert.equal(result.status, 429);
    assert.equal(result.body.error.code, 'QA_DAILY_LIMIT_EXCEEDED');
    assert.equal(store.messages.length, 0);
  });

  it('LINE 提問超過字數或次數時回覆原因，不呼叫 AI', async () => {
    store.users.find((user) => user._id === ids.student).activeCourseId = ids.publishedCourse;
    env.qaMaxQuestionLength = 50;
    env.qaDailyAskLimitPerStudent = 5;

    const tooLong = await postLineText(context.baseUrl, '問'.repeat(51));
    assert.equal(tooLong.body.data.results[0].reason, 'question_too_long');

    seedQuestions(5);
    const limited = await postLineText(context.baseUrl, QUESTION);
    assert.equal(limited.body.data.results[0].reason, 'daily_limit_reached');
    assert.equal(store.questions.length, 5);
  });

  it('網頁 QA 發生系統錯誤時寫入 failed 提問紀錄', async () => {
    // atlas 模式搭配 mock embedding 是不合法設定，會回 QA_RUNTIME_MISCONFIGURED。
    env.qaVectorSearchMode = 'atlas';
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');

    const result = await jsonRequest(context.baseUrl, '/api/v1/qa/ask', {
      method: 'POST', token, body: { courseId: ids.publishedCourse, question: QUESTION },
    });

    assert.equal(result.status, 500);
    assert.equal(store.questions.length, 1);
    assert.equal(store.questions[0].status, 'failed');
    assert.equal(store.questions[0].runtime.errorCode, 'QA_RUNTIME_MISCONFIGURED');
  });

  it('多輪對話發生系統錯誤時也寫入 failed 提問紀錄', async () => {
    env.qaVectorSearchMode = 'atlas';
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });

    const result = await jsonRequest(
      context.baseUrl,
      `/api/v1/conversations/${created.body.data.id}/messages`,
      { method: 'POST', token, body: { content: QUESTION } },
    );

    assert.equal(result.body.data.failed, true);
    assert.equal(store.questions.filter((item) => item.status === 'failed').length, 1);
  });

  it('同一個 LINE 帳號改綁另一個系統帳號時，自動解除舊帳號綁定', async () => {
    const token = 'c'.repeat(64);
    store.lineBindTokens.push({
      _id: newObjectId(),
      token,
      userId: ids.teacher,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const result = await postLineText(context.baseUrl, token);

    assert.equal(result.body.data.results[0].handled, true);
    const student = store.users.find((user) => user._id === ids.student);
    const teacher = store.users.find((user) => user._id === ids.teacher);
    assert.equal(teacher.lineUserId, 'line-student-001');
    assert.equal(student.lineUserId, undefined);
  });

  it('LINE reply 失敗（replyToken 過期）時改用 push 送出答案', async () => {
    store.users.find((user) => user._id === ids.student).activeCourseId = ids.publishedCourse;
    env.lineChannelAccessToken = 'test-access-token';
    const lineCalls = [];
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.line.me')) {
        lineCalls.push(String(url));
        if (String(url).endsWith('/message/reply')) {
          return { ok: false, status: 400, text: async () => '{"message":"Invalid reply token"}' };
        }
        return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
      }
      return originalFetch(url, options);
    };

    const result = await postLineText(context.baseUrl, QUESTION);

    assert.equal(result.body.data.results[0].handled, true);
    assert.equal(result.body.data.results[0].replyReason, 'reply_failed_push_fallback');
    assert.ok(lineCalls.some((url) => url.endsWith('/chat/loading/start')));
    assert.ok(lineCalls.some((url) => url.endsWith('/message/push')));
  });
});
