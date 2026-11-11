const { createHash } = require('node:crypto');
const { retrieveAtlasMultimodal } = require('./atlasMultimodalAdapter.service');
const { retrieveMultimodal } = require('./multimodalRetrieval.service');
const { candidateKey, normalizeCandidate } = require('./rankFusion.service');

function retrievalSettings({ enabled = false, mode = 'equal', hierarchy = false } = {}) {
  if (typeof enabled !== 'boolean' || typeof hierarchy !== 'boolean'
    || !['equal', 'text_weighted'].includes(mode)) throw new TypeError('Invalid retrieval settings');
  return { enabled, mode, hierarchy, k: 60 };
}

function faqEvidenceVersion(baseVersion, settings) {
  return `${baseVersion}:multimodal-v1:${createHash('sha256')
    .update(JSON.stringify(retrievalSettings(settings))).digest('hex')}`;
}

// The caller supplies authorized transcript records, never model-generated visual descriptions.
async function retrieveForQa({ scope, settings, question = '', queryEmbedding, atlas,
  searchers, textSearch, hierarchicalTextSearch, loadEvidence }) {
  const config = retrievalSettings(settings);
  if (!scope?.courseId || !Array.isArray(scope.allowedVideoIds)
    || !scope.allowedVideoIds.every(id => typeof id === 'string' && id)) {
    throw new TypeError('Authorized course and video scope required');
  }
  const allowed = new Set(scope.allowedVideoIds);
  const authorized = row => row.courseId === String(scope.courseId) && allowed.has(row.videoId)
    && (!scope.allowedChunkIds || scope.allowedChunkIds.includes(row.chunkId));
  const text = config.hierarchy ? hierarchicalTextSearch : textSearch;
  if (typeof text !== 'function' || typeof loadEvidence !== 'function') {
    throw new TypeError('Text retrieval and transcript loader required');
  }
  async function hydrate(matches) {
    const normalizeValid = rows => rows.flatMap(row => {
      try { return [normalizeCandidate(row)]; } catch { return []; }
    });
    const scoped = normalizeValid(matches).filter(authorized);
    const records = await loadEvidence(scoped, scope);
    const evidence = new Map(normalizeValid(records).filter(authorized).map(row => [candidateKey(row), row]));
    return scoped.flatMap(match => {
      const record = evidence.get(candidateKey(match));
      if (!record || record.startSec !== match.startSec || record.endSec !== match.endSec
        || typeof record.text !== 'string' || !record.text.trim()) return [];
      return [{ ...match, segmentId: record.segmentId || match.segmentId,
        text: record.text, transcript: record.text }];
    });
  }
  let result = { matches: [], diagnostics: {} };
  let fallbackReason = config.enabled ? 'empty_or_unavailable' : 'disabled';
  if (config.enabled && allowed.size) {
    try {
      if (atlas) {
        result = await retrieveAtlasMultimodal({ ...atlas, queryEmbedding, scope, mode: config.mode });
        // Hierarchy changes only the text channel; reuse the adapter's media lists.
        if (config.hierarchy) {
          const atlasResult = result;
          result = await retrieveMultimodal({ question, scope, mode: config.mode, searchers: {
            text: () => text(question, scope), audio: async () => atlasResult.lists.audio,
            visual: async () => atlasResult.lists.visual,
          } });
          result.diagnostics.atlas = atlasResult.diagnostics;
        }
      } else {
        result = await retrieveMultimodal({ question, scope, mode: config.mode,
          searchers: { ...searchers, text: () => text(question, scope) } });
      }
    } catch {
      fallbackReason = 'retrieval_failed';
    }
  }
  let matches = await hydrate(result.matches);
  let usedFallback = false;
  if (!matches.length && allowed.size) {
    usedFallback = true;
    matches = await hydrate((await text(question, scope)).map(row => ({ ...row,
      retrievedBy: ['text'], channelRanks: {}, channelScores: {}, contributions: {} })));
  }
  const citations = matches.map(({ chunkId, videoId, startSec, endSec, retrievedBy, channelRanks }) => ({
    chunkId, videoId, startSec, endSec, retrievedBy, channelRanks,
  }));
  return { matches, citations, diagnostics: result.diagnostics, usedFallback,
    fallbackReason: usedFallback ? fallbackReason : null,
    supplementalVisualEnabled: !config.enabled,
    evidenceVersion: faqEvidenceVersion('transcript-v1', config) };
}

module.exports = { retrievalSettings, faqEvidenceVersion, retrieveForQa };
