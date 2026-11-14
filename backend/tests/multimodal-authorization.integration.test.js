// Contract matrix Q01..Q11/A01..A06/B01..B05/U01..U03. Reuses the existing harness;
// all providers/repositories are local fakes, not new teaching material or Atlas operations.
const assert = require('node:assert/strict');
const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const { env, ids, store, resetStore, startServer, stopServer, loginAs, jsonRequest, newObjectId } = require('./helpers/backendTestHarness');
const VideoSegment = require('../src/models/videoSegment.model');
const { retrieveAtlasMultimodal, buildAtlasPipeline } = require('../src/services/atlasMultimodalAdapter.service');
const { retrieveForQa } = require('../src/services/multimodalQaBridge.service');
const { buildGeminiTextSearchContract } = require('../src/services/embeddingContract.service');
const { clearMultimodalIndexCache } = require('../src/services/multimodalReadiness.service');
const { saveFaqEntry } = require('../src/services/faqCache.service');
const original = { aggregate: VideoSegment.aggregate, collection: VideoSegment.collection.aggregate, fetch: global.fetch };
const envKeys = ['qaMultimodalFusionEnabled', 'qaVectorSearchMode', 'qaQueryEmbeddingProvider', 'qaAnswerProvider',
  'hierarchicalRetrievalEnabled', 'faqCacheEnabled', 'qaVisualRetrievalEnabled', 'qaMonthlyTokenBudget',
  'qaUserMonthlyTokenQuota', 'qaMaxQuestionLength', 'qaDailyAskLimitPerStudent', 'geminiApiKey',
  'qaAtlasVectorIndexName', 'qaActiveLeafEmbeddingContractJson'];
