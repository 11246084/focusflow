class ParentRetrievalError extends Error {
  constructor(message, code = 'PARENT_SEARCH_FAILED') {
    super(message);
    this.name = 'ParentRetrievalError';
    this.code = code;
  }
}

function normalizeId(value) {
  return value == null ? '' : String(value).trim();
}

function validateParentHit(hit, { courseId, videoId } = {}) {
  if (!hit || typeof hit !== 'object') {
    throw new ParentRetrievalError('Parent search returned an invalid document.', 'PARENT_DOCUMENT_INVALID');
  }

  const parentId = normalizeId(hit.parentId);
  const parentVideoId = normalizeId(hit.videoId);
  const childChunkIds = Array.isArray(hit.childChunkIds)
    ? hit.childChunkIds.map(normalizeId).filter(Boolean)
    : null;
  const score = Number(hit.score);
  const startSec = Number(hit.startSec);
  const endSec = Number(hit.endSec);
  const order = Number(hit.order);

  if (!parentId || !parentVideoId || !childChunkIds || !childChunkIds.length
      || !Number.isFinite(score) || !Number.isFinite(startSec) || !Number.isFinite(endSec)
      || !Number.isInteger(order) || startSec < 0 || endSec < startSec) {
    throw new ParentRetrievalError('Parent search returned an invalid document.', 'PARENT_DOCUMENT_INVALID');
  }

  if (hit.courseId != null && normalizeId(hit.courseId) !== normalizeId(courseId)) {
    throw new ParentRetrievalError('Parent search returned a document outside the course scope.', 'PARENT_SCOPE_MISMATCH');
  }

  if (videoId && parentVideoId !== normalizeId(videoId)) {
    throw new ParentRetrievalError('Parent search returned a document outside the video scope.', 'PARENT_SCOPE_MISMATCH');
  }

  return {
    parentId,
    videoId: parentVideoId,
    childChunkIds,
    score,
    startSec,
    endSec,
    order,
    hierarchyLevel: hit.hierarchyLevel || 'parent',
    documentType: hit.documentType || 'parent_chunk',
  };
}

function createUnavailableParentRepository() {
  return {
    async searchParents() {
      throw new ParentRetrievalError(
        'Parent storage is not available in Hierarchical Retrieval Round 1.',
        'PARENT_REPOSITORY_UNAVAILABLE',
      );
    },
  };
}

async function searchParents({
  repository,
  queryEmbedding,
  courseId,
  videoId = null,
  limit,
  timeoutMs = 1000,
}) {
  if (!repository || typeof repository.searchParents !== 'function') {
    throw new ParentRetrievalError('Parent repository is unavailable.', 'PARENT_REPOSITORY_UNAVAILABLE');
  }

  const safeLimit = Number(limit);
  if (!Array.isArray(queryEmbedding) || !queryEmbedding.length || !normalizeId(courseId)
      || !Number.isInteger(safeLimit) || safeLimit < 1) {
    throw new ParentRetrievalError('Parent search input is invalid.', 'PARENT_SEARCH_INPUT_INVALID');
  }

  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve(repository.searchParents({ queryEmbedding, courseId, videoId, limit: safeLimit })),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ParentRetrievalError(
          'Parent search timed out.',
          'PARENT_SEARCH_TIMEOUT',
        )), timeoutMs);
      }),
    ]);

    if (!Array.isArray(result)) {
      throw new ParentRetrievalError('Parent search returned an invalid result.', 'PARENT_DOCUMENT_INVALID');
    }

    return result.slice(0, safeLimit).map((hit) => validateParentHit(hit, { courseId, videoId }));
  } catch (error) {
    if (error instanceof ParentRetrievalError) throw error;
    throw new ParentRetrievalError('Parent search failed.', error?.code || 'PARENT_SEARCH_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  ParentRetrievalError,
  createUnavailableParentRepository,
  searchParents,
  validateParentHit,
};
