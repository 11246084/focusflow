const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  LEAF_CONTEXT_REASONS,
  adjacentLeafDetails,
  buildAdjacentLookupChunkIds,
  buildPlayableVideoIds,
  evaluateLeafContextEligibility,
  selectProductionLeafContext,
} = require('../src/services/leafContextSelection.service');

function leaf(videoId, ordinal, overrides = {}) {
  return {
    chunkId: `${videoId}_chunk_${String(ordinal).padStart(4, '0')}`,
    segmentId: `${videoId}-segment-${ordinal}`,
    videoId,
    startSec: ordinal * 10,
    endSec: ordinal * 10 + 9,
    transcript: `leaf ${videoId} ${ordinal}`,
    score: Number((1 - ordinal / 100).toFixed(4)),
    ...overrides,
  };
}

function buildCandidatePool() {
  const anchor = leaf('video-a', 5, { startSec: 50, endSec: 60, score: 0.99 });
  const baseline = [anchor];
  for (let rank = 2; rank <= 15; rank += 1) {
    baseline.push(leaf(`video-${rank}`, rank, { score: 1 - rank / 100 }));
  }
  const candidates = [
    ...baseline,
    leaf('video-a', 6, { startSec: 61, endSec: 70, score: 0.7 }),
  ];
  for (let rank = 17; rank <= 30; rank += 1) {
    candidates.push(leaf(`video-${rank}`, rank, { score: 1 - rank / 100 }));
  }
  return { anchor, baseline, candidates };
}

describe('production Leaf context selection', () => {
  it('只讓 default-off Atlas Top15 且 Parent 關閉的設定進入 selector', () => {
    assert.deepEqual(evaluateLeafContextEligibility({
      enabled: false,
      vectorSearchMode: 'atlas',
      contextLimit: 15,
      hierarchicalRetrievalEnabled: false,
    }), {
      requested: false,
      eligible: false,
      reason: LEAF_CONTEXT_REASONS.FEATURE_DISABLED,
    });
    assert.equal(evaluateLeafContextEligibility({
      enabled: true,
      vectorSearchMode: 'memory',
      contextLimit: 15,
      hierarchicalRetrievalEnabled: false,
    }).reason, LEAF_CONTEXT_REASONS.VECTOR_MODE_NOT_ATLAS);
    assert.equal(evaluateLeafContextEligibility({
      enabled: true,
      vectorSearchMode: 'atlas',
      contextLimit: 3,
      hierarchicalRetrievalEnabled: false,
    }).reason, LEAF_CONTEXT_REASONS.CONTEXT_LIMIT_NOT_SUPPORTED);
    assert.equal(evaluateLeafContextEligibility({
      enabled: true,
      vectorSearchMode: 'atlas',
      contextLimit: 15,
      hierarchicalRetrievalEnabled: true,
    }).reason, LEAF_CONTEXT_REASONS.HIERARCHICAL_RETRIEVAL_ENABLED);
  });

  it('只接受同影片、連續 ordinal 且 boundary gap 不超過 2 秒', () => {
    const anchor = leaf('video-a', 5, { startSec: 50, endSec: 60 });
    assert.deepEqual(
      adjacentLeafDetails(anchor, leaf('video-a', 4, { startSec: 40, endSec: 49 })),
      { boundaryGapSec: 1 },
    );
    assert.equal(adjacentLeafDetails(anchor, leaf('video-b', 4)), null);
    assert.equal(adjacentLeafDetails(anchor, leaf('video-a', 3)), null);
    assert.equal(
      adjacentLeafDetails(anchor, leaf('video-a', 6, { startSec: 63, endSec: 70 })),
      null,
    );
  });

  it('從 Candidate30 的可靠 anchor 做 direct-read one-hop，最多加入 2 筆並維持 Context15', async () => {
    const { anchor, baseline, candidates } = buildCandidatePool();
    const requestedChunkIds = [];
    const result = await selectProductionLeafContext({
      baselineMatches: baseline,
      candidateMatches: candidates,
      leafRepository: {
        async findLeavesByChunkIds(chunkIds) {
          requestedChunkIds.push(...chunkIds);
          return [
            leaf('video-a', 4, { startSec: 40, endSec: 49 }),
            leaf('video-a', 6, { startSec: 61, endSec: 70 }),
            leaf('foreign-video', 4, { startSec: 40, endSec: 49 }),
          ];
        },
      },
      scope: { allowedVideoIds: new Set(['video-a']) },
      playableVideoIds: new Set(['video-a']),
    });

    assert.deepEqual(requestedChunkIds, buildAdjacentLookupChunkIds([anchor]));
    assert.equal(result.matches.length, 15);
    assert.equal(new Set(result.matches.map((match) => match.chunkId)).size, 15);
    assert.deepEqual(result.matches.slice(0, 3).map((match) => match.chunkId), [
      'video-a_chunk_0004',
      'video-a_chunk_0005',
      'video-a_chunk_0006',
    ]);
    assert.equal(result.diagnostics.applied, true);
    assert.equal(result.diagnostics.reason, LEAF_CONTEXT_REASONS.APPLIED);
    assert.equal(result.diagnostics.added.length, 2);
    assert.deepEqual(result.diagnostics.removed.map((item) => item.candidateRank), [15, 14]);
  });

  it('baseline 與 Candidate30 prefix 不一致時保留原 Top15 且不讀 adjacent Leaves', async () => {
    const { baseline, candidates } = buildCandidatePool();
    candidates[0] = leaf('different-video', 1);
    let lookupCalls = 0;
    const result = await selectProductionLeafContext({
      baselineMatches: baseline,
      candidateMatches: candidates,
      leafRepository: {
        async findLeavesByChunkIds() {
          lookupCalls += 1;
          return [];
        },
      },
      scope: { allowedVideoIds: new Set(['video-a']) },
      playableVideoIds: new Set(['video-a']),
    });

    assert.equal(lookupCalls, 0);
    assert.strictEqual(result.matches, baseline);
    assert.equal(result.failedClosed, true);
    assert.equal(result.diagnostics.reason, LEAF_CONTEXT_REASONS.BASELINE_PREFIX_MISMATCH);
  });

  it('adjacent direct-read 失敗時保留原 Top15', async () => {
    const { baseline, candidates } = buildCandidatePool();
    const result = await selectProductionLeafContext({
      baselineMatches: baseline,
      candidateMatches: candidates,
      leafRepository: {
        async findLeavesByChunkIds() {
          throw new Error('read unavailable');
        },
      },
      scope: { allowedVideoIds: new Set(['video-a']) },
      playableVideoIds: new Set(['video-a']),
    });

    assert.strictEqual(result.matches, baseline);
    assert.equal(result.failedClosed, true);
    assert.equal(result.diagnostics.reason, LEAF_CONTEXT_REASONS.ADJACENT_LOOKUP_FAILED);
  });

  it('playable 判定沿用 YouTube 或實際存在的本機來源契約', () => {
    const playable = buildPlayableVideoIds({
      videos: [
        { _id: 'youtube-video', youtubeVideoId: 'yt-1' },
        { _id: 'local-video', filePath: 'exists.mp4' },
        { _id: 'missing-video', filePath: 'missing.mp4' },
      ],
    }, { fileExists: (filePath) => filePath === 'exists.mp4' });

    assert.deepEqual([...playable], ['youtube-video', 'local-video']);
  });
});
