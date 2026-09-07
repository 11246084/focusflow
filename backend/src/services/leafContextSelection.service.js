const fs = require('node:fs');
const {
  normalizeIdentifier,
  normalizeNumber,
  segmentMatchesScope,
} = require('./bridgeScope.service');

const LEAF_CONTEXT_CANDIDATE_LIMIT = 30;
const LEAF_CONTEXT_REQUIRED_LIMIT = 15;
const LEAF_CONTEXT_ADJACENT_RADIUS = 1;
const LEAF_CONTEXT_MAX_ADDITIONS = 2;
const LEAF_CONTEXT_MAX_BOUNDARY_GAP_SEC = 2;

const LEAF_CONTEXT_REASONS = Object.freeze({
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  VECTOR_MODE_NOT_ATLAS: 'VECTOR_MODE_NOT_ATLAS',
  CONTEXT_LIMIT_NOT_SUPPORTED: 'CONTEXT_LIMIT_NOT_SUPPORTED',
  HIERARCHICAL_RETRIEVAL_ENABLED: 'HIERARCHICAL_RETRIEVAL_ENABLED',
  ELIGIBLE: 'ELIGIBLE',
  EMPTY_BASELINE: 'EMPTY_BASELINE',
  INSUFFICIENT_CANDIDATE_POOL: 'INSUFFICIENT_CANDIDATE_POOL',
  BASELINE_PREFIX_MISMATCH: 'BASELINE_PREFIX_MISMATCH',
  NO_RELIABLE_ANCHOR: 'NO_RELIABLE_ANCHOR',
  NO_SAFE_ADJACENT_LEAF: 'NO_SAFE_ADJACENT_LEAF',
  APPLIED: 'APPLIED',
  CANDIDATE_SEARCH_FAILED: 'CANDIDATE_SEARCH_FAILED',
  ADJACENT_LOOKUP_FAILED: 'ADJACENT_LOOKUP_FAILED',
  SELECTOR_FAILED: 'SELECTOR_FAILED',
  OUTPUT_INVARIANT_FAILED: 'OUTPUT_INVARIANT_FAILED',
});

function matchIdentity(match) {
  const chunkId = normalizeIdentifier(match?.chunkId);
  const videoId = normalizeIdentifier(match?.videoId);
  return chunkId && videoId ? `${videoId}\u0000${chunkId}` : '';
}

function parseChunkOrdinal(leaf) {
  const videoId = normalizeIdentifier(leaf?.videoId);
  const chunkId = normalizeIdentifier(leaf?.chunkId);
  const prefix = `${videoId}_chunk_`;
  if (!videoId || !chunkId || !chunkId.startsWith(prefix)) return null;
  const suffix = chunkId.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return null;
  return Number(suffix);
}

function adjacentLeafDetails(anchor, candidate) {
  if (normalizeIdentifier(anchor?.videoId) !== normalizeIdentifier(candidate?.videoId)) return null;
  const anchorOrdinal = parseChunkOrdinal(anchor);
  const candidateOrdinal = parseChunkOrdinal(candidate);
  if (!Number.isInteger(anchorOrdinal) || !Number.isInteger(candidateOrdinal)
      || Math.abs(anchorOrdinal - candidateOrdinal) !== LEAF_CONTEXT_ADJACENT_RADIUS) return null;

  const earlier = anchorOrdinal < candidateOrdinal ? anchor : candidate;
  const later = anchorOrdinal < candidateOrdinal ? candidate : anchor;
  const earlierEnd = normalizeNumber(earlier?.endSec);
  const laterStart = normalizeNumber(later?.startSec);
  if (!Number.isFinite(earlierEnd) || !Number.isFinite(laterStart)) return null;
  const boundaryGapSec = Number((laterStart - earlierEnd).toFixed(4));
  if (Math.abs(boundaryGapSec) > LEAF_CONTEXT_MAX_BOUNDARY_GAP_SEC) return null;

  return { boundaryGapSec };
}

