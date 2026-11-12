// Local acceptance ONLY: production QA logic + memory harness + a read-only Atlas capability.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { validateScope, readManifest, sha, VIDEO_ID, COURSE_ID } = require('./video1-scope');
const { hash, vectorDigest } = require('./control');
const { localPath } = require('./run');
const { reciprocalRankFusion } = require('../../src/services/rankFusion.service');
const { buildGeminiTextSearchContract, buildGeminiSearchQueryText } = require('../../src/services/embeddingContract.service');
const PATHS = { stableTextEmbedding: 'text', audioEmbedding: 'audio', visualEmbedding: 'visual' };

function readonlyAtlas(collection, scope, query, audit) {
  // Export only aggregate; no DB/client/write method reaches the application.
  return { aggregate(pipeline, options) {
    assert.ok(Array.isArray(pipeline) && pipeline.length > 0);
    assert.ok(pipeline.every(stage => Object.keys(stage).every(k => ['$vectorSearch', '$project', '$match', '$limit', '$listSearchIndexes'].includes(k))), 'Forbidden aggregate stage');
    const first = pipeline[0];
    let channel;
    if (first.$vectorSearch) {
      const v = first.$vectorSearch; channel = PATHS[v.path];
      assert.ok(channel, 'Unexpected vector path'); assert.equal(v.index, 'text_embedding_index');
      assert.deepEqual(v.filter, { videoId: { $in: [VIDEO_ID] } });
      assert.equal(v.limit, 20); assert.equal(v.numCandidates, 100);
      vectorDigest(v.queryVector);
      assert.ok(v.queryVector.every((value, i) => Math.abs(value - query.embedding[i]) <= 1e-12),
        'Query differs beyond harmless provider normalization rounding');
    } else if (first.$match) {
      assert.deepEqual(first.$match.videoId, { $in: [VIDEO_ID] });
      assert.deepEqual(new Set(first.$match.chunkId.$in), new Set(scope.ids));
    } else assert.deepEqual(first, { $listSearchIndexes: { name: 'text_embedding_index' } });
    return { toArray: async () => {
      const rows = await collection.aggregate(pipeline, options).toArray();
      if (channel) audit.push({ channel, path: first.$vectorSearch.path, index: first.$vectorSearch.index,
        candidates: rows.map(r => ({ chunkId: r.chunkId, videoId: r.videoId, startSec: r.startSec, endSec: r.endSec,
          text: r.text?.trim(), score: r.score, mediaEmbeddingMeta: r.mediaEmbeddingMeta })) });
      return rows;
    } };
  } };
}

