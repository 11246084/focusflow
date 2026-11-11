const { reciprocalRankFusion, normalizeCandidate } = require('./rankFusion.service');

const GROUPS = {
  text: ['text'], audio: ['audio'], visual: ['visual'],
  text_audio: ['text', 'audio'], text_visual: ['text', 'visual'],
  all: ['text', 'audio', 'visual'],
};

// Input contains precomputed, authorized chunk rankings. No embedding calls occur here.
function buildComparisonRecords({ questionId, flat, hierarchical, scope }) {
  if (!questionId || !scope?.courseId || !Array.isArray(scope.allowedVideoIds)) {
    throw new TypeError('Question identity and authorized scope required');
  }
  const records = [];
  for (const [mode, text] of [['flat', flat.text], ['hierarchical', hierarchical.text]]) {
    for (const [group, channels] of Object.entries(GROUPS)) {
      const lists = {};
      for (const channel of channels) {
        lists[channel] = (channel === 'text' ? text : flat[channel]).map(normalizeCandidate)
          .filter(row => row.courseId === String(scope.courseId) && scope.allowedVideoIds.includes(row.videoId)
            && (!scope.allowedChunkIds || scope.allowedChunkIds.includes(row.chunkId))).slice(0, 20);
      }
      for (const weighting of ['equal', 'text_weighted']) {
        const ranked = reciprocalRankFusion(lists, {
          weights: { text: weighting === 'equal' ? 1 : 2, audio: 1, visual: 1 },
        }).slice(0, 20).map(({ chunkId, videoId, startSec, endSec }, index) => ({
          rank: index + 1, chunkId, videoId, startSec, endSec,
        }));
        records.push({ questionId, group, mode, weighting, ranked });
      }
    }
  }
  return records;
}

module.exports = { GROUPS, buildComparisonRecords };
