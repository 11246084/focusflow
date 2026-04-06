const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  ids,
  resetStore,
  startServer,
  stopServer,
  createLineSignature,
  postLineWebhook,
  store,
} = require('./helpers/backendTestHarness');

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

  it('handles empty event payloads', async () => {
    const payload = JSON.stringify({ events: [] });
    const result = await postLineWebhook(serverContext.baseUrl, payload, {
      'x-line-signature': createLineSignature(payload),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.received, 0);
    assert.equal(result.body.data.processed, 0);
    assert.deepEqual(result.body.data.results, []);
  });

  it('covers bind token not found and expired branches', async () => {
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
    assert.equal(expiredResult.status, 200);
    assert.equal(expiredResult.body.data.results[0].reason, 'token_expired');
    assert.equal(store.lineBindTokens.some((token) => token.token === ids.expiredLineBindTokenText), false);
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
    assert.equal(noCourseResult.status, 200);
    assert.equal(noCourseResult.body.data.results[0].reason, 'active_course_missing');
  });

  it('switches courses and handles select_course postbacks', async () => {
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

    assert.equal(switchResult.status, 200);
    assert.equal(switchResult.body.data.results[0].handled, true);
    assert.equal(selectResult.status, 200);
    assert.equal(selectResult.body.data.results[0].handled, true);
    assert.equal(String(store.users.find((user) => user._id === ids.student).activeCourseId), ids.publishedCourse);
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
    assert.equal(result.body.data.results[1].reason, 'unsupported_event');
  });

  it('isolates per-event internal errors without failing the batch', async () => {
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
    assert.equal(result.body.data.results[0].reason, 'internal_error');
    assert.equal(result.body.data.results[1].reason, 'unsupported_event');
  });
});
