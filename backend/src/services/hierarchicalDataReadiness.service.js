const crypto = require('node:crypto');
const env = require('../config/env');
const VideoSegment = require('../models/videoSegment.model');
const VideoSegmentParent = require('../models/videoSegmentParent.model');
const {
  buildGeminiTextSearchContract,
  compareEmbeddingContracts,
} = require('./embeddingContract.service');

const REQUIRED_PARENT_FILTER_PATHS = Object.freeze([
  'courseId',
  'videoId',
  'generationVersion',
  'isActive',
]);

let readinessSnapshot = Object.freeze({
  status: 'not_verified',
  ready: false,
  checkedAt: null,
  source: 'live_read_only',
  reason: 'HIERARCHICAL_ACTIVE_DATA_NOT_VERIFIED',
  evidence: null,
});

// Readiness is fail-closed and evidence-based. Merely enabling an environment
// flag never makes Parent retrieval eligible without compatible active data.

function documentContract(document = {}) {
  return {
    provider: document.embeddingProvider,
    model: document.embeddingModel,
    dimension: document.embeddingDimension,
    instructionVersion: document.embeddingInstructionVersion,
    generationVersion: document.generationVersion,
    normalizationVersion: document.normalizationVersion,
    contractVersion: document.embeddingContractVersion,
    schemaVersion: document.embeddingSchemaVersion,
    taskType: document.embeddingTaskType ?? null,
  };
}

function contractMismatches(document, expected, { allowSchemaDifference = false } = {}) {
  const mismatches = compareEmbeddingContracts(expected, documentContract(document));
  return allowSchemaDifference
    ? mismatches.filter((field) => field !== 'schemaVersion')
    : mismatches;
}

function contractHash(expected) {
  return crypto.createHash('sha256').update(JSON.stringify(expected)).digest('hex');
}

function searchIndexDefinition(index = {}) {
  return index.latestDefinition || index.definition || {};
}

function parentFilterPaths(index = {}) {
  const fields = searchIndexDefinition(index).fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field) => field?.type === 'filter' && field.path)
    .map((field) => String(field.path));
}

function evaluateActiveDataEvidence({
  allowedVideoIds = [],
  parents = [],
  leaves = [],
  leafIndexes = [],
  parentSearchIndexes = [],
  expectedContract = buildGeminiTextSearchContract(),
  parentIndexName = env.videoSegmentParentVectorIndexName,
} = {}) {
  // Validate the complete Parent -> Child -> index chain for every allowlisted
  // video; a partial match must keep the shared rollout gate closed.
  const supportedVideos = [...new Set(allowedVideoIds.map((value) => String(value || '').trim()).filter(Boolean))];
  const failures = [];
  if (!supportedVideos.length) failures.push('ROLLOUT_VIDEO_ALLOWLIST_EMPTY');

  const activeParents = parents.filter((parent) => parent?.isActive === true);
  for (const videoId of supportedVideos) {
    if (!activeParents.some((parent) => String(parent.videoId || '') === videoId)) {
      failures.push('ACTIVE_PARENT_VIDEO_MISSING');
      break;
    }
  }
  if (parents.some((parent) => parent?.isActive !== true)) failures.push('PARENT_ACTIVE_FILTER_BYPASSED');
  if (parents.some((parent) => contractMismatches(
    parent,
    expectedContract,
    { allowSchemaDifference: true },
  ).length)) failures.push('ACTIVE_PARENT_CONTRACT_MISMATCH');

  const requestedChildIds = activeParents.flatMap((parent) => (
    Array.isArray(parent.childChunkIds) ? parent.childChunkIds.map(String) : []
  ));
  const requestedChildSet = new Set(requestedChildIds);
  if (!requestedChildSet.size) failures.push('ACTIVE_PARENT_CHILDREN_MISSING');

  const leafCounts = new Map();
  for (const leaf of leaves) {
    const chunkId = String(leaf?.chunkId || '');
    if (!chunkId) continue;
    leafCounts.set(chunkId, (leafCounts.get(chunkId) || 0) + 1);
  }
  if ([...requestedChildSet].some((chunkId) => !leafCounts.has(chunkId))) {
    failures.push('ACTIVE_LEAF_CHILD_MISSING');
  }
  if ([...leafCounts.values()].some((count) => count !== 1)) {
    failures.push('ACTIVE_LEAF_CHILD_DUPLICATE');
  }
  if (leaves.some((leaf) => contractMismatches(leaf, expectedContract).length)) {
    failures.push('ACTIVE_LEAF_CONTRACT_MISMATCH');
  }

  const chunkIndex = leafIndexes.find((index) => index?.name === 'chunkId_1');
  if (!chunkIndex || chunkIndex.hidden === true || chunkIndex.key?.chunkId !== 1
      || Object.keys(chunkIndex.key || {}).length !== 1) {
    failures.push('LEAF_CHUNK_ID_INDEX_NOT_READY');
  }

  const parentIndex = parentSearchIndexes.find((index) => index?.name === parentIndexName);
  if (!parentIndex || parentIndex.status !== 'READY' || parentIndex.queryable === false) {
    failures.push('PARENT_VECTOR_INDEX_NOT_READY');
  } else {
    const filterPaths = new Set(parentFilterPaths(parentIndex));
    if (REQUIRED_PARENT_FILTER_PATHS.some((path) => !filterPaths.has(path))) {
      failures.push('PARENT_VECTOR_FILTER_CONTRACT_MISMATCH');
    }
  }

  const uniqueFailures = [...new Set(failures)];
  return {
    status: uniqueFailures.length ? 'incompatible' : 'verified',
    ready: uniqueFailures.length === 0,
    reason: uniqueFailures[0] || null,
    failures: uniqueFailures,
    evidence: {
      contractHash: contractHash(expectedContract),
      generationVersion: expectedContract.generationVersion,
      supportedVideoCount: supportedVideos.length,
      activeParentCount: activeParents.length,
      requestedChildCount: requestedChildSet.size,
      activeLeafCount: leaves.length,
      leafIndexName: chunkIndex?.name || null,
      parentIndexName: parentIndex?.name || null,
      parentFilterPaths: parentIndex ? parentFilterPaths(parentIndex) : [],
    },
  };
}

