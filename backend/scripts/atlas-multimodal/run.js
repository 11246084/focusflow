const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { MongoClient, ObjectId, BSON } = require('mongodb');
const control = require('./control');
const { readAtlasIndex, retrieveAtlasMultimodal, buildAtlasPipeline } = require('../../src/services/atlasMultimodalAdapter.service');
const { buildGeminiTextSearchContract } = require('../../src/services/embeddingContract.service');
const ROOT = path.resolve(__dirname, '../../..');
function localPath(value) {
  const p = path.resolve(value);
  const base = path.join(ROOT, '.local-tools');
  if (!p.startsWith(base + path.sep)) throw new Error('Private output must be inside ignored .local-tools');
  return p;
}
function save(file, value, exclusive = false) {
  const p = localPath(file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, BSON.EJSON.stringify(value, { relaxed: false }), { flag: exclusive ? 'wx' : 'w', mode: 0o600 });
}
function load(file) { return BSON.EJSON.parse(fs.readFileSync(localPath(file), 'utf8'), { relaxed: true }); }
async function backup(db, collection, destination) {
  const documents = await collection.find({ videoId: { $in: control.VIDEO_IDS } },
    { maxTimeMS: 15000, promoteValues: false }).limit(5001).toArray();
  if (documents.length > 5000 || documents.length < 3) throw new Error('Backup scope invalid');
  const videos = await db.collection('videos').find({ _id: { $in: control.VIDEO_IDS.map(id => new ObjectId(id)) } },
    { projection: { _id: 1, courseId: 1, activeTranscriptVersion: 1 }, maxTimeMS: 15000 }).toArray();
  if (videos.length !== 6 || videos.some(v => String(v.courseId) !== control.COURSE_ID)) throw new Error('Course video relationship invalid');
  const index = await readAtlasIndex(collection);
  const snapshot = { schemaVersion: 'atlas_backup_v1', database: db.databaseName, collection: collection.collectionName,
    capturedAt: new Date().toISOString(), documents, videos, index };
  save(destination, { snapshot, checksum: control.hash(snapshot) }, true);
  // Re-read the durable backup before planning any future writes.
  return readBackup(destination);
}
function readBackup(file) {
  const raw = BSON.EJSON.parse(fs.readFileSync(localPath(file), 'utf8'), { relaxed: false });
  if (control.hash(raw.snapshot) !== raw.checksum) throw new Error('Backup checksum failed');
  return load(file).snapshot;
}
function subset(snapshot) {
  const documents = snapshot.documents.filter(d => control.IDS.includes(d.chunkId));
  return { ...snapshot, documents };
}
function sanitized(result) {
  // A strict allowlist prevents transcripts, raw vectors and future adapter fields leaking.
  return { source: result.source, indexName: result.indexName, diagnostics: result.diagnostics,
    k: result.k, weights: result.weights,
    lists: Object.fromEntries(Object.entries(result.lists || {}).map(([k, rows]) => [k, rows.map((r, i) => ({ rank: i + 1,
      chunkId: r.chunkId, videoId: r.videoId, startSec: r.startSec, endSec: r.endSec, score: r.score }))])),
    candidates: result.matches?.map(r => ({ chunkId: r.chunkId, videoId: r.videoId, courseId: r.courseId,
      startSec: r.startSec, endSec: r.endSec, fusionScore: r.fusionScore, retrievedBy: r.retrievedBy,
      channelRanks: r.channelRanks, channelScores: r.channelScores, contributions: r.contributions })) };
}
async function main() {
  const { values: v } = parseArgs({ options: {
    mode: { type: 'string', default: 'dry-run' }, strategy: { type: 'string', default: 'B' },
    'fusion-mode': { type: 'string', default: 'equal' },
    bundle: { type: 'string', default: path.join(ROOT, '.local-tools/atlas-preparation/bundle.json') },
    backup: { type: 'string' }, output: { type: 'string', default: path.join(ROOT, '.local-tools/atlas-preparation/report.json') },
    'execute-write': { type: 'boolean', default: false }, 'approve-plan': { type: 'string' },
  } });
  if (!['dry-run', 'search', 'baseline', 'index-plan', 'index-wait', 'rollback'].includes(v.mode)) throw new Error('Invalid mode');
  if (v['execute-write'] && !['dry-run', 'rollback'].includes(v.mode)) throw new Error('Invalid execution mode');
  const bundle = control.validateBundle(load(v.bundle));
  const env = require('../../src/config/env');
  if (env.videoSegmentCollection !== 'video_segments_text') throw new Error('Unexpected collection');
  const client = new MongoClient(env.mongodbUri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000,
    socketTimeoutMS: 20000, maxPoolSize: 1, retryReads: false, retryWrites: false, appName: 'focusflow-atlas-preparation' });
  try {
    await client.connect();
    const db = client.db();
    if (db.databaseName !== 'focusflow') throw new Error('Unexpected database');
    const collection = db.collection('video_segments_text');
    const info = await db.listCollections({ name: 'video_segments_text' }, { nameOnly: false, maxTimeMS: 15000 }).toArray();
    const validator = info[0]?.options?.validator || {};
    if (v['execute-write'] && Object.keys(validator).length) throw new Error('Collection validator requires separate review');
    const liveVideos = await db.collection('videos').find({ _id: { $in: control.VIDEO_IDS.map(id => new ObjectId(id)) } },
      { projection: { _id: 1, courseId: 1 }, maxTimeMS: 15000 }).toArray();
    if (liveVideos.length !== 6 || liveVideos.some(video => String(video.courseId) !== control.COURSE_ID)) throw new Error('Live course scope changed');
    if (v['execute-write'] && !v.backup) throw new Error('Execution requires a reviewed existing backup');
    const file = v.backup || path.join(ROOT, '.local-tools/atlas-preparation', `backup-${Date.now()}.json`);
    const snapshot = v.backup ? readBackup(file) : await backup(db, collection, file);
    const sample = subset(snapshot);
    const plans = control.planWrites(sample, bundle, v.strategy);
    const index = await readAtlasIndex(collection);
    const proposal = control.indexPlan(snapshot.index, v.strategy);
    const planHash = control.hash({ database: snapshot.database, collection: snapshot.collection, checksum: control.hash(sample),
      strategy: v.strategy, bundleHash: control.hash(bundle), index: proposal.afterHash });
    if (v['execute-write'] && v['approve-plan'] !== planHash) throw new Error('Explicit reviewed plan hash required');
    const report = { mode: v.mode, strategy: v.strategy, source: 'atlas', generatedAt: new Date().toISOString(),
      backup: file, backupDocuments: snapshot.documents.length, sampleDocuments: sample.documents.length, planHash,
      index: { name: index?.name, status: index?.status, queryable: index?.queryable, definition: index?.latestDefinition },
      proposal, collectionValidatorPresent: Object.keys(validator).length > 0,
      deploymentTier: 'unverified: requires Atlas management evidence', writes: 0, apiCalls: 0 };
    if (['dry-run', 'rollback'].includes(v.mode)) {
      const receipt = async results => save(v.output, { ...report, results, executionAuthorizedByFlag: v['execute-write'] });
      report.results = v.mode === 'rollback' ? await control.rollbackPlan(collection, plans, { execute: v['execute-write'] })
        : await control.applyPlan(collection, plans, { execute: v['execute-write'], receipt });
      report.writes = report.results.filter(r => ['verified', 'restored'].includes(r.status)).length;
    }
    if (v.mode === 'index-wait') await control.waitReady(() => readAtlasIndex(collection), proposal.after);
    if (v.mode === 'search') {
      report.queries = [];
      for (const query of bundle.records.filter(r => r.kind === 'query')) {
        const result = await retrieveAtlasMultimodal({ collection, queryEmbedding: { ...query.metadata, embedding: query.embedding },
          scope: { courseId: control.COURSE_ID, allowedVideoIds: control.VIDEO_IDS, allowedChunkIds: control.IDS },
          indexSnapshot: index, mode: v['fusion-mode'], textPath: v.strategy === 'B' ? 'stableTextEmbedding' : 'embedding',
          textDataContract: v.strategy === 'B' ? buildGeminiTextSearchContract() : null });
        report.queries.push({ queryId: query.requestId, ...sanitized(result) });
      }
    }
    if (v.mode === 'baseline') {
      if (index?.status !== 'READY' || !index.queryable) throw new Error('Legacy index not ready');
      report.baselineType = 'legacy document self-query, not semantic question evaluation';
      report.queries = [];
      for (const p of plans) {
        control.vectorDigest(p.before.embedding);
        const rows = await collection.aggregate(buildAtlasPipeline('text', p.before.embedding, control.VIDEO_IDS),
          { maxTimeMS: 10000, signal: AbortSignal.timeout(12000) }).toArray();
        if (rows.some(r => !control.VIDEO_IDS.includes(r.videoId) || (r.courseId != null && String(r.courseId) !== control.COURSE_ID))) throw new Error('Baseline scope violation');
        report.queries.push({ chunkId: p.chunkId, selfRank: rows.findIndex(r => r.chunkId === p.chunkId) + 1,
          ranked: rows.map((r, i) => ({ rank: i + 1, chunkId: r.chunkId, videoId: r.videoId, startSec: r.startSec, endSec: r.endSec, score: r.score })) });
      }
    }
    save(v.output, report);
    console.log(JSON.stringify({ mode: v.mode, output: localPath(v.output), backupDocuments: report.backupDocuments,
      indexStatus: index?.status, writes: report.writes, apiCalls: 0 }));
  } finally { await client.close(); }
}
if (require.main === module) main().catch(() => { console.error('Atlas preparation stopped; details redacted. No automatic retry or rollback.'); process.exitCode = 1; });
module.exports = { backup, readBackup, sanitized, localPath };
