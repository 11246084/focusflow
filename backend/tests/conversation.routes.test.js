const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  env, ids, newObjectId, resetStore, startServer, stopServer, jsonRequest, loginAs, store,
} = require('./helpers/backendTestHarness');
const { NO_ANSWER_INSUFFICIENT } = require('../src/services/answerGeneration.service');

const originalFetch = global.fetch;

describe('conversation routes', () => {
  let context;
  before(async () => { context = await startServer(); });
  after(async () => stopServer(context.server));
  beforeEach(() => {
    resetStore();
    env.qaQueryEmbeddingProvider = 'mock';
    env.qaVectorSearchMode = 'memory';
    env.qaAnswerProvider = 'template';
    env.geminiApiKey = '';
    global.fetch = originalFetch;
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

  it('logs only question lengths and the first 80 characters', async () => {
    const question = `${'Q'.repeat(80)}${'PRIVATE_AFTER_PREVIEW'.repeat(3)}`;
    const logs = [];
    const originalInfo = console.info;
    console.info = (...args) => logs.push(args);

    try {
      const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
      const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
        method: 'POST', token, body: { courseId: ids.publishedCourse },
      });
      const answered = await jsonRequest(
        context.baseUrl,
        `/api/v1/conversations/${created.body.data.id}/messages`,
        { method: 'POST', token, body: { content: question } },
      );

      assert.equal(answered.status, 201);
      const qaLog = logs.find(([event]) => event === '[conversational-qa]');
      assert.ok(qaLog);
      assert.equal(qaLog[1].originalQuestionLength, question.length);
      assert.equal(qaLog[1].originalQuestionPreview, 'Q'.repeat(80));
      assert.equal(qaLog[1].standaloneQuestionLength, question.length);
      assert.equal(qaLog[1].standaloneQuestionPreview, 'Q'.repeat(80));
      assert.equal(Object.hasOwn(qaLog[1], 'originalQuestion'), false);
      assert.equal(Object.hasOwn(qaLog[1], 'standaloneQuestion'), false);
      assert.equal(JSON.stringify(qaLog).includes('PRIVATE_AFTER_PREVIEW'), false);
    } finally {
      console.info = originalInfo;
    }
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

  it('does not expose raw retrieval matches as conversation sources after a no-answer reply', async () => {
    env.qaAnswerProvider = 'gemini';
    env.geminiApiKey = 'gemini-test-key';
    global.fetch = async (url, options) => {
      if (!String(url).includes('generativelanguage.googleapis.com')) {
        return originalFetch(url, options);
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async text() {
          return JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify({
              answer: NO_ANSWER_INSUFFICIENT,
              supportingEvidenceIds: [],
            }) }] } }],
          });
        },
      };
    };
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', {
      method: 'POST', token, body: { courseId: ids.publishedCourse },
    });

    const answered = await jsonRequest(
      context.baseUrl,
      `/api/v1/conversations/${created.body.data.id}/messages`,
      { method: 'POST', token, body: { content: 'What does the course say about JWT authentication?' } },
    );

    assert.equal(answered.status, 201);
    assert.equal(answered.body.data.answer, NO_ANSWER_INSUFFICIENT);
    assert.deepEqual(answered.body.data.sources, []);
    assert.deepEqual(answered.body.data.assistantMessage.sources, []);
    assert.deepEqual(store.messages.at(-1).sources, []);
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

async function sseRequest(baseUrl, path, token, content) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  const text = await response.text();
  const events = text.split('\n\n').filter((part) => part.startsWith('event: ')).map((part) => {
    const lines = part.split('\n');
    return { event: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) };
  });
  return { response, text, events };
}

