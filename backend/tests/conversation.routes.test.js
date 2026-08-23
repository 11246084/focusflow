const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  env, ids, resetStore, startServer, stopServer, jsonRequest, loginAs, store,
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
});
