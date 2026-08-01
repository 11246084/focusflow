function normalizeKey(leaf) {
  return String(leaf?.chunkId || leaf?.segmentId || '').trim();
}

function assembleLeafContext({ leaves, maxLeaves = 15, maxCharacters = 5000 }) {
  const input = Array.isArray(leaves) ? leaves : [];
  const deduplicated = [];
  const seen = new Set();

  for (const leaf of input) {
    const key = normalizeKey(leaf);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(leaf);
  }

  const matches = [];
  let usedCharacters = 0;

  for (const leaf of deduplicated) {
    if (matches.length >= maxLeaves) break;
    const transcript = String(leaf.transcript || '').trim();
    if (!transcript) continue;

    const remaining = maxCharacters - usedCharacters;
    if (remaining <= 0) break;
    if (transcript.length > remaining && matches.length) break;
    const selectedTranscript = transcript.slice(0, remaining);

    matches.push({
      segmentId: String(leaf.segmentId || leaf.chunkId),
      chunkId: String(leaf.chunkId || leaf.segmentId),
      videoId: String(leaf.videoId),
      startSec: Number(leaf.startSec),
      endSec: Number(leaf.endSec),
      transcript: selectedTranscript,
      score: Number((Number(leaf.parentScore) || 0).toFixed(4)),
    });
    usedCharacters += selectedTranscript.length;
  }

  return {
    matches,
    diagnostics: {
      expandedLeafCount: input.length,
      deduplicatedLeafCount: deduplicated.length,
      selectedLeafCount: matches.length,
      selectedContextCharacters: usedCharacters,
      contextTruncated: matches.length < deduplicated.filter((leaf) => String(leaf.transcript || '').trim()).length,
    },
  };
}

module.exports = { assembleLeafContext };
