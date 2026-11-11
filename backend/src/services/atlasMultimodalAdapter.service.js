const { normalizeCandidate } = require('./rankFusion.service');
const { retrieveMultimodal } = require('./multimodalRetrieval.service');
const { buildGeminiTextSearchContract, compareEmbeddingContracts, parseActiveEmbeddingContract } = require('./embeddingContract.service');

const VECTOR_FIELDS = { text: 'embedding', audio: 'audioEmbedding', visual: 'visualEmbedding' };
const INDEX_NAME = 'text_embedding_index';
const ISOLATED_INDEX_NAME = 'multimodal_sample_3_vector_index';
function validateIndexName(name) {
  if (![INDEX_NAME, ISOLATED_INDEX_NAME].includes(name)) throw new TypeError('Unsupported vector index name.');
  return name;
}

function validateQuery(record) {
  if (record?.provider !== 'gemini' || record.model !== 'gemini-embedding-2'
    || record.status !== 'success' || record.dimension !== 3072
    || record.contractVersion !== buildGeminiTextSearchContract().contractVersion
    || record.modality !== 'query' || !Array.isArray(record.embedding) || record.embedding.length !== 3072
    || !record.embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError('A successful stable Gemini query embedding with 3072 finite numbers is required.');
  }
  const norm = record.embedding.reduce((total, value) => total + value * value, 0);
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > 0.001) throw new TypeError('Query embedding must be unit normalized.');
}

async function readAtlasIndex(collection, indexName = INDEX_NAME) {
  validateIndexName(indexName);
  try {
    const indexes = await collection.aggregate([{ $listSearchIndexes: { name: indexName } }],
      { maxTimeMS: 10000, signal: AbortSignal.timeout(12000) }).toArray();
    return indexes.find((index) => index.name === indexName) || null;
  } catch {
    throw new Error('Atlas index preflight failed; details redacted.');
  }
}

function fieldsFor(textPath = 'embedding') {
  if (!['embedding', 'stableTextEmbedding'].includes(textPath)) throw new TypeError('Unsupported text vector path.');
  return { ...VECTOR_FIELDS, text: textPath };
}

function channelReadiness(index, channel, textDataContract, textPath = 'embedding', indexName = INDEX_NAME) {
  validateIndexName(indexName);
  if (!index || index.name !== indexName || index.type !== 'vectorSearch'
    || index.status !== 'READY' || index.queryable !== true) return 'index_not_ready';
  const field = index.latestDefinition?.fields?.find((value) => value.path === fieldsFor(textPath)[channel]);
  if (!field) return 'index_field_missing';
  if (field.type !== 'vector' || field.numDimensions !== 3072 || field.similarity !== 'cosine') return 'index_field_incompatible';
  if (!index.latestDefinition.fields.some((value) => value.type === 'filter' && value.path === 'videoId')) return 'video_filter_missing';
  if (channel === 'text' && compareEmbeddingContracts(buildGeminiTextSearchContract(), textDataContract).length) {
    return 'text_contract_unverified';
  }
  return null;
}

function buildAtlasPipeline(channel, embedding, allowedVideoIds, textPath = 'embedding', indexName = INDEX_NAME, courseId = null) {
  validateIndexName(indexName);
  if (!Object.hasOwn(VECTOR_FIELDS, channel)) throw new TypeError('Unknown search channel.');
  if (!Array.isArray(allowedVideoIds) || !allowedVideoIds.length) throw new TypeError('Authorized video IDs are required.');
  return [
    { $vectorSearch: { index: indexName, path: fieldsFor(textPath)[channel], queryVector: embedding,
      numCandidates: 100, limit: 20, filter: { videoId: { $in: allowedVideoIds }, ...(courseId ? { courseId } : {}) } } },
    { $project: { _id: 0, chunkId: 1, segmentId: 1, courseId: 1, videoId: 1,
      startSec: 1, endSec: 1, text: 1, mediaEmbeddingMeta: 1,
      embeddingProvider: 1, embeddingModel: 1, embeddingDimension: 1, embeddingTaskType: 1,
      embeddingInstructionVersion: 1, generationVersion: 1, normalizationVersion: 1,
      embeddingContractVersion: 1, embeddingSchemaVersion: 1, score: { $meta: 'vectorSearchScore' } } },
  ];
}

