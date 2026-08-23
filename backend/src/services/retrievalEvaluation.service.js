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

module.exports = { hitAtK, reciprocalRank, buildRetrievalEvaluationRecord };