original.env = Object.fromEntries(envKeys.map(k => [k, env[k]]));
describe('multimodal authorization contract matrix', () => {
let server;
const localFetch = (input, options = {}) => original.fetch(input, { ...options,
  headers: { ...options.headers, Connection: 'close' } });
before(async () => { server = await startServer(); });
after(async () => { await stopServer(server.server); });
beforeEach(() => {
  resetStore(); clearMultimodalIndexCache(); global.fetch = localFetch;
  Object.assign(env, { qaMultimodalFusionEnabled: false, qaVectorSearchMode: 'memory', qaQueryEmbeddingProvider: 'mock',
    qaAnswerProvider: 'template', hierarchicalRetrievalEnabled: false, faqCacheEnabled: false, qaVisualRetrievalEnabled: false,
    qaMonthlyTokenBudget: 0, qaUserMonthlyTokenQuota: 0, qaMaxQuestionLength: 0, qaDailyAskLimitPerStudent: 0 });
});
afterEach(() => { VideoSegment.aggregate = original.aggregate; VideoSegment.collection.aggregate = original.collection;
  Object.assign(env, original.env); global.fetch = original.fetch; clearMultimodalIndexCache(); });
const user = (id = ids.student) => store.users.find(u => u._id === id);
async function ask(courseId = ids.publishedCourse, extra = {}, who = ids.student) {
  const actor = user(who), password = actor.role === 'student' ? 'Student123!' : actor.role === 'admin' ? 'Admin123!' : 'Teacher123!';
  const token = await loginAs(server.baseUrl, actor.email, password, actor.role);
  return jsonRequest(server.baseUrl, '/api/v1/qa/ask', { method: 'POST', token, body: { courseId, question: 'JWT authentication', ...extra } });
}
function publishB({ shared = false } = {}) {
  const course = store.courses.find(c => c._id === ids.teacherCourse);
  course.status = 'published'; course.videoIds = [shared ? ids.publishedVideo : ids.teacherVideo];
  store.enrollments.push({ _id: newObjectId(), studentId: ids.student, courseId: course._id, status: 'active' });
  if (!shared) {
    const source = store.videoSegments[0];
    store.videoSegments.push({ ...source, _id: newObjectId(), segmentId: 'B-segment', chunkId: 'B-chunk', courseId: course._id, videoId: ids.teacherVideo });
    store.videos.find(v => v._id === ids.teacherVideo).processing.status = 'completed';
  }
  return course._id;
}
function legalRows() {
  return store.videoSegments.filter(r => r.videoId === ids.publishedVideo).map((r, i) => ({ ...r,
    chunkId: r.chunkId || r.segmentId, text: r.text, score: .9 - i / 100 }));
}
const contract = buildGeminiTextSearchContract(), vector = [1, ...Array(3071).fill(0)];
const index = { name: 'text_embedding_index', type: 'vectorSearch', status: 'READY', queryable: true,
  latestDefinition: { fields: ['stableTextEmbedding', 'audioEmbedding', 'visualEmbedding'].map(path => ({
    path, type: 'vector', numDimensions: 3072, similarity: 'cosine' })).concat([{ path: 'videoId', type: 'filter' }]) } };
function adapterFixture(rows) {
  return { collection: { aggregate: p => ({ toArray: async () => {
    const kind = { stableTextEmbedding: 'text', audioEmbedding: 'audio', visualEmbedding: 'visual' }[p[0].$vectorSearch.path];
    return rows.map(r => ({ ...r, mediaEmbeddingMeta: { [kind]: kind === 'text' ? { ...contract, courseId: ids.publishedCourse }
      : { provider: 'gemini', model: contract.model, dimension: 3072, status: 'success',
        contractVersion: `gemini_embedding_2_${kind}_v1`, courseId: ids.publishedCourse } } }));
  } }) }, queryEmbedding: { ...contract, status: 'success', modality: 'query', embedding: vector },
  indexSnapshot: index, textPath: 'stableTextEmbedding', textDataContract: contract };
}
function wireAtlas(rows) {
  Object.assign(env, { qaMultimodalFusionEnabled: true, qaVectorSearchMode: 'atlas', qaQueryEmbeddingProvider: 'gemini',
    geminiApiKey: 'fake-test-key', qaAtlasVectorIndexName: 'text_embedding_index', qaActiveLeafEmbeddingContractJson: JSON.stringify(contract) });
  global.fetch = async (url, ...args) => String(url).startsWith('https://generativelanguage.googleapis.com/')
    ? { ok: true, json: async () => ({ embedding: { values: vector } }) } : localFetch(url, ...args);
  VideoSegment.aggregate = async () => rows;
  const fixture = adapterFixture(rows);
  VideoSegment.collection.aggregate = p => p[0].$listSearchIndexes ? { toArray: async () => [index] }
    : p[0].$match ? { toArray: async () => rows } : fixture.collection.aggregate(p);
}
function scope(courseId = ids.publishedCourse) { return { courseId, allowedVideoIds: [ids.publishedVideo] }; }
const evidence = r => ({ ...r, courseId: ids.publishedCourse });
async function bridge(rows, { loadRows = rows, fallback = [], currentScope = scope(), ...extra } = {}) {
  return retrieveForQa({ scope: currentScope, settings: { enabled: true }, textSearch: async () => fallback,
    loadEvidence: async () => loadRows, searchers: { audio: async () => rows }, ...extra });
}
test('Q01 HTTP rejects unauthenticated ask', async () => {
  const r = await jsonRequest(server.baseUrl, '/api/v1/qa/ask', { method: 'POST', body: { courseId: ids.publishedCourse, question: 'JWT authentication' } });
  assert.equal(r.status, 401);
});
test('Q02 un-enrolled, revoked and draft are denied before model calls, even with injected scope', async () => {
  let providerCalls = 0;
  Object.assign(env, { qaMultimodalFusionEnabled: true, qaQueryEmbeddingProvider: 'gemini', geminiApiKey: 'fake-test-key' });
  global.fetch = async (url, ...args) => {
    if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
      providerCalls++; throw Error('Unauthorized ask must not reach provider');
    }
    return localFetch(url, ...args);
  };
  for (const variant of ['none', 'revoked', 'draft']) {
    resetStore(); const course = store.courses.find(c => c._id === ids.publishedCourse);
    if (variant === 'none') store.enrollments = store.enrollments.filter(e => e.courseId !== course._id);
    if (variant === 'revoked') store.enrollments.find(e => e.courseId === course._id).status = 'revoked';
    if (variant === 'draft') course.status = 'draft';
    const r = await ask(course._id, { allowedVideoIds: [ids.publishedVideo], scope: scope() });
    assert.equal(r.status, 403, variant); assert.equal(store.questions.length, 0);
    assert.equal(providerCalls, 0);
  }
});
test('Q03 missing/null Leaf courseId remains legal with flag off and on', async () => {
  for (const enabled of [false, true]) for (const value of [undefined, null]) {
    resetStore(); env.qaMultimodalFusionEnabled = enabled;
    for (const row of store.videoSegments) if (value === undefined) delete row.courseId; else row.courseId = value;
    const r = await ask(); assert.equal(r.status, 200); assert.ok(r.body.data.citations.length);
    assert.ok(r.body.data.citations.every(c => c.videoId === ids.publishedVideo));
  }
});
test('Q04 body scope/user injection cannot expand an enrolled B request to A', async () => {
  const b = publishB();
  for (const enabled of [false, true]) {
    env.qaMultimodalFusionEnabled = enabled;
    const r = await ask(b, { allowedVideoIds: [ids.publishedVideo], scope: scope(), user: { id: ids.admin, role: 'admin' } });
    assert.equal(r.status, 200); assert.ok(r.body.data.matches.length);
    assert.ok(r.body.data.matches.every(m => m.videoId === ids.teacherVideo));
  }
});
test('Q05 fake Atlas foreign, missing and alias videos cannot become QA citations', async () => {
  const rows = legalRows(); wireAtlas([...rows, { ...rows[0], chunkId: 'foreign', videoId: ids.teacherVideo },
    { ...rows[0], chunkId: 'alias', videoId: ids.publishedVideoExternal }, { ...rows[0], chunkId: 'missing', videoId: null }]);
  const r = await ask(); assert.equal(r.status, 200); assert.ok(r.body.data.citations.length);
  assert.ok(r.body.data.citations.every(c => c.videoId === ids.publishedVideo));
});
test('Q06 metadata-only mounted canonical video without courseId remains searchable', async () => {
  delete store.videos.find(v => v._id === ids.publishedVideo).courseId;
  for (const row of store.videoSegments) delete row.courseId;
  const r = await ask(); assert.equal(r.status, 200); assert.ok(r.body.data.citations.length);
});
test('Q07 empty resolved video scope returns no searchable segments without querying the world', async () => {
  store.courses.find(c => c._id === ids.publishedCourse).videoIds = [];
  store.videos = store.videos.filter(v => v._id !== ids.publishedVideo); store.videoSegments = []; store.videoSegmentVideos = [];
  const r = await ask(); assert.equal(r.status, 200); assert.equal(r.body.data.citations.length, 0);
  assert.equal(r.body.data.runtime.matchStatus, 'no_searchable_segments');
});
test('Q08 invalid FAQ evidence is discarded; revoked enrollment still denies cached answers', async () => {
  env.faqCacheEnabled = true;
  await saveFaqEntry({ courseId: ids.publishedCourse, question: 'JWT authentication', answer: 'STALE_FAQ_CONTROL',
    matches: [{ ...store.videoSegments[0], videoId: ids.teacherVideo, _answerEvidenceVersion: 'supporting-evidence-v1' }], clip: null, questionEmbedding: [] });
  const r = await ask(); assert.equal(r.status, 200); assert.notEqual(r.body.data.answer, 'STALE_FAQ_CONTROL');
  assert.ok(r.body.data.citations.length);
  const semanticQuestion = 'JWT authentication verification';
  const queryEmbedding = await require('../src/services/queryEmbedding.service').embedQuery(semanticQuestion);
  await saveFaqEntry({ courseId: ids.publishedCourse, question: 'semantic-cache-control', answer: 'STALE_SEMANTIC_FAQ_CONTROL',
    matches: [{ ...store.videoSegments[0], videoId: ids.teacherVideo, _answerEvidenceVersion: 'supporting-evidence-v1' }],
    clip: null, questionEmbedding: queryEmbedding });
  const similar = await ask(ids.publishedCourse, { question: semanticQuestion });
  assert.equal(similar.status, 200); assert.notEqual(similar.body.data.answer, 'STALE_SEMANTIC_FAQ_CONTROL');
  assert.ok(similar.body.data.citations.every(c => c.videoId === ids.publishedVideo));
  store.enrollments.find(e => e.courseId === ids.publishedCourse).status = 'revoked'; assert.equal((await ask()).status, 403);
});
test('Q09 student enrolled only in B can use its legally shared A video', async () => {
  const b = publishB({ shared: true });
  store.enrollments = store.enrollments.filter(e => e.courseId === b);
  for (const row of store.videoSegments) delete row.courseId;
  const r = await ask(b); assert.equal(r.status, 200); assert.ok(r.body.data.citations.length);
  assert.ok(r.body.data.citations.every(c => c.videoId === ids.publishedVideo));
});
test('Q10 owner/admin/legacy enrollment remain legal; other teacher is denied', async () => {
  for (const who of [ids.teacher, ids.admin, ids.student]) {
    const r = await ask(ids.publishedCourse, {}, who); assert.equal(r.status, 200, who);
  }
  assert.equal((await ask(ids.publishedCourse, {}, ids.otherTeacher)).status, 403);
  store.courses.find(c => c._id === ids.publishedCourse).status = 'draft';
  for (const who of [ids.teacher, ids.admin]) assert.equal((await ask(ids.publishedCourse, {}, who)).status, 200);
  assert.equal((await ask()).status, 403);
});
test('Q11 mentioning another course in question text cannot change the authorized scope', async () => {
  publishB();
  const r = await ask(ids.publishedCourse, { question: 'JWT authentication in Draft AI Course' });
  assert.equal(r.status, 200); assert.ok(r.body.data.citations.every(c => c.videoId === ids.publishedVideo));
});
test('A01 authorized missing/null source course normalizes to caller course', async () => {
  for (const courseId of [undefined, null]) {
    const row = { ...legalRows()[0], courseId };
    const r = await retrieveAtlasMultimodal({ ...adapterFixture([row]), scope: scope() });
    assert.equal(r.matches[0].courseId, ids.publishedCourse); assert.deepEqual(r.matches[0].retrievedBy, ['text', 'audio', 'visual']);
  }
});
test('A02 source course is provenance after Q5; authorized videos survive, foreign videos do not', async () => {
  const row = { ...legalRows()[0], courseId: ids.teacherCourse };
  const r = await retrieveAtlasMultimodal({ ...adapterFixture([row]), scope: scope() });
  assert.ok(r.matches.length); assert.equal(r.matches[0].courseId, ids.publishedCourse);
});
test('A03 matching courseId cannot authorize an unlisted video', async () => {
  const row = legalRows()[0];
  const r = await retrieveAtlasMultimodal({ ...adapterFixture([row, { ...row, chunkId: 'foreign', videoId: ids.teacherVideo }]), scope: scope() });
  assert.ok(r.matches.length); assert.ok(r.matches.every(r => r.videoId === ids.publishedVideo));
});
test('A04 malformed/empty scope fails before repository access', async () => {
  const f = adapterFixture(legalRows()); let calls = 0; f.collection.aggregate = () => { calls++; throw Error('unexpected'); };
  for (const s of [{}, { courseId: ids.publishedCourse, allowedVideoIds: [] }, { courseId: ids.publishedCourse, allowedVideoIds: 'alias' }]) {
    await assert.rejects(retrieveAtlasMultimodal({ ...f, scope: s }), TypeError);
  }
  assert.equal(calls, 0);
});
test('A05 forged internal scope is a caller-precondition observation, not a zero-result security test', async () => {
  const row = { ...legalRows()[0] }; delete row.courseId;
  const r = await retrieveAtlasMultimodal({ ...adapterFixture([row]), scope: scope(ids.teacherCourse) });
  assert.equal(r.matches[0].courseId, ids.teacherCourse); // Observation; Q02/Q04 test the real HTTP boundary.
});
test('A06 raw course filtering excludes missing-course rows even with the right course, so is not an ACL proof', () => {
  const row = { ...legalRows()[0] }; delete row.courseId;
  const positive = buildAtlasPipeline('text', vector, [row.videoId])[0].$vectorSearch.filter;
  assert.ok(positive.videoId.$in.includes(row.videoId));
  for (const course of [ids.publishedCourse, ids.teacherCourse]) {
    const filter = buildAtlasPipeline('text', vector, [row.videoId], 'embedding', 'text_embedding_index', course)[0].$vectorSearch.filter;
    assert.notEqual(row.courseId, filter.courseId);
  }
});
test('B01 bridge uses authorized loader transcript and preserves chunk timestamps', async () => {
  const row = evidence(legalRows()[0]); const r = await bridge([row]);
  assert.equal(r.matches[0].transcript, row.text); assert.equal(r.citations[0].startSec, row.startSec);
});
test('B02 bad video/chunk evidence is discarded while a legal fallback remains usable', async () => {
  const row = evidence(legalRows()[0]);
  for (const bad of [{ ...row, videoId: ids.teacherVideo }, { ...row, chunkId: 'wrong-id' }]) {
    const r = await bridge([bad], { loadRows: [row], fallback: [row] });
    assert.equal(r.matches[0].chunkId, row.chunkId);
    assert.equal(r.matches.some(m => m.chunkId === bad.chunkId && m.videoId === bad.videoId && m.chunkId !== row.chunkId), false);
  }
});
test('B03 shifted time/empty transcript cannot become evidence; fallback may be legal or empty', async () => {
  const row = evidence(legalRows()[0]);
  for (const bad of [{ ...row, endSec: row.endSec + 1 }, { ...row, text: '' }]) {
    const none = await bridge([row], { loadRows: [bad] }); assert.equal(none.matches.length, 0);
    const good = evidence(legalRows()[1]);
    const r = await bridge([row], { loadRows: [bad, good], fallback: [good] }); assert.equal(r.matches[0].chunkId, good.chunkId);
  }
});
test('B04 raw candidate missing required scope differs from QA-normalized evidence; no database backfill', async () => {
  const raw = { ...legalRows()[0] }; delete raw.courseId;
  assert.equal((await bridge([raw])).matches.length, 0);
  assert.ok((await bridge([evidence(raw)])).matches.length);
});
test('B05 consistent forged internal scope/loader is not independent authorization', async () => {
  const row = { ...legalRows()[0], courseId: ids.teacherCourse };
  assert.ok((await bridge([row], { currentScope: scope(ids.teacherCourse) })).matches.length);
});
for (const [id, leafCourse] of [['U01', true], ['U02', false]]) test(`${id} legal shared video reuses source-course vectors through real QA`, async () => {
  const b = publishB({ shared: true }); store.enrollments = store.enrollments.filter(e => e.courseId === b);
  const rows = legalRows();
  if (!leafCourse) for (const r of rows) delete r.courseId;
  for (const row of store.videoSegments) { row.chunkId ||= row.segmentId; if (!leafCourse) delete row.courseId; }
  wireAtlas(rows);
  const r = await ask(b); assert.equal(r.status, 200); assert.ok(r.body.data.citations.length);
  assert.equal(r.body.data.runtime.multimodal.usedFallback, false);
  assert.ok(r.body.data.citations.every(c => c.videoId === ids.publishedVideo && c.retrievedBy.includes('audio')));
});
test('U03 query scope uses canonical Video._id and no mandatory source-course filter', () => {
  const p = buildAtlasPipeline('text', vector, [ids.publishedVideo])[0].$vectorSearch.filter;
  assert.deepEqual(p, { videoId: { $in: [ids.publishedVideo] } }); assert.notEqual(ids.publishedVideo, ids.publishedVideoExternal);
});
});
