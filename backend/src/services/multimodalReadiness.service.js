const { readAtlasIndex } = require('./atlasMultimodalAdapter.service');
const { buildGeminiTextSearchContract } = require('./embeddingContract.service');

// Cache only index metadata, never users, scope, candidates or positive data coverage.
function createIndexSnapshotReader({ read = readAtlasIndex, now = Date.now, ttlMs = 30000, failureTtlMs = 5000 } = {}) {
  let cache = new WeakMap();
  async function get(collection) {
    let entry = cache.get(collection);
    if (entry?.pending) return structuredClone(await entry.pending);
    if (entry && now() < entry.expires) return structuredClone(entry.value);
    const target = cache;
    entry = { pending: null };
    entry.pending = Promise.resolve().then(async () => {
      let value = null;
      try { value = await read(collection); } catch { /* Fail closed; no raw provider errors. */ }
      target.set(collection, { value, expires: now() + (value ? ttlMs : failureTtlMs) });
      return value;
    });
    cache.set(collection, entry);
    return structuredClone(await entry.pending);
  }
  return { get, clear: () => { cache = new WeakMap(); } };
}
const indexReader = createIndexSnapshotReader();

async function readStableTextCoverage(collection, scope, segments, { timeoutMs = 3000 } = {}) {
  const expected = new Map();
  for (const row of segments) {
    if (!row.chunkId || !scope.allowedVideoIds.includes(row.videoId)) {
      return { complete: false, expected: segments.length, covered: 0, reason: 'scope_identity_unverified' };
    }
    const key = JSON.stringify([row.videoId, row.chunkId]);
    if (expected.has(key)) return { complete: false, expected: segments.length, covered: 0, reason: 'duplicate_scope_identity' };
    expected.set(key, row);
  }
  if (!expected.size) return { complete: false, expected: 0, covered: 0, reason: 'empty_scope' };
  const contract = buildGeminiTextSearchContract();
  const metadata = Object.fromEntries(Object.entries(contract).map(([key, value]) => [`mediaEmbeddingMeta.text.${key}`, value]));
  try {
    const rows = await collection.aggregate([
      { $match: { videoId: { $in: scope.allowedVideoIds }, chunkId: { $in: segments.map(r => r.chunkId) },
        ...metadata, 'mediaEmbeddingMeta.text.status': 'success',
        $expr: { $eq: [{ $size: { $cond: [{ $isArray: '$stableTextEmbedding' }, '$stableTextEmbedding', []] } }, 3072] } } },
      { $match: { $expr: { $and: [
        { $allElementsTrue: [{ $map: { input: '$stableTextEmbedding', as: 'value', in: {
          $and: [{ $isNumber: '$$value' }, { $gte: ['$$value', -1.001] }, { $lte: ['$$value', 1.001] }],
        } } }] },
        { $lte: [{ $abs: { $subtract: [{ $reduce: { input: '$stableTextEmbedding', initialValue: 0,
          in: { $cond: [{ $isNumber: '$$this' }, { $add: ['$$value', { $multiply: ['$$this', '$$this'] }] }, 1e10] },
        } }, 1] } }, 0.001] },
      ] } } },
      { $project: { _id: 0, chunkId: 1, videoId: 1, startSec: 1, endSec: 1 } },
      { $limit: expected.size + 1 },
    ], { maxTimeMS: timeoutMs, signal: AbortSignal.timeout(timeoutMs + 1000) }).toArray();
    const found = new Set();
    for (const row of rows) {
      const key = JSON.stringify([row.videoId, row.chunkId]), original = expected.get(key);
      if (!original || found.has(key) || row.startSec !== original.startSec || row.endSec !== original.endSec) {
        return { complete: false, expected: expected.size, covered: found.size, reason: 'coverage_identity_conflict' };
      }
      found.add(key);
    }
    return { complete: found.size === expected.size, expected: expected.size, covered: found.size,
      reason: found.size === expected.size ? null : 'partial_stable_text_coverage' };
  } catch {
    return { complete: false, expected: expected.size, covered: 0, reason: 'coverage_check_failed' };
  }
}

module.exports = { createIndexSnapshotReader, getAtlasIndexSnapshot: indexReader.get,
  clearMultimodalIndexCache: indexReader.clear, readStableTextCoverage };
