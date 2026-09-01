function normalizeIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function hitAtK({ expectedRelevantChunkIds, retrievedChunkIds, k = 5 }) {
  const expected = new Set(normalizeIds(expectedRelevantChunkIds));
  if (!expected.size) return null;
  return normalizeIds(retrievedChunkIds).slice(0, k).some((id) => expected.has(id)) ? 1 : 0;
}

function reciprocalRank({ expectedRelevantChunkIds, retrievedChunkIds }) {
  const expected = new Set(normalizeIds(expectedRelevantChunkIds));
  if (!expected.size) return null;
  const index = normalizeIds(retrievedChunkIds).findIndex((id) => expected.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

function normalizeExpectedLeafGroups(groups) {
  return (Array.isArray(groups) ? groups : []).map((group, index) => ({
    groupId: String(group?.groupId || `G${index + 1}`),
    videoId: group?.videoId == null ? null : String(group.videoId),
    chunkIds: normalizeIds(group?.chunkIds),
  })).filter((group) => group.chunkIds.length > 0);
}

function normalizeCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({
    rank: index + 1,
    score: Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : null,
    chunkId: candidate?.chunkId == null ? null : String(candidate.chunkId),
    segmentId: candidate?.segmentId == null ? null : String(candidate.segmentId),
    videoId: candidate?.videoId == null ? null : String(candidate.videoId),
    startSec: candidate?.startSec != null && Number.isFinite(Number(candidate.startSec))
      ? Number(candidate.startSec) : null,
    endSec: candidate?.endSec != null && Number.isFinite(Number(candidate.endSec))
      ? Number(candidate.endSec) : null,
  }));
}

function evaluateRetrievalCandidates({ expectedLeafGroups = [], candidates = [], k = 5 }) {
  const groups = normalizeExpectedLeafGroups(expectedLeafGroups);
  const rankedCandidates = normalizeCandidates(candidates);
  const expectedChunkIds = normalizeIds(groups.flatMap((group) => group.chunkIds));
  const effectiveK = Number.isInteger(k) && k > 0 ? k : 5;

  if (!expectedChunkIds.length) {
    return {
      groundTruthStatus: 'not_annotated',
      expectedLeafGroups: groups,
      expectedLeaves: [],
      groupCoverage: [],
      metrics: null,
    };
  }

  const topK = rankedCandidates.slice(0, effectiveK);
  const firstCandidateByChunkId = new Map();
  for (const candidate of rankedCandidates) {
    if (candidate.chunkId && !firstCandidateByChunkId.has(candidate.chunkId)) {
      firstCandidateByChunkId.set(candidate.chunkId, candidate);
    }
  }
  const topKIds = new Set(topK.map((candidate) => candidate.chunkId).filter(Boolean));
  const expectedLeaves = expectedChunkIds.map((chunkId) => {
    const candidate = firstCandidateByChunkId.get(chunkId) || null;
    return {
      chunkId,
      hitAtK: topKIds.has(chunkId),
      rank: candidate?.rank ?? null,
      score: candidate?.score ?? null,
      segmentId: candidate?.segmentId ?? null,
      videoId: candidate?.videoId ?? null,
      startSec: candidate?.startSec ?? null,
      endSec: candidate?.endSec ?? null,
    };
  });
  const expectedLeafById = new Map(expectedLeaves.map((leaf) => [leaf.chunkId, leaf]));
  const groupCoverage = groups.map((group) => {
    const leaves = group.chunkIds.map((chunkId) => expectedLeafById.get(chunkId));
    const hits = leaves.filter((leaf) => leaf.hitAtK);
    return {
      groupId: group.groupId,
      videoId: group.videoId,
      expectedChunkIds: [...group.chunkIds],
      hitAtK: hits.length > 0,
      completeAtK: hits.length === leaves.length,
      hitCountAtK: hits.length,
      expectedCount: leaves.length,
      hitChunkIds: hits.map((leaf) => leaf.chunkId),
      missingChunkIds: leaves.filter((leaf) => !leaf.hitAtK).map((leaf) => leaf.chunkId),
    };
  });
  const retrievedExpectedLeafCountAtK = expectedLeaves.filter((leaf) => leaf.hitAtK).length;
  const retrievedChunkIds = rankedCandidates.map((candidate) => candidate.chunkId).filter(Boolean);

  return {
    groundTruthStatus: 'annotated',
    expectedLeafGroups: groups,
    expectedLeaves,
    groupCoverage,
    metrics: {
      k: effectiveK,
      hitAtK: hitAtK({ expectedRelevantChunkIds: expectedChunkIds, retrievedChunkIds, k: effectiveK }),
      reciprocalRank: reciprocalRank({ expectedRelevantChunkIds: expectedChunkIds, retrievedChunkIds }),
      expectedLeafCount: expectedChunkIds.length,
      retrievedExpectedLeafCountAtK,
      expectedLeafRecallAtK: retrievedExpectedLeafCountAtK / expectedChunkIds.length,
      completeGroupCountAtK: groupCoverage.filter((group) => group.completeAtK).length,
      expectedGroupCount: groupCoverage.length,
    },
  };
}

