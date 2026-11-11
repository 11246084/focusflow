const { resolveSelection } = require('../../src/services/recutSelectionValidation.service');
function fixture() {
  const source = { _id: 'source', scriptId: 'script', videoId: 'video', startSec: 0, endSec: 150,
    audio: { fixedGainDb: 2, integratedLufs: -18, truePeakDbtp: -4, targetLufs: -16, peakLimitDbtp: -1.5 },
    sentences: Array.from({ length: 6 }, (_, i) => ({ id: `s${i + 1}`, startSec: i * 7, endSec: i * 7 + 6,
      text: `OpenCV 是工具${i + 1}。`, words: [{ text: 'OpenCV', startSec: i * 7, endSec: i * 7 + 2 },
        { text: `是工具${i + 1}。`, startSec: i * 7 + 2, endSec: i * 7 + 6 }], retrievalHit: true, chunkIds: ['chunk1'] })) };
  const selection = { answerable: true, unanswerableReason: null, ranges: [{ from: 's1', to: 's6' }],
    sentenceLabels: source.sentences.map((s) => ({ sentenceId: s.id, label: '結論或定義' })), openingSentenceId: null, lockedSentenceIds: [] };
  const selectionResult = resolveSelection(source, selection);
  const cards = { scenes: source.sentences.map((s, i) => ({ id: `scene${i + 1}`, from: s.id, to: s.id,
    component: 'quote-reveal', params: { text: 'OpenCV' }, cues: {} })),
    subtitles: source.sentences.map((s) => ({ from: { sentenceId: s.id }, runs: [{ t: s.text }] })) };
  return { source, selection, selectionResult, cards };
}
function fakeRenderer() {
  return { getCardsResponseSchema: () => ({ type: 'OBJECT', properties: { scenes: { type: 'ARRAY' } } }), getComponentCatalog: () => [],
    buildRecutPlan: ({ source, selectionResult, scenes, subtitles, modelId, theme }) => ({ plan: { schemaVersion: 'recut-v1',
      source: { videoId: source.videoId }, clips: selectionResult.clips, scenes, subtitles, theme,
      audio: { gainDb: source.audio.fixedGainDb }, versions: { shortRender: 'fixture-renderer', modelId, assets: { fluent: 'fixture' } } }, errors: [] }),
    validatePlan: (plan) => ({ valid: !plan.scenes.some((s) => s.params.text === 'invalid'), errors: plan.scenes.some((s) => s.params.text === 'invalid') ? ['card invalid'] : [] }) };
}
function context(input = {}) {
  const f = fixture(); const attempts = [];
  const task = { _id: 'task', scriptId: 'script', callLimit: 5, callsUsed: 1, settingsSnapshot: { model: { provider: 'gemini', model: 'fake' } } };
  return { ...f, task, attempts, data: { sourceId: 'source', selection: f.selection, selectionResult: f.selectionResult, fullScript: f.selectionResult.fullScript, modelId: 'fake', ...input },
    checkCancelled: async () => {}, runAttempt: async (options) => {
      if (options.consumesCall && task.callsUsed++ >= task.callLimit) throw Object.assign(new Error('budget'), { code: 'RECUT_CALL_LIMIT_EXCEEDED' });
      const result = await options.execute(); attempts.push({ ...result, consumesCall: options.consumesCall, input: options.input });
      if (result.validation?.valid === false) throw Object.assign(new Error('validation'), { code: 'RECUT_VALIDATION_FAILED' });
      return result.output;
    } };
}
module.exports = { fixture, fakeRenderer, context };
