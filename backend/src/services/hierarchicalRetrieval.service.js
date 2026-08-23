const AppError = require('../utils/appError');
const { searchParents } = require('./parentSearch.service');
const { expandParentHits } = require('./childExpansion.service');
const { assembleLeafContext } = require('./leafContextAssembly.service');

function fallbackDiagnostic(code) {
  return {
    stage: 'retrieval',
    code,
    from: 'hierarchical',
    to: 'leaf',
    message: 'Hierarchical retrieval was unavailable, so the backend used leaf retrieval.',
  };
}

async function retrieveWithHierarchy({
  enabled,
  fallbackToLeaf,
  parentRepositoryFactory,
  leafRepositoryFactory,
  leafSearch,
  queryEmbedding,
  courseId,
  videoId = null,
  allowedVideoIds = [],
  restrictedVideoIds = [],
  scope,
  parentLimit,
  childExpansionLimit,
  contextMaxLeaves,
  contextMaxCharacters,
  parentTimeoutMs,
  // Forward the active embedding contract so Parent hits from older
  // generations fail closed before Child expansion.
  expectedContract,
}) {
  if (!enabled) {
    return leafSearch();
  }

  const startedAt = Date.now();
  try {
    const parentRepository = parentRepositoryFactory();
    const parentHits = await searchParents({
      repository: parentRepository,
      queryEmbedding,
      courseId,
      videoId,
      allowedVideoIds,
      restrictedVideoIds,
      limit: parentLimit,
      timeoutMs: parentTimeoutMs,
      expectedContract,
    });
    if (!parentHits.length) {
      const error = new Error('Parent search returned no hits.');
      error.code = 'PARENT_NO_HITS';
      throw error;
    }
    const parentScores = parentHits.map((hit) => Number(hit.score)).filter(Number.isFinite);

    const expansion = await expandParentHits({
      parentHits,
      leafRepository: leafRepositoryFactory(),
      scope,
      courseId,
      videoId,
      limit: childExpansionLimit,
    });
    if (!expansion.leaves.length) {
      const error = new Error('Parent child expansion returned no scoped leaves.');
      error.code = 'PARENT_CHILD_EXPANSION_EMPTY';
      throw error;
    }

    const context = assembleLeafContext({
      leaves: expansion.leaves,
      maxLeaves: contextMaxLeaves,
      maxCharacters: contextMaxCharacters,
    });
    if (!context.matches.length) {
      const error = new Error('Parent context assembly returned no leaves.');
      error.code = 'PARENT_CONTEXT_EMPTY';
      throw error;
    }

    return {
      matches: context.matches,
      diagnostics: {
        searchBackendUsed: 'parent_vector',
        scoringMode: 'parent_vector_child_expansion',
        fallbacks: [],
        hierarchical: {
          retrievalMode: 'hierarchical',
          parentHitCount: parentHits.length,
          retrievedParentIds: parentHits.map((hit) => hit.parentId),
          parentTopScore: parentScores[0] ?? null,
          parentSecondScore: parentScores[1] ?? null,
          parentTopTwoGap: parentScores.length > 1
            ? Number((parentScores[0] - parentScores[1]).toFixed(6))
            : null,
          requestedChildCount: expansion.diagnostics.requestedChildCount,
          expandedLeafCount: expansion.leaves.length,
          deduplicatedLeafCount: context.diagnostics.deduplicatedLeafCount,
          selectedLeafCount: context.diagnostics.selectedLeafCount,
          fallbackUsed: false,
          fallbackReason: null,
          retrievalLatencyMs: Date.now() - startedAt,
          missingChildCount: expansion.diagnostics.missingChildCount,
          scopeMismatchCount: expansion.diagnostics.scopeMismatchCount,
          diagnostics: {
            requestedChildCount: expansion.diagnostics.requestedChildCount,
            foundChildCount: expansion.leaves.length,
            missingChildCount: expansion.diagnostics.missingChildCount,
            duplicateChildCount: expansion.diagnostics.duplicateChildCount,
            scopeMismatchCount: expansion.diagnostics.scopeMismatchCount,
            truncatedChildCount: expansion.diagnostics.truncatedChildCount,
            contextTruncated: context.diagnostics.contextTruncated,
          },
        },
      },
    };
  } catch (error) {
    const reason = error?.code || 'PARENT_RETRIEVAL_FAILED';
    if (!fallbackToLeaf) {
      throw new AppError(
        'Hierarchical retrieval is unavailable.',
        503,
        'HIERARCHICAL_RETRIEVAL_UNAVAILABLE',
        { reason },
      );
    }

    console.warn('[hierarchical-retrieval] leaf fallback', { reason });
    const leafResult = await leafSearch();
    return {
      ...leafResult,
      diagnostics: {
        ...(leafResult.diagnostics || {}),
        fallbacks: [
          ...(leafResult.diagnostics?.fallbacks || []),
          fallbackDiagnostic(reason),
        ],
        hierarchical: {
          retrievalMode: 'leaf_fallback',
          parentHitCount: 0,
          parentTopScore: null,
          parentSecondScore: null,
          parentTopTwoGap: null,
          expandedLeafCount: 0,
          deduplicatedLeafCount: 0,
          selectedLeafCount: leafResult.matches?.length || 0,
          fallbackUsed: true,
          fallbackReason: reason,
          retrievalLatencyMs: Date.now() - startedAt,
          diagnostics: null,
        },
      },
    };
  }
}

module.exports = { retrieveWithHierarchy };
