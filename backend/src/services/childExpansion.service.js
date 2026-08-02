const VideoSegment = require('../models/videoSegment.model');
const {
  buildSegmentLookupQuery,
  normalizeIdentifier,
  normalizeNumber,
  segmentMatchesScope,
} = require('./bridgeScope.service');

function createLeafRepository() {
  return {
    async findLeavesByChunkIds(chunkIds, { scope }) {
      const idQuery = {
        $or: [
          { chunkId: { $in: chunkIds } },
          { segmentId: { $in: chunkIds } },
        ],
      };
      const scopeQuery = buildSegmentLookupQuery(scope);
      // Apply access scope in MongoDB as well as after normalization; post-filtering remains defense in depth.
      return VideoSegment.find(Object.keys(scopeQuery).length
        ? { $and: [idQuery, scopeQuery] }
        : idQuery).lean();
    },
  };
}

function normalizeLeaf(document) {
  const chunkId = normalizeIdentifier(document?.chunkId, document?.segmentId, document?._id);
  return {
    chunkId,
    segmentId: normalizeIdentifier(document?.segmentId, document?.chunkId, document?._id),
    videoId: normalizeIdentifier(document?.videoId),
    courseId: normalizeIdentifier(document?.courseId),
    startSec: normalizeNumber(document?.startSec),
    endSec: normalizeNumber(document?.endSec),
    transcript: String(document?.text ?? document?.transcript ?? '').trim(),
  };
}

async function expandParentHits({
  parentHits,
  leafRepository,
  scope,
  courseId,
  videoId = null,
  limit = 30,
}) {
  const hits = Array.isArray(parentHits) ? parentHits : [];
  const requestedIds = [];
  const ownership = new Map();

  for (const parent of hits) {
    for (const childId of parent.childChunkIds || []) {
      requestedIds.push(childId);
      const entries = ownership.get(childId) || [];
      entries.push(parent);
      ownership.set(childId, entries);
    }
  }

  if (!requestedIds.length) {
    return {
      leaves: [],
      diagnostics: {
        requestedChildCount: 0,
        missingChildCount: 0,
        scopeMismatchCount: 0,
        duplicateChildCount: 0,
        truncatedChildCount: 0,
      },
    };
  }

  const uniqueRequestedIds = [...new Set(requestedIds)];
  const documents = await leafRepository.findLeavesByChunkIds(uniqueRequestedIds, { scope, courseId, videoId });
  const byId = new Map();
  for (const document of Array.isArray(documents) ? documents : []) {
    const leaf = normalizeLeaf(document);
    if (leaf.chunkId && !byId.has(leaf.chunkId)) byId.set(leaf.chunkId, leaf);
    if (leaf.segmentId && !byId.has(leaf.segmentId)) byId.set(leaf.segmentId, leaf);
  }

  const leaves = [];
  const selectedById = new Map();
  let missingChildCount = 0;
  let scopeMismatchCount = 0;
  let duplicateChildCount = 0;

  for (const childId of requestedIds) {
    const leaf = byId.get(childId);
    if (!leaf) {
      missingChildCount += 1;
      continue;
    }

    const parents = ownership.get(childId) || [];
    const parentVideoIds = new Set(parents.map((parent) => String(parent.videoId)));
    const inRequestedVideo = !videoId || leaf.videoId === String(videoId);
    const inParentVideo = parentVideoIds.has(leaf.videoId);
    if (!segmentMatchesScope(leaf, scope) || !inRequestedVideo || !inParentVideo) {
      scopeMismatchCount += 1;
      continue;
    }

    const parentIds = parents.map((parent) => parent.parentId);
    const parentScore = Math.max(...parents.map((parent) => Number(parent.score) || 0));
    const existing = selectedById.get(leaf.chunkId);
    if (existing) {
      duplicateChildCount += 1;
      existing.parentScore = Math.max(existing.parentScore, parentScore);
      existing.parentIds = [...new Set([...existing.parentIds, ...parentIds])];
      continue;
    }

    if (leaves.length >= limit) continue;
    const expanded = { ...leaf, parentIds: [...new Set(parentIds)], parentScore };
    selectedById.set(leaf.chunkId, expanded);
    leaves.push(expanded);
  }

  return {
    leaves,
    diagnostics: {
      requestedChildCount: requestedIds.length,
      missingChildCount,
      scopeMismatchCount,
      duplicateChildCount,
      truncatedChildCount: Math.max(0, uniqueRequestedIds.length
        - missingChildCount - scopeMismatchCount - leaves.length),
    },
  };
}

module.exports = {
  createLeafRepository,
  expandParentHits,
  normalizeLeaf,
};
