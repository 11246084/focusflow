const { CHANNELS, normalizeCandidate, reciprocalRankFusion } = require('./rankFusion.service');

async function retrieveMultimodal({ question, searchers, scope, mode = 'equal' }) {
  if (!['equal', 'text_weighted'].includes(mode)) throw new RangeError('Unknown fusion mode.');
  if (!scope?.courseId || !Array.isArray(scope.allowedVideoIds)) throw new TypeError('Explicit retrieval scope is required.');
  const allowedVideos = new Set(scope.allowedVideoIds.map(String));
  const diagnostics = {};
  const lists = {};
  const results = await Promise.allSettled(CHANNELS.map(async (channel) => {
    if (!searchers[channel]) return { status: 'missing', matches: [] };
    const matches = await searchers[channel](question, scope);
    if (!Array.isArray(matches)) throw new TypeError('Searcher must return candidates.');
    const scoped = matches.map(normalizeCandidate).filter((candidate) => candidate.courseId === String(scope.courseId)
      && allowedVideos.has(candidate.videoId)).slice(0, 20);
    return { status: 'success', matches: scoped };
  }));
  for (const [index, result] of results.entries()) {
    const channel = CHANNELS[index];
    const value = result.status === 'fulfilled' ? result.value : { status: 'failed', matches: [] };
    lists[channel] = value.matches;
    diagnostics[channel] = { status: value.status, count: value.matches.length };
  }
  const weights = { text: mode === 'text_weighted' ? 2 : 1, audio: 1, visual: 1 };
  return { lists, diagnostics, weights, k: 60, matches: reciprocalRankFusion(lists, { weights }) };
}

module.exports = { retrieveMultimodal };
