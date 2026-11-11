const CHANNELS = ['text', 'audio', 'visual'];
const RRF_K = 60;

function normalizeCandidate(candidate) {
  const result = {
    ...candidate,
    courseId: String(candidate.courseId || ''),
    videoId: String(candidate.videoId || ''),
    chunkId: String(candidate.chunkId || ''),
  };
  if (!result.courseId || !result.videoId || !result.chunkId
    || !Number.isFinite(result.startSec) || !Number.isFinite(result.endSec)
    || result.startSec < 0 || result.endSec <= result.startSec) {
    throw new TypeError('Candidate requires courseId, videoId, chunkId and valid startSec/endSec.');
  }
  return result;
}

function candidateKey(candidate) {
  return JSON.stringify([candidate.courseId, candidate.videoId, candidate.chunkId]);
}

function reciprocalRankFusion(lists, { k = RRF_K, weights = {} } = {}) {
  if (k !== RRF_K) throw new RangeError('The retrieval contract fixes RRF k at 60.');
  const merged = new Map();
  for (const channel of CHANNELS) {
    const weight = weights[channel] ?? 1;
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError('Weights must be finite and nonnegative.');
    const seen = new Set();
    const candidates = lists[channel] ?? [];
    if (!Array.isArray(candidates)) throw new TypeError('Each channel must be an array.');
    for (const [index, value] of candidates.entries()) {
      const candidate = normalizeCandidate(value);
      const key = candidateKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      let entry = merged.get(key);
      if (!entry) {
        entry = { ...candidate, fusionScore: 0, retrievedBy: [], channelRanks: {}, channelScores: {}, contributions: {} };
        merged.set(key, entry);
      }
      if (entry.startSec !== candidate.startSec || entry.endSec !== candidate.endSec
        || entry.text !== candidate.text) {
        throw new Error(`Conflicting chunk evidence for ${candidate.chunkId}.`);
      }
      const rank = index + 1;
      const contribution = weight / (k + rank);
      entry.fusionScore += contribution;
      entry.retrievedBy.push(channel);
      entry.channelRanks[channel] = rank;
      entry.channelScores[channel] = candidate.score ?? null;
      entry.contributions[channel] = contribution;
    }
  }
  return [...merged.values()].sort((left, right) => right.fusionScore - left.fusionScore
    || candidateKey(left).localeCompare(candidateKey(right), 'en'));
}

module.exports = { CHANNELS, RRF_K, normalizeCandidate, candidateKey, reciprocalRankFusion };
