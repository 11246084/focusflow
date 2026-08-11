const mongoose = require('mongoose');
const env = require('../config/env');
const VideoSegmentParent = require('../models/videoSegmentParent.model');
const { PARENT_VECTOR_EMBEDDING_DIMENSIONS } = require('./parentVectorIndex.service');
const { ParentRetrievalError } = require('./parentSearch.service');

const DEFAULT_NUM_CANDIDATES_MULTIPLIER = 5;

function toCourseObjectId(courseId) {
  const normalized = String(courseId || '').trim();
  // Mongoose accepts a few loose ObjectId-like values; the Atlas scope contract only accepts canonical 24-hex IDs.
  if (!/^[0-9a-fA-F]{24}$/.test(normalized)) {
    throw new ParentRetrievalError('Parent course scope is invalid.', 'PARENT_SCOPE_INVALID');
  }
  return new mongoose.Types.ObjectId(normalized);
}

function validateQueryEmbedding(queryEmbedding) {
  const validVector = Array.isArray(queryEmbedding)
    && queryEmbedding.length === PARENT_VECTOR_EMBEDDING_DIMENSIONS
    && queryEmbedding.every((value) => typeof value === 'number' && Number.isFinite(value));

  if (!validVector) {
    throw new ParentRetrievalError(
      'Parent query embedding does not match the Atlas index contract.',
      'PARENT_EMBEDDING_DIMENSION_MISMATCH',
    );
  }
}

function normalizeAllowedVideoIds(allowedVideoIds = []) {
  return [...new Set(Array.from(allowedVideoIds || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function buildParentSearchPipeline({
  queryEmbedding,
  courseId,
  videoId = null,
  allowedVideoIds = [],
  restrictedVideoIds = [],
  limit,
  indexName,
}) {
  validateQueryEmbedding(queryEmbedding);
  const safeLimit = Number(limit);
  if (!Number.isInteger(safeLimit) || safeLimit < 1) {
    throw new ParentRetrievalError('Parent search limit is invalid.', 'PARENT_SEARCH_INPUT_INVALID');
  }
  if (!String(indexName || '').trim()) {
    throw new ParentRetrievalError('Parent vector index is not configured.', 'PARENT_INDEX_MISSING');
  }

  // A mounted video keeps its primary courseId, so Parent scope mirrors Leaf's course OR allowed-video bridge.
  const normalizedVideoIds = normalizeAllowedVideoIds(allowedVideoIds);
  const scopeFilter = normalizedVideoIds.length
    ? {
      $or: [
        { courseId: toCourseObjectId(courseId) },
        { videoId: { $in: normalizedVideoIds } },
      ],
    }
    : { courseId: toCourseObjectId(courseId) };
  const requestedVideoId = String(videoId || '').trim();
  const normalizedRestrictedVideoIds = normalizeAllowedVideoIds(restrictedVideoIds);
  let filter = requestedVideoId
    ? { $and: [scopeFilter, { videoId: requestedVideoId }] }
    : scopeFilter;
  if (normalizedRestrictedVideoIds.length) {
    filter = { $and: [filter, { videoId: { $in: normalizedRestrictedVideoIds } }] };
  }

  return [
    {
      $vectorSearch: {
        index: String(indexName).trim(),
        path: 'embedding',
        queryVector: queryEmbedding,
        numCandidates: Math.max(safeLimit * DEFAULT_NUM_CANDIDATES_MULTIPLIER, 10),
        limit: safeLimit,
        filter,
      },
    },
    {
      $project: {
        _id: 0,
        parentId: 1,
        courseId: 1,
        videoId: 1,
        childChunkIds: 1,
        startSec: 1,
        endSec: 1,
        order: 1,
        hierarchyLevel: 1,
        documentType: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];
}

function classifyRepositoryError(error) {
  if (error instanceof ParentRetrievalError) return error;

  const codeName = String(error?.codeName || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (error?.code === 26 || codeName === 'namespacenotfound') {
    return new ParentRetrievalError('Parent collection is unavailable.', 'PARENT_COLLECTION_MISSING');
  }
  if (error?.code === 50 || codeName === 'maxtimemsexpired') {
    return new ParentRetrievalError('Parent search timed out.', 'PARENT_SEARCH_TIMEOUT');
  }
  if (codeName.includes('indexnotfound')
      || (/index/.test(message) && /(not found|does not exist|unavailable)/.test(message))) {
    return new ParentRetrievalError('Parent vector index is unavailable.', 'PARENT_INDEX_MISSING');
  }

  // Never propagate the MongoDB message because it may include namespace, topology, or connection details.
  return new ParentRetrievalError('Parent Atlas search failed.', 'PARENT_SEARCH_FAILED');
}

function createParentSearchRepository({
  model = VideoSegmentParent,
  indexName = env.videoSegmentParentVectorIndexName,
} = {}) {
  return {
    async searchParents({
      queryEmbedding,
      courseId,
      videoId = null,
      allowedVideoIds = [],
      restrictedVideoIds = [],
      limit,
      timeoutMs,
    }) {
      // Keep MongoDB access behind the repository interface so fallback tests never require a live Atlas cluster.
      const pipeline = buildParentSearchPipeline({
        queryEmbedding,
        courseId,
        videoId,
        allowedVideoIds,
        restrictedVideoIds,
        limit,
        indexName,
      });

      try {
        const aggregation = model.aggregate(pipeline);
        // maxTimeMS stops the server-side operation; the outer Promise timeout remains a final safeguard.
        const safeMaxTimeMS = Number(timeoutMs);
        if (aggregation && typeof aggregation.option === 'function'
            && Number.isInteger(safeMaxTimeMS) && safeMaxTimeMS > 0) {
          return await aggregation.option({ maxTimeMS: safeMaxTimeMS });
        }
        return await aggregation;
      } catch (error) {
        throw classifyRepositoryError(error);
      }
    },
  };
}

module.exports = {
  DEFAULT_NUM_CANDIDATES_MULTIPLIER,
  buildParentSearchPipeline,
  classifyRepositoryError,
  createParentSearchRepository,
  normalizeAllowedVideoIds,
  toCourseObjectId,
  validateQueryEmbedding,
};
