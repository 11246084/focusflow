const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { MongoClient, ObjectId } = require('mongodb');
const { buildGeminiTextSearchContract, compareEmbeddingContracts, parseActiveEmbeddingContract } = require('../../src/services/embeddingContract.service');

const COURSE_ID = '6a6da68456dd124511ec5196';
const VIDEO_IDS = ['6a6da68e56dd124511ec51b4', '6a6da69056dd124511ec51bf', '6a6da69156dd124511ec51ca',
  '6a6da69256dd124511ec51d5', '6a6da69356dd124511ec51e0', '6a6da69556dd124511ec51eb'];
const MAX_ROWS = 5000;
const QUERY_MS = 15000;
const META_FIELDS = ['embeddingProvider', 'embeddingModel', 'embeddingDimension', 'embeddingTaskType',
  'embeddingInstructionVersion', 'generationVersion', 'normalizationVersion', 'embeddingContractVersion',
  'embeddingSchemaVersion', 'transcriptVersion', 'chunkingVersion', 'createdAt', 'updatedAt', 'embeddingTimestamp'];
const LEGACY_META_FIELDS = ['embedding_model', 'embedding_provider', 'embedding_dim', 'embedding_contract_version',
  'embedding_timestamp', 'embedding_normalization_version'];

function vectorSummary(field) {
  const array = { $cond: [{ $isArray: `$${field}` }, `$${field}`, []] };
  const valid = { $filter: { input: array, as: 'n', cond: { $cond: [{ $isNumber: '$$n' },
    { $and: [{ $gte: ['$$n', -1e100] }, { $lte: ['$$n', 1e100] }] }, false] } } };
  return {
    type: { $type: `$${field}` }, dimension: { $size: array }, validNumbers: { $size: valid },
    squaredNorm: { $reduce: { input: valid, initialValue: 0, in: { $add: ['$$value', { $multiply: ['$$this', '$$this'] }] } } },
  };
}