async function listParentSearchIndexes(collection, indexName) {
  if (typeof collection.listSearchIndexes === 'function') {
    return collection.listSearchIndexes(indexName).toArray();
  }
  return collection.aggregate([{ $listSearchIndexes: { name: indexName } }]).toArray();
}

async function refreshHierarchicalDataReadiness({
  allowedVideoIds = env.hierarchicalRetrievalAllowedVideoIds,
  parentCollection = VideoSegmentParent.collection,
  leafCollection = VideoSegment.collection,
  parentIndexName = env.videoSegmentParentVectorIndexName,
  now = () => new Date(),
} = {}) {
  const checkedAt = now().toISOString();
  try {
    const videoIds = [...new Set(allowedVideoIds.map((value) => String(value || '').trim()).filter(Boolean))];
    // Only projections and read-side index metadata are used here. The check is
    // safe to run at startup and cannot publish or repair data implicitly.
    const parents = await parentCollection.find(
      { videoId: { $in: videoIds }, isActive: true },
      { projection: {
        _id: 0, videoId: 1, childChunkIds: 1, isActive: 1,
        embeddingProvider: 1, embeddingModel: 1, embeddingDimension: 1,
        embeddingTaskType: 1, embeddingInstructionVersion: 1, generationVersion: 1,
        normalizationVersion: 1, embeddingContractVersion: 1, embeddingSchemaVersion: 1,
      } },
    ).toArray();
    const [leaves, leafIndexes, parentSearchIndexes] = await Promise.all([
      leafCollection.find(
        { videoId: { $in: videoIds } },
        { projection: {
          _id: 0, chunkId: 1, videoId: 1,
          embeddingProvider: 1, embeddingModel: 1, embeddingDimension: 1,
          embeddingTaskType: 1, embeddingInstructionVersion: 1, generationVersion: 1,
          normalizationVersion: 1, embeddingContractVersion: 1, embeddingSchemaVersion: 1,
        } },
      ).toArray(),
      leafCollection.listIndexes().toArray(),
      listParentSearchIndexes(parentCollection, parentIndexName),
    ]);
    const evaluated = evaluateActiveDataEvidence({
      allowedVideoIds: videoIds,
      parents,
      leaves,
      leafIndexes,
      parentSearchIndexes,
      parentIndexName,
    });
    readinessSnapshot = Object.freeze({
      ...evaluated,
      checkedAt,
      source: 'live_read_only',
    });
  } catch {
    readinessSnapshot = Object.freeze({
      status: 'verification_failed',
      ready: false,
      checkedAt,
      source: 'live_read_only',
      reason: 'HIERARCHICAL_ACTIVE_DATA_VERIFICATION_FAILED',
      failures: ['HIERARCHICAL_ACTIVE_DATA_VERIFICATION_FAILED'],
      evidence: null,
    });
  }
  return readinessSnapshot;
}

function getHierarchicalDataReadinessSnapshot() {
  return readinessSnapshot;
}

function setHierarchicalDataReadinessForTests(snapshot) {
  readinessSnapshot = Object.freeze({ ...snapshot });
}

function resetHierarchicalDataReadinessForTests() {
  readinessSnapshot = Object.freeze({
    status: 'not_verified',
    ready: false,
    checkedAt: null,
    source: 'live_read_only',
    reason: 'HIERARCHICAL_ACTIVE_DATA_NOT_VERIFIED',
    evidence: null,
  });
}

module.exports = {
  REQUIRED_PARENT_FILTER_PATHS,
  contractMismatches,
  contractHash,
  documentContract,
  evaluateActiveDataEvidence,
  getHierarchicalDataReadinessSnapshot,
  parentFilterPaths,
  refreshHierarchicalDataReadiness,
  resetHierarchicalDataReadinessForTests,
  setHierarchicalDataReadinessForTests,
};