function aggregateRetrievalEvaluations(evaluations) {
  const annotated = (Array.isArray(evaluations) ? evaluations : [])
    .filter((evaluation) => evaluation?.groundTruthStatus === 'annotated' && evaluation.metrics);
  if (!annotated.length) {
    return { annotatedQuestionCount: 0, hitAtK: null, mrr: null };
  }

  const expectedLeafCount = annotated.reduce(
    (sum, evaluation) => sum + (evaluation.metrics.expectedLeafCount || 0), 0,
  );
  const retrievedExpectedLeafCountAtK = annotated.reduce(
    (sum, evaluation) => sum + (evaluation.metrics.retrievedExpectedLeafCountAtK || 0), 0,
  );
  const expectedGroupCount = annotated.reduce(
    (sum, evaluation) => sum + (evaluation.metrics.expectedGroupCount || 0), 0,
  );
  const partialGroupCountAtK = annotated.reduce(
    (sum, evaluation) => sum + (Array.isArray(evaluation.groupCoverage)
      ? evaluation.groupCoverage.filter((group) => group.hitAtK).length
      : 0),
    0,
  );
  const completeGroupCountAtK = annotated.reduce(
    (sum, evaluation) => sum + (evaluation.metrics.completeGroupCountAtK || 0), 0,
  );

  return {
    annotatedQuestionCount: annotated.length,
    hitAtK: annotated.reduce((sum, evaluation) => sum + evaluation.metrics.hitAtK, 0)
      / annotated.length,
    mrr: annotated.reduce((sum, evaluation) => sum + evaluation.metrics.reciprocalRank, 0)
      / annotated.length,
    expectedLeafCount,
    retrievedExpectedLeafCountAtK,
    expectedLeafRecallAtK: expectedLeafCount
      ? retrievedExpectedLeafCountAtK / expectedLeafCount : null,
    expectedGroupCount,
    partialGroupCountAtK,
    partialGroupCoverageAtK: expectedGroupCount ? partialGroupCountAtK / expectedGroupCount : null,
    completeGroupCountAtK,
    completeGroupCoverageAtK: expectedGroupCount ? completeGroupCountAtK / expectedGroupCount : null,
  };
}

function buildRetrievalEvaluationRecord({
  originalQuestion,
  standaloneQuestion,
  expectedRelevantChunkIds = [],
  originalTopK = [],
  rewrittenTopK = [],
}) {
  const expected = normalizeIds(expectedRelevantChunkIds);
  return {
    originalQuestion,
    standaloneQuestion,
    expectedRelevantChunkIds: expected,
    originalTopK: normalizeIds(originalTopK),
    rewrittenTopK: normalizeIds(rewrittenTopK),
    groundTruthStatus: expected.length ? 'annotated' : 'pending_manual_annotation',
    metrics: expected.length ? {
      originalHitAtK: hitAtK({ expectedRelevantChunkIds: expected, retrievedChunkIds: originalTopK, k: originalTopK.length || 5 }),
      rewrittenHitAtK: hitAtK({ expectedRelevantChunkIds: expected, retrievedChunkIds: rewrittenTopK, k: rewrittenTopK.length || 5 }),
      originalMrr: reciprocalRank({ expectedRelevantChunkIds: expected, retrievedChunkIds: originalTopK }),
      rewrittenMrr: reciprocalRank({ expectedRelevantChunkIds: expected, retrievedChunkIds: rewrittenTopK }),
    } : null,
  };
}

module.exports = {
  aggregateRetrievalEvaluations,
  buildRetrievalEvaluationRecord,
  evaluateRetrievalCandidates,
  hitAtK,
  reciprocalRank,
};