function chunkProjection() {
  return { _id: 0, chunkId: 1, segmentId: 1, videoId: 1, courseId: 1, startSec: 1, endSec: 1,
    fieldNames: { $map: { input: { $objectToArray: '$$ROOT' }, as: 'entry', in: '$$entry.k' } },
    legacyChunkId: '$chunk_id', legacyVideoId: '$video_id', legacyStartSec: '$start_sec', legacyEndSec: '$end_sec',
    textPresent: { $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$text' }, 'string'] }, '$text', ''] } }, 0] },
    ...Object.fromEntries(META_FIELDS.map((field) => [field, 1])),
    ...Object.fromEntries(LEGACY_META_FIELDS.map((field) => [field, 1])),
    textVector: vectorSummary('embedding'), audioVector: vectorSummary('audioEmbedding'),
    visualVector: vectorSummary('visualEmbedding') };
}

function safeLabel(value) {
  if (value === undefined || value === null) return '<missing>';
  const label = String(value);
  return /^[\w. :\-]{1,120}$/.test(label) ? label : '<unrecognized>';
}

function frequencies(rows, field) {
  const result = Object.create(null);
  for (const row of rows) {
    const key = safeLabel(row[field]);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function summarizeChunks(rows, videos, parents) {
  const expected = buildGeminiTextSearchContract();
  const known = new Map(videos.map((video) => [String(video._id), video]));
  const seen = new Set();
  let duplicateIds = 0;
  let invalidTimes = 0;
  let outOfVideo = 0;
  let invalidIds = 0;
  let missingVideo = 0;
  let missingText = 0;
  let incompatible = 0;
  let incompleteMetadata = 0;
  let malformedVectors = 0;
  const mismatches = {};
  const versions = {};
  const byVideo = Object.create(null);
  for (const row of rows) {
    const videoId = String(row.videoId || '');
    const key = JSON.stringify([videoId, row.chunkId]);
    if (seen.has(key)) duplicateIds += 1;
    seen.add(key);
    const video = known.get(videoId);
    if (!video) missingVideo += 1;
    if (typeof row.chunkId !== 'string' || !row.chunkId.startsWith(`${videoId}_chunk_`)
      || !/^.+_chunk_\d{4,}$/.test(row.chunkId)) invalidIds += 1;
    const validTime = Number.isFinite(row.startSec) && Number.isFinite(row.endSec)
      && row.startSec >= 0 && row.endSec > row.startSec;
    if (!validTime) invalidTimes += 1;
    if (validTime && Number.isFinite(video?.durationSec) && row.endSec > video.durationSec + 0.1) outOfVideo += 1;
    if (!row.textPresent) missingText += 1;
    const active = parseActiveEmbeddingContract(JSON.stringify(row), 'atlas_metadata');
    const mismatch = compareEmbeddingContracts(expected, active.contract);
    const required = ['embeddingProvider', 'embeddingModel', 'embeddingDimension', 'embeddingInstructionVersion',
      'generationVersion', 'normalizationVersion', 'embeddingContractVersion', 'embeddingSchemaVersion'];
    const incomplete = required.some((field) => row[field] == null);
    if (incomplete) incompleteMetadata += 1;
    if (mismatch.some((field) => active.contract[field] != null)) incompatible += 1;
    for (const field of mismatch) mismatches[field] = (mismatches[field] || 0) + 1;
    const vector = row.textVector;
    if (vector?.type !== 'array' || vector.dimension !== 3072 || vector.validNumbers !== 3072
      || !Number.isFinite(vector.squaredNorm) || vector.squaredNorm <= 0) malformedVectors += 1;
    const bucket = byVideo[safeLabel(videoId)] ||= { count: 0, shortUnder8: 0, longOver60: 0,
      minStartSec: null, maxEndSec: null, minDurationSec: null, maxDurationSec: null,
      audioVectors: 0, visualVectors: 0, unitTextVectors: 0 };
    bucket.count += 1;
    if (validTime) {
      const seconds = row.endSec - row.startSec;
      bucket.minDurationSec = Math.min(bucket.minDurationSec ?? seconds, seconds);
      bucket.maxDurationSec = Math.max(bucket.maxDurationSec ?? seconds, seconds);
      if (seconds < 8) bucket.shortUnder8 += 1;
      if (seconds > 60) bucket.longOver60 += 1;
      bucket.minStartSec = Math.min(bucket.minStartSec ?? row.startSec, row.startSec);
      bucket.maxEndSec = Math.max(bucket.maxEndSec ?? row.endSec, row.endSec);
    }
    if (row.audioVector?.dimension > 0) bucket.audioVectors += 1;
    if (row.visualVector?.dimension > 0) bucket.visualVectors += 1;
    if (Math.abs((vector?.squaredNorm ?? 0) - 1) < 0.001) bucket.unitTextVectors += 1;
    const versionKey = `${safeLabel(videoId)}:${safeLabel(row.transcriptVersion)}`;
    versions[versionKey] = (versions[versionKey] || 0) + 1;
  }
  const leafKeys = new Set(rows.map((row) => JSON.stringify([String(row.videoId), row.chunkId])));
  for (const [videoId, bucket] of Object.entries(byVideo)) {
    const ordered = rows.filter((row) => row.videoId === videoId && Number.isFinite(row.startSec) && Number.isFinite(row.endSec))
      .sort((a, b) => a.startSec - b.startSec);
    bucket.overlappingAdjacentRanges = 0;
    bucket.nonIncreasingChunkNumbers = 0;
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].startSec < ordered[index - 1].endSec - 0.001) bucket.overlappingAdjacentRanges += 1;
      const current = Number(String(ordered[index].chunkId).split('_chunk_')[1]);
      const previous = Number(String(ordered[index - 1].chunkId).split('_chunk_')[1]);
      if (Number.isFinite(current) && current <= previous) bucket.nonIncreasingChunkNumbers += 1;
    }
  }
  let brokenParentReferences = 0;
  for (const parent of parents) {
    for (const id of parent.childChunkIds || []) {
      if (!leafKeys.has(JSON.stringify([String(parent.videoId), id]))) brokenParentReferences += 1;
    }
  }
  return { inspected: rows.length, truncated: rows.length > MAX_ROWS, byVideo, duplicateIds, invalidTimes,
    outOfVideo, invalidIds, missingVideo, missingText, malformedVectors, incompatibleDeclaredMetadata: incompatible,
    incompleteMetadata,
    contractMismatches: mismatches, transcriptVersions: versions,
    metadata: Object.fromEntries([...META_FIELDS, ...LEGACY_META_FIELDS].map((field) => [field, frequencies(rows, field)])),
    storedFields: [...new Set(rows.flatMap((row) => row.fieldNames || []).map(safeLabel))].sort(),
    dimensions: frequencies(rows.map((row) => ({ dimension: row.textVector?.dimension })), 'dimension'),
    parentCount: parents.length, parentTruncated: parents.length > MAX_ROWS, brokenParentReferences,
    parentReferencedLeaves: new Set(parents.flatMap((parent) => (parent.childChunkIds || [])
      .map((id) => JSON.stringify([String(parent.videoId), id])))).size,
    parents: parents.slice(0, 10).map((parent) => ({ parentId: safeLabel(parent.parentId), videoId: safeLabel(parent.videoId),
      isActive: parent.isActive ?? null, childCount: parent.childChunkIds?.length ?? 0,
      startSec: parent.startSec ?? null, endSec: parent.endSec ?? null })),
    sample: rows.slice().sort((a, b) => String(a.videoId).localeCompare(String(b.videoId)) || a.startSec - b.startSec)
      .slice(0, 3).map((row) => ({ chunkId: safeLabel(row.chunkId), videoId: safeLabel(row.videoId),
        startSec: row.startSec ?? null, endSec: row.endSec ?? null })) };
}

