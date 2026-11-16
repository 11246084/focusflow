const assert = require('node:assert/strict');
const { before, after, beforeEach, describe, it } = require('node:test');
const { env, ids, resetStore, startServer, stopServer, jsonRequest, loginAs, store } = require('./helpers/backendTestHarness');
const VideoSegment = require('../src/models/videoSegment.model');
const Faq = require('../src/models/faq.model');
const { preflightCurrentSegment } = require('../src/services/qa.service');
const { getDailyAskUsage } = require('../src/services/askLimits.service');
describe('current segment questions', () => {
  let context, token, conversationId, original, usageBefore;
  const keys = ['qaQueryEmbeddingProvider', 'qaVectorSearchMode', 'qaAnswerProvider', 'geminiApiKey', 'openaiApiKey', 'qaAtlasVectorIndexName', 'qaDailyAskLimitPerStudent'];
  before(async () => { original = Object.fromEntries(keys.map((key) => [key, env[key]])); context = await startServer(); });
  after(async () => { Object.assign(env, original); await stopServer(context.server); });
  beforeEach(async () => {
    resetStore(); Object.assign(env, { qaQueryEmbeddingProvider: 'openai', qaVectorSearchMode: 'atlas', qaAnswerProvider: 'template', openaiApiKey: '', qaAtlasVectorIndexName: '', qaDailyAskLimitPerStudent: 0 });
    token = await loginAs(context.baseUrl, 'student@focusflow.local', 'Student123!');
    const created = await jsonRequest(context.baseUrl, '/api/v1/conversations', { method: 'POST', token, body: { courseId: ids.publishedCourse } }); conversationId = created.body.data.id; usageBefore = store.usageLogs.length;
  });
  const body = () => ({ content: '這段在講什麼', scope: 'current_segment', videoId: ids.publishedVideo, positionSec: 45 });
  const send = (payload, stream = false) => jsonRequest(context.baseUrl, `/api/v1/conversations/${conversationId}/messages${stream ? '/stream' : ''}`, { method: 'POST', token, body: payload });
  it('uses authorized bounded segments without vector or FAQ access despite invalid retrieval configuration', async () => {
    const originalFind = VideoSegment.find; const originalFaqFind = Faq.findOne; let query, projection;
    VideoSegment.find = (...args) => { query = args[0]; const result = originalFind(...args); const select = result.select; result.select = function (fields) { projection = fields; return select.call(this, fields); }; return result; };
    Faq.findOne = () => { throw new Error('FAQ must not be read'); };
    try {
      const result = await send(body()); assert.equal(result.status, 201); assert.equal(result.body.data.failed, false);
      assert.equal(result.body.data.runtime.scope, 'current_segment'); assert.equal(result.body.data.runtime.readiness, 'ready');
      assert.equal(query.videoId, ids.publishedVideo); assert.ok(!projection.includes('embedding'));
      assert.ok(result.body.data.sources.length > 0);
      assert.ok(result.body.data.sources[0].startSec <= 45 && result.body.data.sources[0].endSec >= 45);
      assert.ok(result.body.data.sources.every((source) => source.startSec <= 105 && source.endSec >= 0));
      assert.equal(store.questions[0].runtime.scope, 'current_segment'); assert.equal(store.messages[0].runtime.currentSegment.positionSec, 45);
    } finally { VideoSegment.find = originalFind; Faq.findOne = originalFaqFind; }
  });
  it('rejects missing position, foreign video and empty windows before writes on both endpoints', async () => {
    for (const [payload, stream] of [[{ ...body(), positionSec: null }, false], [{ ...body(), videoId: '507f191e810c19729de860ff' }, false], [{ ...body(), positionSec: 5000 }, true]]) {
      const result = await send(payload, stream); assert.equal(result.status, 400); assert.equal(result.body.error.code, 'CURRENT_SEGMENT_UNAVAILABLE');
    }
    assert.equal(store.messages.length, 0); assert.equal(store.questions.length, 0); assert.equal(store.usageLogs.length, usageBefore);
  });
  it('accepts nearby content at the beginning and in a gap on both endpoints', async () => {
    for (const positionSec of [0, 36]) {
      for (const stream of [false, true]) {
        const result = await send({ ...body(), positionSec }, stream);
        assert.equal(result.status, 201);
      }
    }
  });
  it('rejects non-overlapping windows without writes or quota on both endpoints', async () => {
    for (const stream of [false, true]) {
      const result = await send({ ...body(), positionSec: 5000 }, stream);
      assert.equal(result.status, 400); assert.equal(result.body.error.code, 'CURRENT_SEGMENT_UNAVAILABLE');
    }
    assert.equal(store.messages.length, 0); assert.equal(store.questions.length, 0);
    assert.equal(store.usageLogs.length, usageBefore);
    assert.equal((await getDailyAskUsage({ id: ids.student, role: 'student', dailyAskLimitOverride: 1 })).used, 0);
  });
  it('includes closed window intersections and orders by distance to the interval', async () => {
    const sample = store.videoSegments[0];
    store.videoSegments.length = 0;
    for (const [id, startSec, endSec] of [
      ['left-cross', 20, 40], ['right-cross', 160, 180],
      ['outside-left', 20, 39], ['outside-right', 161, 180],
      ['past', 50, 99], ['future', 102, 103], ['covering', 90, 110],
    ]) {
      store.videoSegments.push({ ...sample, _id: id, segmentId: id, chunkId: id, startSec, endSec });
    }
    const result = await preflightCurrentSegment({ user: { id: ids.student, role: 'student' }, courseId: ids.publishedCourse, videoId: ids.publishedVideo, positionSec: 100 });
    const segments = result.matches.map((match) => match.segmentId);
    assert.deepEqual(segments.slice(0, 3), ['covering', 'past', 'future']);
    assert.ok(segments.includes('left-cross')); assert.ok(segments.includes('right-cross'));
    assert.ok(!segments.includes('outside-left')); assert.ok(!segments.includes('outside-right'));
  });
  it('rejects an existing video from another course before querying segments', async () => {
    assert.ok(store.videos.some((video) => String(video._id) === ids.teacherVideo));
    const originalFind = VideoSegment.find; let queries = 0;
    VideoSegment.find = (...args) => { queries++; return originalFind(...args); };
    try { const result = await send({ ...body(), videoId: ids.teacherVideo }); assert.equal(result.status, 400); assert.equal(result.body.error.code, 'CURRENT_SEGMENT_UNAVAILABLE'); assert.equal(queries, 0); assert.equal(store.messages.length, 0); }
    finally { VideoSegment.find = originalFind; }
  });
  it('enforces the daily limit before either endpoint creates messages', async () => {
    env.qaDailyAskLimitPerStudent = 1;
    store.questions.push({ userId: ids.student, status: 'answered', askedAt: new Date() });
    for (const stream of [false, true]) {
      const result = await send(body(), stream); assert.equal(result.status, 429); assert.equal(result.body.error.code, 'QA_DAILY_LIMIT_EXCEEDED');
    }
    assert.equal(store.messages.length, 0); assert.equal(store.usageLogs.length, usageBefore);
  });
  it('streams the current segment response and retries stale pending with the same scope', async () => {
    const response = await fetch(`${context.baseUrl}/api/v1/conversations/${conversationId}/messages/stream`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    assert.equal(response.status, 201); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const events = (await response.text()).split('\n\n').filter((part) => part.startsWith('event: ')).map((part) => { const lines = part.split('\n'); return { event: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) }; });
    assert.deepEqual(events.map((event) => event.event), ['accepted', 'stage', 'done']);
    assert.deepEqual(events.filter((event) => event.event === 'stage').map((event) => event.data.stage), ['writing']);
    const accepted = events[0].data; const done = events.at(-1).data.data;
    assert.equal(accepted.assistantMessage.status, 'pending'); assert.equal(done.runtime.scope, 'current_segment'); assert.ok(done.sources.length > 0);
    assert.equal(done.userMessage.id, accepted.userMessageId); assert.equal(done.assistantMessage.id, accepted.assistantMessageId);
    const assistant = store.messages.find((message) => String(message._id) === accepted.assistantMessageId);
    assistant.status = 'pending'; assistant.updatedAt = new Date(Date.now() - 121000);
    const retry = await jsonRequest(context.baseUrl, `/api/v1/conversations/${conversationId}/messages/${accepted.userMessageId}/retry`, { method: 'POST', token });
    assert.equal(retry.status, 200); assert.equal(retry.body.data.failed, false); assert.equal(retry.body.data.runtime.scope, 'current_segment');
    assert.deepEqual(retry.body.data.runtime.currentSegment, { videoId: ids.publishedVideo, positionSec: 45 });
    assert.equal(retry.body.data.assistantMessage.id, accepted.assistantMessageId);
  });
  it('keeps normal questions subject to retrieval configuration', async () => {
    const result = await send({ content: '目前最常用的演算法是什麼' }); assert.equal(result.body.data.failed, true); assert.equal(result.body.data.assistantMessage.errorCode, 'QA_RUNTIME_MISCONFIGURED');
  });
  it('fails without fallback or usage when provider fails, including retry', async () => {
    env.qaAnswerProvider = 'gemini'; env.geminiApiKey = 'test'; const fetchBefore = global.fetch;
    global.fetch = async (...args) => String(args[0]).includes('generativelanguage.googleapis.com') ? Promise.reject(new Error('provider down')) : fetchBefore(...args);
    try {
      const first = await send(body()); assert.equal(first.body.data.failed, true); assert.equal((await getDailyAskUsage({ id: ids.student, role: 'student', dailyAskLimitOverride: 1 })).used, 0);
      const retry = await jsonRequest(context.baseUrl, `/api/v1/conversations/${conversationId}/messages/${first.body.data.userMessage.id}/retry`, { method: 'POST', token });
      assert.equal(retry.body.data.failed, true); assert.equal(retry.body.data.runtime.scope, 'current_segment'); assert.equal((await getDailyAskUsage({ id: ids.student, role: 'student', dailyAskLimitOverride: 1 })).used, 0);
    } finally { global.fetch = fetchBefore; }
  });
});