describe('conversation streaming', () => {
  let context;
  let originalEnv;
  before(async () => {
    originalEnv = Object.fromEntries(['qaQueryEmbeddingProvider', 'qaVectorSearchMode', 'qaAnswerProvider', 'geminiApiKey'].map((key) => [key, env[key]]));
    context = await startServer();
  });
  after(async () => {
    try { await stopServer(context.server); } finally { Object.assign(env, originalEnv); }
  });
  beforeEach(() => { resetStore(); env.qaQueryEmbeddingProvider = 'mock'; env.qaVectorSearchMode = 'memory'; env.qaAnswerProvider = 'template'; env.geminiApiKey = ''; });
  async function setup() {
    const token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', { method: 'POST', token, body: { courseId: ids.publishedCourse } });
    return { token, id: created.body.data.id };
  }
  it('streams accepted, real stages and the existing response envelope', async () => {
    const { token, id } = await setup();
    const result = await sseRequest(context.baseUrl, `/api/v1/conversations/${id}/messages/stream`, token, 'What does the course say about JWT authentication?');
    assert.match(result.response.headers.get('content-type'), /text\/event-stream/);
    assert.equal(result.response.headers.get('x-accel-buffering'), 'no');
    assert.deepEqual(result.events.map((item) => item.event), ['accepted', 'stage', 'stage', 'done']);
    assert.deepEqual(result.events.filter((item) => item.event === 'stage').map((item) => item.data.stage), ['searching', 'writing']);
    const accepted = result.events[0].data;
    const done = result.events.at(-1).data;
    assert.equal(done.success, true);
    assert.equal(done.message, 'Message answered.');
    assert.equal(done.data.assistantMessage.id, accepted.assistantMessageId);
    assert.equal(done.data.assistantMessage.status, 'completed');
  });
  it('matches the legacy response apart from identifiers, timestamps and latency', async () => {
    const { token, id } = await setup();
    const second = await jsonRequest(context.baseUrl, '/api/v1/conversations', { method: 'POST', token, body: { courseId: ids.publishedCourse } });
    const question = 'What does the course say about JWT authentication?';
    const stream = await sseRequest(context.baseUrl, `/api/v1/conversations/${id}/messages/stream`, token, question);
    const legacy = await jsonRequest(context.baseUrl, `/api/v1/conversations/${second.body.data.id}/messages`, { method: 'POST', token, body: { content: question } });
    function normalize(value) {
      if (Array.isArray(value)) return value.map(normalize);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'conversationId', 'replyToMessageId', 'createdAt', 'updatedAt', 'latency', 'conversationLatency'].includes(key) && !/LatencyMs$/.test(key)).map(([key, item]) => [key, normalize(item)]));
    }
    assert.deepEqual(normalize(stream.events.at(-1).data), normalize(legacy.body));
  });
  it('claims an orphan user only once', async () => {
    const { token, id } = await setup();
    const old = new Date(Date.now() - 121000);
    const userId = newObjectId();
    store.messages.push({ _id: userId, conversationId: id, role: 'user', content: 'Question?', status: 'completed', createdAt: old, updatedAt: old });
    const path = `/api/v1/conversations/${id}/messages/${userId}/retry`;
    const results = await Promise.all([1, 2].map(() => jsonRequest(context.baseUrl, path, { method: 'POST', token })));
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
    assert.equal(store.messages.filter((item) => item.role === 'assistant').length, 1);
  });
  it('skips stages for an exact FAQ cache hit', async () => {
    const previous = env.faqCacheEnabled;
    env.faqCacheEnabled = true;
    try {
      const { buildMockEmbedding } = require('../src/services/queryEmbedding.service');
      for (const segment of store.videoSegments) segment.embedding = buildMockEmbedding(segment.text);
      const { token, id } = await setup();
      const question = 'What does the course say about JWT authentication?';
      await jsonRequest(context.baseUrl, '/api/v1/qa/ask', { method: 'POST', token, body: { courseId: ids.publishedCourse, question } });
      const result = await sseRequest(context.baseUrl, `/api/v1/conversations/${id}/messages/stream`, token, question);
      assert.equal(result.events.at(-1).data.data.runtime.faqCache.hit, true);
      assert.deepEqual(result.events.map((item) => item.event), ['accepted', 'done']);
    } finally { env.faqCacheEnabled = previous; }
  });
  it('emits error after headers for unexpected controller failures', async () => {
    const service = require('../src/services/conversation.service');
    const original = service.sendMessage;
    service.sendMessage = async ({ onAccepted }) => {
      onAccepted({ id: 'user' }, { id: 'assistant' });
      throw new Error('unexpected');
    };
    try {
      const { token, id } = await setup();
      const result = await sseRequest(context.baseUrl, `/api/v1/conversations/${id}/messages/stream`, token, 'Question?');
      assert.deepEqual(result.events.map((item) => item.event), ['accepted', 'error']);
    } finally { service.sendMessage = original; }
  });
  it('persists the answer after the client disconnects', async () => {
    const Message = require('../src/models/message.model');
    const original = Message.findByIdAndUpdate;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let completed;
    const saved = new Promise((resolve) => { completed = resolve; });
    Message.findByIdAndUpdate = async (...args) => {
      await gate;
      const result = await original(...args);
      completed();
      return result;
    };
    try {
      const { token, id } = await setup();
      const abort = new AbortController();
      const response = await fetch(`${context.baseUrl}/api/v1/conversations/${id}/messages/stream`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Question?' }), signal: abort.signal,
      });
      await response.body.getReader().read();
      abort.abort();
      release();
      await saved;
      assert.equal(store.messages.at(-1).status, 'completed');
    } finally { release(); Message.findByIdAndUpdate = original; }
  });
  it('returns JSON before headers on validation and done on answer failure', async () => {
    const { token, id } = await setup();
    const previousLimit = env.qaMaxQuestionLength;
    try {
      env.qaMaxQuestionLength = 50;
      const denied = await sseRequest(context.baseUrl, `/api/v1/conversations/${id}/messages/stream`, token, 'x'.repeat(1000));
      assert.equal(denied.response.status, 400);
      assert.match(denied.response.headers.get('content-type'), /application\/json/);
      assert.equal(store.messages.length, 0);
    } finally {
      env.qaMaxQuestionLength = previousLimit;
    }
    env.qaQueryEmbeddingProvider = 'gemini';
    const failed = await sseRequest(context.baseUrl, `/api/v1/conversations/${id}/messages/stream`, token, 'Question?');
    assert.equal(failed.events.at(-1).data.data.failed, true);
    assert.equal(store.messages.at(-1).status, 'failed');
  });
  it('excludes pending from history and claims stale retries once', async () => {
    const { historyFromMessages } = require('../src/services/conversation.service');
    assert.deepEqual(historyFromMessages([{ role: 'assistant', status: 'pending', content: 'placeholder' }]), []);
    const { token, id } = await setup();
    env.qaQueryEmbeddingProvider = 'gemini';
    const failed = await sseRequest(context.baseUrl, `/api/v1/conversations/${id}/messages/stream`, token, 'Question?');
    const userId = failed.events[0].data.userMessageId;
    const assistant = store.messages.at(-1);
    assistant.status = 'pending';
    let retry = await jsonRequest(context.baseUrl, `/api/v1/conversations/${id}/messages/${userId}/retry`, { method: 'POST', token });
    assert.equal(retry.status, 409);
    assistant.updatedAt = new Date(Date.now() - 121000);
    env.qaQueryEmbeddingProvider = 'mock';
    const results = await Promise.all([1, 2].map(() => jsonRequest(context.baseUrl, `/api/v1/conversations/${id}/messages/${userId}/retry`, { method: 'POST', token })));
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
    assert.equal(store.messages.length, 2);
  });
});