function evaluateLeafContextEligibility({
  enabled,
  vectorSearchMode,
  contextLimit,
  hierarchicalRetrievalEnabled,
}) {
  // 這組 selector 只支援已驗證的 Atlas Top15 情境；任一前置條件不符時，
  // 由呼叫端保留既有 retrieval，不嘗試猜測其他設定下的行為。
  let reason = LEAF_CONTEXT_REASONS.ELIGIBLE;
  if (!enabled) reason = LEAF_CONTEXT_REASONS.FEATURE_DISABLED;
  else if (vectorSearchMode !== 'atlas') reason = LEAF_CONTEXT_REASONS.VECTOR_MODE_NOT_ATLAS;
  else if (contextLimit !== LEAF_CONTEXT_REQUIRED_LIMIT) {
    reason = LEAF_CONTEXT_REASONS.CONTEXT_LIMIT_NOT_SUPPORTED;
  } else if (hierarchicalRetrievalEnabled) {
    reason = LEAF_CONTEXT_REASONS.HIERARCHICAL_RETRIEVAL_ENABLED;
  }

  return {
    requested: Boolean(enabled),
    eligible: reason === LEAF_CONTEXT_REASONS.ELIGIBLE,
    reason,
  };
}

function buildPlayableVideoIds(scopedVideos, { fileExists = fs.existsSync } = {}) {
  const playableVideoIds = new Set();

  for (const video of Array.isArray(scopedVideos?.videos) ? scopedVideos.videos : []) {
    const youtubeVideoId = normalizeIdentifier(video?.youtubeVideoId, video?.youtube_video_id);
    const filePath = String(video?.filePath || video?.file_path || '').trim();
    const playable = Boolean(youtubeVideoId) || Boolean(filePath && fileExists(filePath));
    if (!playable) continue;

    for (const identifier of [video?._id, video?.id, video?.videoId, video?.video_id]) {
      const normalized = normalizeIdentifier(identifier);
      if (normalized) playableVideoIds.add(normalized);
    }
  }

  return playableVideoIds;
}

function buildAdjacentLookupChunkIds(anchors) {
  const chunkIds = new Set();
  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    const videoId = normalizeIdentifier(anchor?.videoId);
    const ordinal = parseChunkOrdinal(anchor);
    if (!videoId || !Number.isInteger(ordinal)) continue;

    for (const offset of [-LEAF_CONTEXT_ADJACENT_RADIUS, LEAF_CONTEXT_ADJACENT_RADIUS]) {
      if (ordinal + offset < 0) continue;
      chunkIds.add(`${videoId}_chunk_${String(ordinal + offset).padStart(4, '0')}`);
    }
  }
  return [...chunkIds];
}

function baselineMatchesCandidatePrefix(baselineMatches, candidateMatches) {
  if (candidateMatches.length < baselineMatches.length) return false;
  return baselineMatches.every((match, index) => {
    const baselineIdentity = matchIdentity(match);
    return baselineIdentity && baselineIdentity === matchIdentity(candidateMatches[index]);
  });
}

function findReliableAnchors(baselineMatches, candidateMatches) {
  // Anchor 必須同時存在於原本 Top15，且在 Candidate30 內確實有同影片相鄰片段；
  // 不使用題號、關鍵字或 ground truth，因此可套用到任意學生提問。
  return baselineMatches.filter((anchor) => candidateMatches.some(
    (candidate) => candidate !== anchor
      && matchIdentity(candidate) !== matchIdentity(anchor)
      && adjacentLeafDetails(anchor, candidate),
  ));
}

function normalizeAdjacentLeaf(leaf) {
  return {
    chunkId: normalizeIdentifier(leaf?.chunkId),
    segmentId: normalizeIdentifier(leaf?.segmentId, leaf?.chunkId, leaf?._id),
    videoId: normalizeIdentifier(leaf?.videoId),
    videoTitle: leaf?.videoTitle || null,
    startSec: normalizeNumber(leaf?.startSec),
    endSec: normalizeNumber(leaf?.endSec),
    transcript: String(leaf?.text ?? leaf?.transcript ?? '').trim(),
    score: Number.isFinite(Number(leaf?.score)) ? Number(leaf.score) : null,
  };
}

function buildDiagnostics({ enabled = true, eligible = true, reason }) {
  return {
    strategy: 'candidate30_same_video_adjacent_one_hop',
    enabled,
    eligible,
    applied: false,
    reason,
    candidateLimit: LEAF_CONTEXT_CANDIDATE_LIMIT,
    contextLimit: LEAF_CONTEXT_REQUIRED_LIMIT,
    sameVideoOnly: true,
    scopeValidated: true,
    playableSourceValidated: true,
    adjacentRadius: LEAF_CONTEXT_ADJACENT_RADIUS,
    maxAdditions: LEAF_CONTEXT_MAX_ADDITIONS,
    maxBoundaryGapSec: LEAF_CONTEXT_MAX_BOUNDARY_GAP_SEC,
    reliableAnchorChunkIds: [],
    added: [],
    removed: [],
  };
}