function hasCompatibleMetadata(row, channel, textPath) {
  if (channel === 'text') {
    const active = parseActiveEmbeddingContract(JSON.stringify(textPath === 'stableTextEmbedding' ? row.mediaEmbeddingMeta?.text : row), 'atlas_result');
    return compareEmbeddingContracts(buildGeminiTextSearchContract(), active.contract).length === 0;
  }
  const meta = row.mediaEmbeddingMeta?.[channel];
  return meta?.status === 'success' && meta.provider === 'gemini' && meta.dimension === 3072 && meta.model === 'gemini-embedding-2'
    && meta.contractVersion === `gemini_embedding_2_${channel}_v1`;
}

async function retrieveAtlasMultimodal({ collection, queryEmbedding, scope, indexSnapshot,
  textDataContract = null, mode = 'equal', timeoutMs = 10000, textPath = 'embedding', indexName = INDEX_NAME }) {
  validateIndexName(indexName);
  fieldsFor(textPath);
  validateQuery(queryEmbedding);
  if (!scope?.courseId || !Array.isArray(scope.allowedVideoIds) || !scope.allowedVideoIds.length
    || !scope.allowedVideoIds.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new TypeError('An authorized course and its video allowlist are required.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new RangeError('Invalid query timeout.');
  const authorized = new Set(scope.allowedVideoIds);
  const diagnostics = {};
  const searchers = {};
  for (const channel of Object.keys(VECTOR_FIELDS)) {
    const reason = channelReadiness(indexSnapshot, channel, textDataContract, textPath, indexName);
    diagnostics[channel] = { source: 'atlas', ms: 0, reason };
    if (reason) continue;
    searchers[channel] = async () => {
      const started = performance.now();
      try {
        const rows = await collection.aggregate(buildAtlasPipeline(channel, queryEmbedding.embedding, [...authorized], textPath,
          indexName, indexName === ISOLATED_INDEX_NAME ? scope.courseId : null),
          { maxTimeMS: timeoutMs, signal: AbortSignal.timeout(timeoutMs + 1000) }).toArray();
        diagnostics[channel].returnedRows = rows.length;
        return rows.filter((row) => hasCompatibleMetadata(row, channel, textPath) && authorized.has(row.videoId)
          && (!scope.allowedChunkIds || scope.allowedChunkIds.includes(row.chunkId))
          && (row.courseId == null || String(row.courseId) === String(scope.courseId)))
          // 既有文字檢索回傳的逐字稿是去掉前後空白的；這裡用同一個形式，
          // 同一個片段在兩邊的文字才會相同，合併時不會被當成證據衝突。
          .map((row) => normalizeCandidate({ ...row, courseId: String(scope.courseId),
            ...(typeof row.text === 'string' ? { text: row.text.trim() } : {}) }));
      } catch {
        diagnostics[channel].reason = 'atlas_query_failed';
        throw new Error('Atlas channel query failed; details redacted.');
      } finally {
        diagnostics[channel].ms = Math.max(0, performance.now() - started);
      }
    };
  }
  const result = await retrieveMultimodal({ question: '', searchers, scope, mode });
  for (const channel of Object.keys(VECTOR_FIELDS)) {
    result.diagnostics[channel] = { ...result.diagnostics[channel], ...diagnostics[channel] };
  }
  return { ...result, source: 'atlas', indexName };
}

module.exports = { VECTOR_FIELDS, INDEX_NAME, ISOLATED_INDEX_NAME, validateQuery, readAtlasIndex, channelReadiness,
  buildAtlasPipeline, retrieveAtlasMultimodal };
