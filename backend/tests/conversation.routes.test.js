const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  env, ids, newObjectId, resetStore, startServer, stopServer, jsonRequest, loginAs, store,
} = require('./helpers/backendTestHarness');

describe('conversation routes', () => {
  let context;
  before(async () => { context = await startServer(); });
  after(async () => stopServer(context.server));
  beforeEach(() => {
    resetStore();
    env.qaQueryEmbeddingProvider = 'mock';
    env.qaVectorSearchMode = 'memory';
    env.qaAnswerProvider = 'template';
  });

  it('creates a course-scoped conversation and persists a question and answer', async () => {
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });
    assert.equal(created.status, 201);

    const answered = await jsonRequest(
      context.baseUrl,
      `/api/v1/conversations/${created.body.data.id}/messages`,
      { method: 'POST', token, body: { content: 'What does the course say about JWT authentication?' } },
    );
    assert.equal(answered.status, 201);
    assert.equal(answered.body.data.userMessage.role, 'user');
    assert.equal(answered.body.data.assistantMessage.role, 'assistant');
    assert.equal(store.messages.length, 2);
    assert.equal(store.questions.length, 1);
  });

  it('isolates conversation history by owner', async () => {
    const studentToken = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const teacherToken = await loginAs(context.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token: studentToken, body: { courseId: ids.publishedCourse },
    });
    const result = await jsonRequest(
      context.baseUrl,
      `/api/v1/conversations/${created.body.data.id}/messages`,
      { method: 'POST', token: teacherToken, body: { content: 'Can I access this?' } },
    );
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'CONVERSATION_ACCESS_DENIED');
  });

  it('keeps the legacy single-turn QA endpoint available', async () => {
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(context.baseUrl, '/api/v1/qa/ask', {
      method: 'POST', token,
      body: { courseId: ids.publishedCourse, question: 'What does the course say about JWT authentication?' },
    });
    assert.equal(result.status, 200);
  });

  it('allows multiple conversations in the same course and lists only the owner in recent order', async () => {
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const first = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });
    const second = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });
    store.conversations.find((item) => item._id === first.body.data.id).updatedAt = '2026-08-20T00:00:00.000Z';
    store.conversations.find((item) => item._id === second.body.data.id).updatedAt = '2026-08-21T00:00:00.000Z';
    store.conversations.push({
      _id: newObjectId(), userId: ids.teacher, courseId: ids.publishedCourse,
      title: 'Other owner', createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
    });

    const listed = await jsonRequest(
      context.baseUrl,
      `/api/v1/conversations?courseId=${ids.publishedCourse}`,
      { token },
    );
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.data.conversations.map((item) => item.id), [second.body.data.id, first.body.data.id]);
  });

  it('scopes the list by course and rejects inaccessible cross-course queries', async () => {
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });
    const listed = await jsonRequest(
      context.baseUrl,
      `/api/v1/conversations?courseId=${ids.publishedCourse}`,
      { token },
    );
    const denied = await jsonRequest(
      context.baseUrl,
      `/api/v1/conversations?courseId=${ids.teacherCourse}`,
      { token },
    );
    assert.deepEqual(listed.body.data.conversations.map((item) => item.id), [created.body.data.id]);
    assert.equal(denied.status, 403);
  });

  it('resumes messages chronologically with per-answer sources', async () => {
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });
    await jsonRequest(context.baseUrl, `/api/v1/conversations/${created.body.data.id}/messages`, {
      method: 'POST', token, body: { content: 'What does the course say about JWT authentication?' },
    });
    const resumed = await jsonRequest(
      context.baseUrl,
      `/api/v1/conversations/${created.body.data.id}/messages`,
      { token },
    );
    assert.deepEqual(resumed.body.data.messages.map((item) => item.role), ['user', 'assistant']);
    assert.ok(resumed.body.data.messages[1].sources.length > 0);
  });

  it('starts a new conversation without carrying history from the previous conversation', async () => {
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const first = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });
    await jsonRequest(context.baseUrl, `/api/v1/conversations/${first.body.data.id}/messages`, {
      method: 'POST', token, body: { content: '什麼是 CNN？' },
    });
    const second = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });
    const response = await jsonRequest(context.baseUrl, `/api/v1/conversations/${second.body.data.id}/messages`, {
      method: 'POST', token, body: { content: '老師有介紹 MongoDB 嗎？' },
    });
    assert.equal(response.body.data.requiresContext, false);
    assert.doesNotMatch(response.body.data.standaloneQuestion, /CNN/);
  });

  it('retries a failed answer with the same user message and no duplicate question message', async () => {
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });
    env.qaQueryEmbeddingProvider = 'gemini';
    env.geminiApiKey = '';
    const failed = await jsonRequest(context.baseUrl, `/api/v1/conversations/${created.body.data.id}/messages`, {
      method: 'POST', token, body: { content: 'What does the course say about JWT authentication?' },
    });
    assert.equal(failed.status, 201);
    assert.equal(failed.body.data.assistantMessage.status, 'failed');
    const userMessageId = failed.body.data.userMessage.id;
    env.qaQueryEmbeddingProvider = 'mock';
    const retried = await jsonRequest(
      context.baseUrl,
      `/api/v1/conversations/${created.body.data.id}/messages/${userMessageId}/retry`,
      { method: 'POST', token },
    );
    assert.equal(retried.status, 200);
    assert.equal(retried.body.data.assistantMessage.status, 'completed');
    assert.equal(store.messages.filter((item) => item.role === 'user').length, 1);
    assert.equal(store.messages.filter((item) => item.role === 'assistant').length, 1);
  });
});