async function readRows(db, collection, match, projection, limit = MAX_ROWS + 1) {
  return db.collection(collection).aggregate([{ $match: match }, { $limit: limit }, { $project: projection }],
    { maxTimeMS: QUERY_MS, allowDiskUse: false, batchSize: 100 }).toArray();
}

async function diagnose(db, config) {
  const report = { checkedAt: new Date().toISOString(), database: safeLabel(db.databaseName),
    collections: { leaf: safeLabel(config.leaf), parent: safeLabel(config.parent) },
    queryLimits: { maxRows: MAX_ROWS, maxTimeMS: QUERY_MS }, atlas: {}, errors: [],
    localCode: { expectedContract: buildGeminiTextSearchContract(), indexName: safeLabel(config.index),
      productionRuntime: '尚未確認，未查詢正式站 runtime 或環境設定',
      splitting: '目前程式預設最多 220 字／6 個 transcript segments／45 秒，實際產生時參數需 metadata 證明',
      ordering: '本機檢查按 videoId、startSec 排序，RAG 最終順序取決於檢索排名' } };
  const course = await readRows(db, 'courses', { _id: new ObjectId(COURSE_ID) }, { _id: 1, videoIds: 1 }, 1);
  const videos = await readRows(db, 'videos', { $or: [{ courseId: new ObjectId(COURSE_ID) },
    { _id: { $in: VIDEO_IDS.map((id) => new ObjectId(id)) } }] },
  { _id: 1, courseId: 1, videoId: 1, durationSec: 1, activeTranscriptVersion: 1 }, 51);
  report.atlas.course = { id: COURSE_ID, found: course.length === 1,
    videoIds: (course[0]?.videoIds || []).map(safeLabel), linkedVideoCount: course[0]?.videoIds?.length ?? null };
  report.atlas.videosTruncated = videos.length > 50;
  report.atlas.videos = videos.map((video) => ({ id: String(video._id), courseId: String(video.courseId || ''),
    videoId: safeLabel(video.videoId), durationSec: video.durationSec ?? null,
    activeTranscriptVersion: safeLabel(video.activeTranscriptVersion), target: VIDEO_IDS.includes(String(video._id)) }));
  report.atlas.missingTargetVideoIds = VIDEO_IDS.filter((id) => !videos.some((video) => String(video._id) === id));
  const ids = [...new Set([...VIDEO_IDS, ...videos.map((video) => video.videoId).filter(Boolean)])];
  const match = { $or: [{ videoId: { $in: ids } }, { courseId: new ObjectId(COURSE_ID) },
    { courseId: COURSE_ID }, { video_id: { $in: ids } }] };
  const rows = await readRows(db, config.leaf, match, chunkProjection());
  let parents = [];
  try {
    parents = await readRows(db, config.parent, match, { _id: 0, parentId: 1, videoId: 1, childChunkIds: 1,
      transcriptVersion: 1, isActive: 1, childCount: 1, startSec: 1, endSec: 1 });
  } catch (error) { report.errors.push({ section: 'parents', code: safeLabel(error.code ?? error.name) }); }
  report.atlas.chunks = summarizeChunks(rows, videos, parents);
  try {
    const indexes = await db.collection(config.leaf).aggregate([{ $listSearchIndexes: {} }], { maxTimeMS: QUERY_MS }).toArray();
    report.atlas.indexes = indexes.map((index) => ({ name: safeLabel(index.name), type: safeLabel(index.type),
      status: safeLabel(index.status), queryable: index.queryable ?? null,
      fields: (index.latestDefinition?.fields || []).map((field) => ({ type: safeLabel(field.type),
        path: safeLabel(field.path), numDimensions: field.numDimensions ?? null, similarity: safeLabel(field.similarity) })) }));
  } catch (error) { report.errors.push({ section: 'searchIndexes', code: safeLabel(error.code ?? error.name) }); }
  report.atlas.verified = ['course', 'videos', 'chunk metadata and vector statistics'];
  report.unverified = ['正式站實際設定與正在使用的 chunk 版本', '模型 metadata 是否真實反映原始 API 回應',
    '缺少 metadata 時的歷史切段參數', '向量搜尋實際命中結果與語意品質', '未落在本課程與指定影片條件內的孤兒資料'];
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { output: { type: 'string', default: path.resolve(__dirname,
    '../../../.local-tools/multimodal-diagnostics/atlas.json') } } });
  // Reuse the repo's env loader, but never import Model, app or server modules.
  const env = require('../../src/config/env');
  const client = new MongoClient(env.mongodbUri, { serverSelectionTimeoutMS: QUERY_MS, connectTimeoutMS: QUERY_MS,
    socketTimeoutMS: 20000, maxPoolSize: 1, retryReads: false, appName: 'focusflow-readonly-diagnostics' });
  try {
    await client.connect();
    const report = await diagnose(client.db(), { leaf: env.videoSegmentCollection, parent: env.videoSegmentParentCollection,
      index: env.qaAtlasVectorIndexName || 'text_embedding_index' });
    report.localCode.settings = { searchMode: safeLabel(env.qaVectorSearchMode),
      queryProvider: safeLabel(env.qaQueryEmbeddingProvider), model: safeLabel(env.geminiEmbeddingModelName),
      configuredIndex: safeLabel(env.qaAtlasVectorIndexName) };
    fs.mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
    fs.writeFileSync(values.output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output: path.resolve(values.output), chunks: report.atlas.chunks.inspected,
      errors: report.errors, truncated: report.atlas.chunks.truncated }));
    if (report.errors.length || report.atlas.chunks.truncated || report.atlas.chunks.parentTruncated
      || report.atlas.videosTruncated) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ section: 'diagnostics', code: safeLabel(error.code ?? error.name),
      message: '唯讀診斷失敗。未提高權限或修改設定，請依錯誤代碼查證。' }));
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) main();
module.exports = { COURSE_ID, VIDEO_IDS, chunkProjection, vectorSummary, summarizeChunks, readRows, diagnose, safeLabel };