function buildSkippedLeafContextDiagnostics(eligibility) {
  return buildDiagnostics({
    enabled: Boolean(eligibility?.requested),
    eligible: Boolean(eligibility?.eligible),
    reason: eligibility?.reason || LEAF_CONTEXT_REASONS.FEATURE_DISABLED,
  });
}

async function selectProductionLeafContext({
  baselineMatches,
  candidateMatches,
  leafRepository,
  scope,
  playableVideoIds,
}) {
  const baseline = Array.isArray(baselineMatches) ? baselineMatches : [];
  const candidates = Array.isArray(candidateMatches) ? candidateMatches : [];
  const diagnostics = buildDiagnostics({ reason: LEAF_CONTEXT_REASONS.ELIGIBLE });

  if (!baseline.length) {
    diagnostics.reason = LEAF_CONTEXT_REASONS.EMPTY_BASELINE;
    return { matches: baseline, diagnostics };
  }
  if (baseline.length !== LEAF_CONTEXT_REQUIRED_LIMIT
      || candidates.length <= LEAF_CONTEXT_REQUIRED_LIMIT) {
    diagnostics.reason = LEAF_CONTEXT_REASONS.INSUFFICIENT_CANDIDATE_POOL;
    return { matches: baseline, diagnostics };
  }
  if (!baselineMatchesCandidatePrefix(baseline, candidates)) {
    // 兩次 Atlas 查詢若連原 Top15 前綴都不一致，代表排序快照不可靠；
    // 此時直接退回第一次取得的 production baseline，避免混合不同快照。
    diagnostics.reason = LEAF_CONTEXT_REASONS.BASELINE_PREFIX_MISMATCH;
    return { matches: baseline, diagnostics, failedClosed: true };
  }

  const reliableAnchors = findReliableAnchors(baseline, candidates);
  diagnostics.reliableAnchorChunkIds = reliableAnchors.map((anchor) => anchor.chunkId);
  if (!reliableAnchors.length) {
    diagnostics.reason = LEAF_CONTEXT_REASONS.NO_RELIABLE_ANCHOR;
    return { matches: baseline, diagnostics };
  }

  const lookupChunkIds = buildAdjacentLookupChunkIds(reliableAnchors);
  let adjacentDocuments;
  try {
    adjacentDocuments = await leafRepository.findLeavesByChunkIds(lookupChunkIds, { scope });
  } catch (error) {
    diagnostics.reason = LEAF_CONTEXT_REASONS.ADJACENT_LOOKUP_FAILED;
    diagnostics.errorCode = String(error?.code || 'ADJACENT_LOOKUP_FAILED');
    return { matches: baseline, diagnostics, failedClosed: true };
  }

  const candidateByIdentity = new Map(candidates.map((match, index) => [
    matchIdentity(match), { match, candidateRank: index + 1 },
  ]));
  const baselineIdentities = new Set(baseline.map(matchIdentity));
  const allowedVideoIds = scope?.allowedVideoIds instanceof Set ? scope.allowedVideoIds : new Set();
  const playableIds = playableVideoIds instanceof Set ? playableVideoIds : new Set();
  const anchorEntries = reliableAnchors.map((anchor) => ({
    match: anchor,
    candidateRank: candidates.findIndex((candidate) => matchIdentity(candidate) === matchIdentity(anchor)) + 1,
  }));
  const proposalsByIdentity = new Map();

  for (const document of Array.isArray(adjacentDocuments) ? adjacentDocuments : []) {
    const adjacent = normalizeAdjacentLeaf(document);
    const identity = matchIdentity(adjacent);
    if (!identity || baselineIdentities.has(identity)
        || !segmentMatchesScope(adjacent, scope)
        || !allowedVideoIds.has(adjacent.videoId)
        || !playableIds.has(adjacent.videoId)) continue;

    // Direct read 的片段仍須逐筆通過課程範圍、同影片、可播放與時間邊界檢查；
    // 查得到資料不代表可以直接送進答案 context。

    const anchors = anchorEntries
      .map((entry) => ({ entry, details: adjacentLeafDetails(entry.match, adjacent) }))
      .filter(({ details }) => details)
      .sort((left, right) => left.entry.candidateRank - right.entry.candidateRank);
    if (!anchors.length) continue;

    const anchor = anchors[0];
    const candidateEntry = candidateByIdentity.get(identity);
    const direction = parseChunkOrdinal(adjacent) < parseChunkOrdinal(anchor.entry.match)
      ? 'previous' : 'next';
    proposalsByIdentity.set(identity, {
      match: candidateEntry?.match || adjacent,
      candidateRank: candidateEntry?.candidateRank || null,
      anchorCandidateRank: anchor.entry.candidateRank,
      anchorChunkId: anchor.entry.match.chunkId,
      boundaryGapSec: anchor.details.boundaryGapSec,
      direction,
      source: candidateEntry ? 'candidate_pool_adjacent' : 'same_video_adjacent_lookup',
    });
  }

  const proposals = [...proposalsByIdentity.values()].sort((left, right) => (
    left.anchorCandidateRank - right.anchorCandidateRank
    || (left.direction === right.direction ? 0 : left.direction === 'previous' ? -1 : 1)
    || String(left.match.chunkId).localeCompare(String(right.match.chunkId))
  ));
  const selectedBase = baseline.map((match, index) => ({ match, candidateRank: index + 1 }));
  const selectedPromotions = [];
  const protectedRanks = new Set(anchorEntries.map((entry) => entry.candidateRank));

  for (const proposal of proposals) {
    if (selectedPromotions.length >= LEAF_CONTEXT_MAX_ADDITIONS) break;
    const removable = selectedBase
      .filter((entry) => !protectedRanks.has(entry.candidateRank))
      .sort((left, right) => right.candidateRank - left.candidateRank)[0];
    if (!removable) break;
    // 最多以兩個安全相鄰片段取代低排名且非 anchor 的 baseline 片段，
    // 最終大小固定維持 Context15，避免 prompt 無上限膨脹。
    selectedBase.splice(selectedBase.indexOf(removable), 1);
    selectedPromotions.push(proposal);
    diagnostics.removed.push({
      candidateRank: removable.candidateRank,
      chunkId: removable.match.chunkId,
      videoId: removable.match.videoId,
    });
  }

  if (!selectedPromotions.length) {
    diagnostics.reason = LEAF_CONTEXT_REASONS.NO_SAFE_ADJACENT_LEAF;
    return { matches: baseline, diagnostics };
  }

  const selected = [
    ...selectedBase.map((entry) => ({ ...entry, source: 'baseline_top15' })),
    ...selectedPromotions,
  ].sort((left, right) => {
    const leftOrder = left.anchorCandidateRank
      ? left.anchorCandidateRank + (left.direction === 'previous' ? -0.25 : 0.25)
      : left.candidateRank;
    const rightOrder = right.anchorCandidateRank
      ? right.anchorCandidateRank + (right.direction === 'previous' ? -0.25 : 0.25)
      : right.candidateRank;
    return leftOrder - rightOrder;
  });
  const selectedIdentities = selected.map((entry) => matchIdentity(entry.match));
  if (selected.length !== baseline.length
      || selectedIdentities.some((identity) => !identity)
      || new Set(selectedIdentities).size !== selectedIdentities.length) {
    diagnostics.reason = LEAF_CONTEXT_REASONS.OUTPUT_INVARIANT_FAILED;
    return { matches: baseline, diagnostics, failedClosed: true };
  }

  diagnostics.applied = true;
  diagnostics.reason = LEAF_CONTEXT_REASONS.APPLIED;
  diagnostics.added = selectedPromotions.map((entry) => ({
    candidateRank: entry.candidateRank,
    chunkId: entry.match.chunkId,
    videoId: entry.match.videoId,
    anchorCandidateRank: entry.anchorCandidateRank,
    anchorChunkId: entry.anchorChunkId,
    direction: entry.direction,
    boundaryGapSec: entry.boundaryGapSec,
    source: entry.source,
  }));

  return { matches: selected.map((entry) => entry.match), diagnostics };
}

module.exports = {
  LEAF_CONTEXT_CANDIDATE_LIMIT,
  LEAF_CONTEXT_REQUIRED_LIMIT,
  LEAF_CONTEXT_ADJACENT_RADIUS,
  LEAF_CONTEXT_MAX_ADDITIONS,
  LEAF_CONTEXT_MAX_BOUNDARY_GAP_SEC,
  LEAF_CONTEXT_REASONS,
  adjacentLeafDetails,
  buildAdjacentLookupChunkIds,
  buildPlayableVideoIds,
  buildSkippedLeafContextDiagnostics,
  evaluateLeafContextEligibility,
  parseChunkOrdinal,
  selectProductionLeafContext,
};