async function runAcceptance({ collection, scope, documents, video, query, evidenceSource = 'atlas-readonly' }) {
  validateScope(scope); vectorDigest(query.embedding);
  assert.equal(query.kind, 'query'); assert.ok(query.queryText?.trim(), 'Saved exact query text required');
  assert.equal(query.metadata.model, 'gemini-embedding-2');
  assert.equal(query.metadata.provider, 'gemini'); assert.equal(query.metadata.status, 'success');
  assert.equal(query.metadata.dimension, 3072);
  assert.equal(documents.length, 117);
  assert.deepEqual(new Set(documents.map(d => d.chunkId)), new Set(scope.ids));
  for (const d of documents) {
    const original = scope.chunks.find(c => c.chunkId === d.chunkId);
    assert.equal(d.videoId, VIDEO_ID);
    for (const k of ['text', 'startSec', 'endSec']) assert.equal(d[k], original[k], 'Live source changed');
  }
  assert.equal(String(video._id), VIDEO_ID);
  assert.equal(String(video.courseId), COURSE_ID);
  // Harness is loaded only here, never in production runtime or a server startup path.
  const h = require('../../tests/helpers/backendTestHarness');
  const mongoose = require('mongoose');
  const Segment = require('../../src/models/videoSegment.model');
  const readiness = require('../../src/services/multimodalReadiness.service');
  const originals = { fetch: global.fetch, aggregate: Segment.collection.aggregate, modelAggregate: Segment.aggregate,
    connect: mongoose.connect, openUri: mongoose.connection.openUri, env: { ...h.env } };
  const audit = [];
  let server;
  try {
    mongoose.connect = mongoose.connection.openUri = () => { throw new Error('Mongoose connections forbidden in acceptance'); };
    h.resetStore(); readiness.clearMultimodalIndexCache();
    const course = h.store.courses.find(c => c._id === h.ids.publishedCourse);
    course.title = 'LOCAL V1 acceptance scope — not the six-video course'; course.videoIds = [VIDEO_ID];
    const templateVideo = h.store.videos.find(v => v._id === h.ids.publishedVideo);
    h.store.videos.splice(0, h.store.videos.length, { ...templateVideo, ...video, _id: VIDEO_ID,
      courseId: COURSE_ID, status: 'active', uploadedBy: h.ids.teacher });
    h.store.videoSegments.splice(0, h.store.videoSegments.length, ...documents.map(d => ({ ...d,
      _id: String(d._id), videoId: VIDEO_ID, segmentId: d.segmentId || d.chunkId })));
    h.store.clips.length = 0;
    Object.assign(h.env, { qaMultimodalFusionEnabled: true, qaVectorSearchMode: 'atlas', qaQueryEmbeddingProvider: 'gemini',
      qaAnswerProvider: 'template', geminiApiKey: 'local-replay-no-credential', geminiEmbeddingModelName: 'gemini-embedding-2',
      faqCacheEnabled: false, qaVisualRetrievalEnabled: false, hierarchicalRetrievalEnabled: false,
      qaAtlasVectorIndexName: 'text_embedding_index', qaActiveLeafEmbeddingContractJson: JSON.stringify(buildGeminiTextSearchContract()) });
    const expectedContent = buildGeminiSearchQueryText(query.queryText);
    let queryReplays = 0;
    global.fetch = async (url, options) => {
      if (String(url) === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent') {
        const body = JSON.parse(options.body);
        assert.equal(body.content.parts[0].text, expectedContent, 'Cannot replay another question');
        assert.equal(body.output_dimensionality, 3072); queryReplays++;
        return { ok: true, json: async () => ({ embedding: { values: query.embedding } }) };
      }
      // The existing harness allows loopback HTTP only; all other provider calls throw.
      return originals.fetch(url, options);
    };
    Segment.collection.aggregate = readonlyAtlas(collection, scope, query, audit).aggregate;
    Segment.aggregate = async () => { throw new Error('Legacy text fallback is not acceptance success'); };
    server = await h.startServer();
    const token = await h.loginAs(server.baseUrl, 'student@focusflow.local', 'Student123!');
    const response = await h.jsonRequest(server.baseUrl, '/api/v1/qa/ask', { method: 'POST', token,
      body: { courseId: course._id, question: query.queryText } });
    assert.equal(response.status, 200, JSON.stringify(response.body.error));
    const result = response.body.data, runtime = result.runtime.multimodal;
    assert.equal(queryReplays, 1);
    assert.equal(runtime.usedFallback, false);
    assert.ok(!['hierarchy', 'scoped_text_search'].includes(runtime.channels.textSource));
    assert.deepEqual(new Set(audit.map(a => a.channel)), new Set(['text', 'audio', 'visual']));
    assert.equal(audit.length, 3);
    for (const a of audit) assert.ok(a.candidates.length > 0, `No ${a.channel} candidates`);
    assert.equal(runtime.channels.stableTextCoverage.complete, true);
    assert.equal(runtime.channels.stableTextCoverage.covered, 117);
    const lists = Object.fromEntries(audit.map(a => [a.channel, a.candidates.map(c => ({ ...c, courseId: course._id }))]));
    const fused = reciprocalRankFusion(lists);
    assert.ok(result.matches.length && result.citations.length);
    for (const [i, match] of result.matches.entries()) {
      assert.equal(match.chunkId, fused[i].chunkId, 'QA rank differs from independently recomputed RRF');
      assert.deepEqual(match.channelRanks, fused[i].channelRanks);
      assert.ok(Math.abs(match.fusionScore - fused[i].fusionScore) < 1e-12);
    }
    for (const citation of result.citations) {
      const original = documents.find(d => d.chunkId === citation.chunkId);
      assert.ok(original); assert.equal(citation.videoId, VIDEO_ID);
      assert.equal(citation.timestamp.startSec, original.startSec);
      assert.equal(citation.timestamp.endSec, original.endSec);
    }
    const created = await h.jsonRequest(server.baseUrl, '/api/v1/conversations', { method: 'POST', token,
      body: { courseId: course._id } });
    assert.equal(created.status, 201);
    const conversation = await h.jsonRequest(server.baseUrl, `/api/v1/conversations/${created.body.data.id}/messages`, {
      method: 'POST', token, body: { content: query.queryText } });
    assert.equal(conversation.status, 201); assert.equal(conversation.body.data.failed, false);
    assert.equal(conversation.body.data.runtime.multimodal.usedFallback, false);
    assert.ok(!conversation.body.data.runtime.multimodal.channels.textSource);
    assert.equal(audit.length, 6); assert.equal(queryReplays, 2);
    assert.equal(h.store.messages.length, 2); assert.equal(h.store.conversations.length, 1);
    const beforeDenied = audit.length;
    h.store.enrollments.length = 0;
    const denied = await h.jsonRequest(server.baseUrl, '/api/v1/qa/ask', { method: 'POST', token,
      body: { courseId: course._id, question: query.queryText } });
    assert.equal(denied.status, 403); assert.equal(audit.length, beforeDenied);
    return { status: 'passed', evidenceSource, answerProvider: 'existing-template', answerQualityVerified: false,
      scope: { kind: 'local-memory-legitimate-mount', videoIds: [VIDEO_ID], chunks: 117, originalCourseComplete: false },
      source: { videoId: VIDEO_ID, sourceUrl: video.sourceUrl || video.video_url || null },
      queryReplays, paidCalls: 0, atlasWrites: 0, stateSink: 'existing-harness-memory',
      memoryWrites: Object.fromEntries(['conversations', 'messages', 'faqs', 'usageLogs', 'questions'].map(k => [k, h.store[k].length])),
      conversationEvidence: { status: 'passed', channels: audit.slice(3).map(a => a.channel), persistedInMemoryMessages: h.store.messages.length },
      channels: audit.slice(0, 3).map(a => ({ channel: a.channel, path: a.path, index: a.index,
        candidates: a.candidates.map(({ text, mediaEmbeddingMeta, ...r }, i) => ({ rank: i + 1, ...r })) })),
      rrf: { k: 60, weights: { text: 1, audio: 1, visual: 1 }, matches: fused.map(({ text, mediaEmbeddingMeta, ...r }) => r) },
      citations: result.citations, authorizationNegativeControl: 'passed', usedFallback: runtime.usedFallback };
  } finally {
    if (server) await h.stopServer(server.server);
    Segment.collection.aggregate = originals.aggregate; Segment.aggregate = originals.modelAggregate;
    global.fetch = originals.fetch; mongoose.connect = originals.connect; mongoose.connection.openUri = originals.openUri;
    Object.assign(h.env, originals.env); readiness.clearMultimodalIndexCache();
  }
}

