// Preparation and read-only search only. This CLI intentionally exposes no Atlas write operation.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { MongoClient, BSON, ObjectId } = require('mongodb');
const c = require('./control');
const { localPath, sanitized } = require('./run');
const { readAtlasIndex, retrieveAtlasMultimodal, ISOLATED_INDEX_NAME } = require('../../src/services/atlasMultimodalAdapter.service');
const { buildGeminiTextSearchContract } = require('../../src/services/embeddingContract.service');
const { reciprocalRankFusion } = require('../../src/services/rankFusion.service');
const TARGET = 'multimodal_sample_3_validation';
const OWNER = 'focusflow_multimodal_phase5_v1';
const DEFINITION = { fields: [...Object.values(c.PATHS).map(path => ({ type: 'vector', path, numDimensions: 3072, similarity: 'cosine' })),
  ...['courseId', 'videoId'].map(path => ({ type: 'filter', path }))] };
const OUT = path.resolve(__dirname, '../../../.local-tools/atlas-isolated');
function write(file, value, exclusive = false) {
  file = localPath(file); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, BSON.EJSON.stringify(value, { relaxed: false }), { flag: exclusive ? 'wx' : 'w', mode: 0o600 });
}
function read(file) { return BSON.EJSON.parse(fs.readFileSync(localPath(file), 'utf8')); }
function buildDocuments(bundle) {
  c.validateBundle(bundle);
  return c.IDS.map(chunkId => {
    const text = bundle.records.find(r => r.kind === 'text' && r.identity.chunkId === chunkId);
    const doc = { _id: chunkId, ...text.identity, text: text.text, validationOwner: OWNER, mediaEmbeddingMeta: {} };
    for (const kind of Object.keys(c.PATHS)) {
      const r = bundle.records.find(r => r.kind === kind && r.identity.chunkId === chunkId);
      if (c.hash(r.identity) !== c.hash(text.identity)) throw new Error('Cross-modal identity conflict');
      doc[c.PATHS[kind]] = r.embedding;
      doc.mediaEmbeddingMeta[kind] = { ...r.metadata, vectorDigest: r.vectorDigest };
    }
    return doc;
  });
}
function validateTargetRows(rows, expected) {
  if (rows.length !== 3 || c.hash([...rows].sort((a, b) => a.chunkId.localeCompare(b.chunkId)))
    !== c.hash([...expected].sort((a, b) => a.chunkId.localeCompare(b.chunkId)))) throw new Error('Isolated target differs from reviewed three documents');
}
function permissions(privileges) {
  const actions = ['find', 'insert', 'remove', 'createCollection', 'createSearchIndexes', 'listSearchIndexes', 'dropSearchIndex', 'dropCollection'];
  return Object.fromEntries(actions.map(action => [action, privileges.some(p =>
    (p.resource?.anyResource === true || (['', 'focusflow'].includes(p.resource?.db) && ['', TARGET].includes(p.resource?.collection)))
    && (p.actions?.includes(action) || p.actions?.includes('anyAction'))) ]));
}
async function inspect(db) {
  const collections = await db.listCollections({}, { nameOnly: true, maxTimeMS: 15000 }).toArray();
  if (collections.length > 100) throw new Error('Metadata scope unexpectedly large');
  const inventory = [];
  let errors = 0;
  for (const item of collections) {
    try {
      const indexes = await db.collection(item.name).aggregate([{ $listSearchIndexes: {} }], { maxTimeMS: 10000 }).toArray();
      for (const index of indexes) inventory.push({ collection: item.name, name: index.name, type: index.type, status: index.status, queryable: index.queryable });
    } catch { errors++; }
  }
  let privileges = { status: 'unavailable' };
  try {
    const status = await db.command({ connectionStatus: 1, showPrivileges: true });
    privileges = { status: 'verified_from_authenticated_privileges', actions: permissions(status.authInfo?.authenticatedUserPrivileges || []) };
  } catch { /* Never log authentication identities or raw server errors. */ }
  let stats = { status: 'unavailable' };
  try {
    const s = await db.command({ dbStats: 1, scale: 1, maxTimeMS: 15000 });
    stats = { status: 'verified', dataSize: s.dataSize, storageSize: s.storageSize, indexSize: s.indexSize, collections: s.collections };
  } catch { /* Deployment tier and remaining quota cannot be inferred from dbStats. */ }
  return { targetExists: collections.some(v => v.name === TARGET), collectionCount: collections.length,
    currentDatabaseSearchIndexes: inventory, inventoryErrors: errors, privileges, stats,
    quotaScope: 'current database only, not cluster-wide', deploymentTier: 'unverified',
    remainingSearchIndexQuota: 'unverified', resourceCost: 'unverified; no automatic tier upgrades',
    writes: 0, indexChanges: 0 };
}
async function verifySource(db, documents) {
  const rows = await db.collection('video_segments_text').find({ chunkId: { $in: c.IDS } }, { maxTimeMS: 15000 }).limit(4).toArray();
  if (rows.length !== 3 || new Set(rows.map(r => r.chunkId)).size !== 3) throw new Error('Source count changed');
  const videos = await db.collection('videos').find({ _id: { $in: [...new Set(documents.map(d => d.videoId))].map(id => new ObjectId(id)) } },
    { projection: { _id: 1, courseId: 1 }, maxTimeMS: 15000 }).toArray();
  for (const doc of documents) {
    const row = rows.find(r => r.chunkId === doc.chunkId);
    const video = videos.find(v => String(v._id) === doc.videoId);
    if (!video || String(video.courseId) !== doc.courseId || row.videoId !== doc.videoId || row.text !== doc.text
      || row.startSec !== doc.startSec || row.endSec !== doc.endSec
      || (row.courseId != null && String(row.courseId) !== doc.courseId)) throw new Error('Source identity conflict');
  }
  return rows;
}
function localComparison(query, documents, atlas) {
  const local = {};
  const differences = {};
  for (const [kind, field] of Object.entries(c.PATHS)) {
    local[kind] = documents.map(d => ({ courseId: d.courseId, videoId: d.videoId, chunkId: d.chunkId,
      startSec: d.startSec, endSec: d.endSec, text: d.text,
      score: (1 + d[field].reduce((s, v, i) => s + v * query.embedding[i], 0)) / 2 })).sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
    differences[kind] = (atlas.lists[kind] || []).map((r, i) => ({ chunkId: r.chunkId, atlasRank: i + 1,
      localRank: local[kind].findIndex(v => v.chunkId === r.chunkId) + 1,
      scoreDelta: r.score - local[kind].find(v => v.chunkId === r.chunkId).score }));
  }
  return { source: 'local cosine computation, not Atlas', differences,
    equal: reciprocalRankFusion(local).map(r => ({ chunkId: r.chunkId, fusionScore: r.fusionScore })),
    textWeighted: reciprocalRankFusion(local, { weights: { text: 2, audio: 1, visual: 1 } }).map(r => ({ chunkId: r.chunkId, fusionScore: r.fusionScore })) };
}
// Pure rehearsal of exact-document restore. Any unexpected document or concurrent edit stops cleanup.
function restorePlan(before, current, expected, { allowPartial = false } = {}) {
  if (before.existed) throw new Error('Existing target is not owned by this validation');
  if (allowPartial) {
    if (current.length > 3 || new Set(current.map(d => d.chunkId)).size !== current.length
      || current.some(d => !c.IDS.includes(d.chunkId) || c.hash(d) !== c.hash(expected.find(e => e.chunkId === d.chunkId)))) throw new Error('Partial restore conflict');
  } else validateTargetRows(current, expected);
  if (current.some(d => d.validationOwner !== OWNER)) throw new Error('Ownership conflict');
  return { collection: TARGET, index: ISOLATED_INDEX_NAME, dropIndexFirst: true,
    documentDeletes: current.map(d => ({ _id: d._id, expectedHash: c.hash(d) })),
    dropCollectionOnlyIfEmptyAndNoUnexpectedIndexes: true };
}
function rehearseRestore(before, expected) {
  const current = BSON.EJSON.parse(BSON.EJSON.stringify(expected));
  const plan = restorePlan(before, current, expected);
  let index = structuredClone(DEFINITION);
  if (c.hash(index) !== c.hash(DEFINITION)) throw new Error('Unexpected index');
  index = null;
  const remaining = current.filter(d => !plan.documentDeletes.some(p => p._id === d._id && p.expectedHash === c.hash(d)));
  if (index !== null || remaining.length) throw new Error('Local cleanup rehearsal failed');
  return { source: 'local simulation, not Atlas restore', plan, after: { existed: false, documents: remaining, index }, verified: true };
}
async function search(db, bundle, documents) {
  const collection = db.collection(TARGET);
  const rows = await collection.find({}, { maxTimeMS: 15000 }).limit(4).toArray();
  validateTargetRows(rows, documents);
  const index = await readAtlasIndex(collection, ISOLATED_INDEX_NAME);
  if (!index || c.hash(index.latestDefinition) !== c.hash(DEFINITION) || index.status !== 'READY' || index.queryable !== true) throw new Error('Isolated index not ready or definition differs');
  const queries = [];
  for (const query of bundle.records.filter(r => r.kind === 'query')) {
    const args = { collection, queryEmbedding: { ...query.metadata, embedding: query.embedding },
      scope: { courseId: c.COURSE_ID, allowedVideoIds: [...new Set(documents.map(d => d.videoId))], allowedChunkIds: c.IDS },
      indexSnapshot: index, indexName: ISOLATED_INDEX_NAME, textPath: 'stableTextEmbedding', textDataContract: buildGeminiTextSearchContract() };
    const equal = await retrieveAtlasMultimodal(args);
    if (Object.values(equal.diagnostics).some(d => d.status !== 'success' || d.count !== 3)) throw new Error('Not all three channels returned three candidates');
    // Fuse the same observed Atlas candidates in both locked modes without repeating queries.
    const weighted = { ...equal, weights: { text: 2, audio: 1, visual: 1 }, matches: reciprocalRankFusion(equal.lists, { weights: { text: 2, audio: 1, visual: 1 } }) };
    queries.push({ queryId: query.requestId, equal: sanitized(equal), textWeighted: sanitized(weighted), local: localComparison(query, documents, equal) });
  }
  // Negative scope probes require zero candidates, not silently discarded evidence.
  const query = bundle.records.find(r => r.kind === 'query');
  const { buildAtlasPipeline } = require('../../src/services/atlasMultimodalAdapter.service');
  const probes = [];
  for (const kind of Object.keys(c.PATHS)) for (const invalid of ['course', 'video']) {
    const pipeline = buildAtlasPipeline(kind, query.embedding, invalid === 'video' ? ['unauthorized-video'] : documents.map(d => d.videoId),
      'stableTextEmbedding', ISOLATED_INDEX_NAME, invalid === 'course' ? 'unauthorized-course' : c.COURSE_ID);
    const result = await collection.aggregate(pipeline, { maxTimeMS: 10000 }).toArray();
    if (result.length) throw new Error('Course/video isolation failed');
    probes.push({ kind, invalidScope: invalid, count: result.length });
  }
  return { source: 'real Atlas', index: { name: index.name, id: index.id, definitionHash: c.hash(index.latestDefinition), status: index.status }, queries, probes };
}
async function main() {
  const { values: v } = parseArgs({ options: { mode: { type: 'string', default: 'preflight' },
    bundle: { type: 'string', default: path.resolve(OUT, '../atlas-preparation/bundle.json') },
    output: { type: 'string', default: path.join(OUT, 'preflight.json') } } });
  if (!['preflight', 'search'].includes(v.mode)) throw new Error('Only read-only modes supported');
  const bundle = c.validateBundle(read(v.bundle));
  const documents = buildDocuments(bundle);
  const env = require('../../src/config/env');
  const client = new MongoClient(env.mongodbUri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000,
    socketTimeoutMS: 20000, maxPoolSize: 1, retryReads: false, retryWrites: false, appName: 'focusflow-isolated-preflight' });
  try {
    await client.connect(); const db = client.db();
    if (db.databaseName !== 'focusflow') throw new Error('Wrong database');
    const source = await verifySource(db, documents);
    const report = { capturedAt: new Date().toISOString(), mode: v.mode, database: db.databaseName,
      targetCollection: TARGET, targetIndex: ISOLATED_INDEX_NAME, definition: DEFINITION, documents: documents.map(d => ({
        chunkId: d.chunkId, videoId: d.videoId, courseId: d.courseId, startSec: d.startSec, endSec: d.endSec, digest: c.hash(d) })),
      plannedDocumentBytes: BSON.calculateObjectSize({ documents }), apiCalls: 0, writes: 0, indexChanges: 0 };
    if (v.mode === 'preflight') {
      report.inspection = await inspect(db);
      if (report.inspection.targetExists) throw new Error('Target collection already exists; stop');
      const snapshot = { existed: false, database: db.databaseName, collection: TARGET, index: null, documents: [] };
      const backup = { snapshot, checksum: c.hash(snapshot), source, sourceChecksum: c.hash(source) };
      const file = path.join(OUT, `backup-${Date.now()}.json`);
      write(file, backup, true);
      const restored = read(file);
      if (c.hash(restored.snapshot) !== backup.checksum || c.hash(restored.source) !== backup.sourceChecksum) throw new Error('Backup round-trip failed');
      report.backup = file;
      report.restoreRehearsal = rehearseRestore(restored.snapshot, documents);
      write(path.join(OUT, 'payload.json'), { owner: OWNER, database: db.databaseName, collection: TARGET, index: ISOLATED_INDEX_NAME, definition: DEFINITION, documents });
      report.payloadHash = c.hash({ database: db.databaseName, collection: TARGET, index: ISOLATED_INDEX_NAME, definition: DEFINITION, documents });
      report.blockers = ['Explicit Atlas write/index/cleanup authorization', 'Current cluster tier, cluster-wide remaining index quota and resource cost confirmation'];
      report.freeTierFeasibility = report.inspection.currentDatabaseSearchIndexes.length >= 3
        ? 'blocked if deployment is Free: at least three existing indexes already consume its quota'
        : 'unverified: current-database inventory does not establish cluster-wide headroom';
    } else report.search = await search(db, bundle, documents);
    write(v.output, report);
    console.log(JSON.stringify({ output: localPath(v.output), mode: v.mode, writes: 0, indexChanges: 0, apiCalls: 0 }));
  } finally { await client.close(); }
}
if (require.main === module) main().catch(() => { console.error('Isolated preflight stopped; details redacted. No Atlas writes performed.'); process.exitCode = 1; });
module.exports = { TARGET, OWNER, DEFINITION, buildDocuments, validateTargetRows, permissions, restorePlan, rehearseRestore, localComparison, inspect, search };