async function main() {
  const { values: v } = parseArgs({ options: { manifest: { type: 'string' }, 'approve-manifest': { type: 'string' },
    'query-bundle': { type: 'string' }, 'approve-query-bundle': { type: 'string' }, 'query-id': { type: 'string' }, output: { type: 'string' } } });
  const scope = readManifest(localPath(v.manifest), v['approve-manifest']);
  const bytes = fs.readFileSync(localPath(v['query-bundle']));
  assert.equal(sha(bytes), v['approve-query-bundle']);
  const query = JSON.parse(bytes).records.find(r => r.kind === 'query' && r.identity.chunkId === v['query-id']);
  assert.ok(query && scope.ids.includes(query.identity.chunkId));
  const env = require('../../src/config/env');
  const { MongoClient, ObjectId } = require('mongodb');
  const client = new MongoClient(env.mongodbUri, { retryWrites: false, serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect(); const db = client.db('focusflow'), collection = db.collection('video_segments_text');
    const documents = await collection.find({ videoId: VIDEO_ID }, { maxTimeMS: 15000 }).limit(118).toArray();
    const video = await db.collection('videos').findOne({ _id: new ObjectId(VIDEO_ID) }, { maxTimeMS: 15000 });
    const report = await runAcceptance({ collection, scope, documents, video, query });
    fs.writeFileSync(localPath(v.output), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, paidCalls: 0, atlasWrites: 0, answerQualityVerified: false }));
  } finally { await client.close(); }
}
if (require.main === module) main().catch(() => { console.error('V1 QA acceptance stopped; details redacted; no provider calls or Atlas writes permitted.'); process.exitCode = 1; });
module.exports = { readonlyAtlas, runAcceptance };
