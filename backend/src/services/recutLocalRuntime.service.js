'use strict';
const { createRecutRuntimeAdapters } = require('./recutRuntimeAdapters.service');
const { createRecutLocalRepository } = require('./recutCopyRuntime.service');
const { createRecutPipeline } = require('./recutPipeline.service');
const { retryDecision, fail } = require('./recutRuntime.service');
const { validateSelection } = require('./recutSelectionValidation.service');
const prompt = require('../prompts/recutSelection');

// Native local persistence and the exact RC2/3/4 algorithms, without importing
// the application bootstrap or Mongoose configuration. Resource creation stays
// lazy until the caller explicitly runs a topic.
function createRecutLocalRuntime({ targetUri, repository, driverLoader, model, callLimit = 5, renderLocal, sourceAlgorithms, ...options } = {}) {
  const local = repository || createRecutLocalRepository({ targetUri, driverLoader });
  const adapters = createRecutRuntimeAdapters({ ...options, loadSource: local.loadSource, loadBaseVersion: local.loadBaseVersion,
    sourceOptions: { loadInputs: local.loadInputs } });
  const algorithms = () => sourceAlgorithms || require('./recutSourceAlgorithms.service');
  const sourceSteps = [
    { id: 'recut-window-v1', stage: 'sourceCheck', run: async ({ task }) => {
      const { script, video, hits, segments, cachedSource } = await local.loadInputs(task);
      let sourceWindow = algorithms().expandContinuousWindow({ hits, segments });
      if (cachedSource) {
        if (typeof options.verifyCachedSource !== 'function') throw fail('快取必須重新核對來源指紋。', 'RECUT_SOURCE_CACHE_INVALID');
        await options.verifyCachedSource(cachedSource, video.filePath);
        if (cachedSource.startSec !== sourceWindow.startSec || cachedSource.endSec !== sourceWindow.endSec) throw fail('快取視窗不符。', 'RECUT_SOURCE_CACHE_INVALID');
        sourceWindow = { ...sourceWindow, hitChunkIds: cachedSource.hitChunkIds || [], hitRanges: [], segments: cachedSource.transcriptChunks || [] };
      }
      return { topic: script.topic, sourceWindow, sourceVideoId: String(video._id), sourcePath: video.filePath, cachedSource,
        transcriptVersion: cachedSource?.transcriptVersion || video.activeTranscriptVersion || 'legacy',
        sourceSha256: cachedSource?.sourceSha256 || (options.sourceFingerprint ? await options.sourceFingerprint(video.filePath) : undefined) };
    } },
    { id: 'recut-source-check-v1', stage: 'sourceCheck', run: async ({ data, checkCancelled }) => {
      const results = algorithms().inspectProbe(await adapters.media.probe(data.sourcePath), data.sourceWindow);
      await checkCancelled(); await adapters.media.decode(data.sourcePath, data.sourceWindow); await checkCancelled();
      const audio = algorithms().calculateFixedGain(await adapters.media.measure(data.sourcePath, data.sourceWindow));
      return { sourceCheck: { passed: true, results: { ...results, decodable: true }, checkedAt: new Date() }, audio };
    } },
    { id: 'recut-window-asr-v1', stage: 'sourceCheck', run: async ({ data }) => data.cachedSource ? { rawWords: null } : {
      asrResult: require('./recutAsrNormalization.service').normalizeRecutAsrResult(await adapters.media.transcribe(data.sourcePath, data.sourceWindow), data.sourceWindow) } },
    { id: 'recut-sentences-v1', stage: 'sourceCheck', run: async ({ task, data }) => {
      const sentences = data.cachedSource?.sentences || algorithms().splitSentences(data.asrResult.words, data.sourceWindow);
      const excludedSentenceIds = data.cachedSource?.excludedSentenceIds || [
        ...(data.asrResult?.excludeFirstSentence ? [sentences[0].id] : []), ...(data.asrResult?.excludeLastSentence ? [sentences.at(-1).id] : [])];
      const source = await local.saveSource({ ...data.sourceWindow, scriptId: task.scriptId, videoId: data.sourceVideoId,
        transcriptVersion: data.transcriptVersion, transcriptChunks: data.sourceWindow.segments,
        ...(data.sourceSha256 ? { sourceSha256: data.sourceSha256 } : {}),
        asrProvenance: data.cachedSource?.asrProvenance || data.asrResult.asrProvenance, excludedSentenceIds,
        sentences, sourceCheck: data.sourceCheck, audio: data.audio });
      return { sourceId: String(source._id), sourceCheckpoint: source };
    } },
  ];
  const frozenSelectionInputs = new Map();
  const selectionStep = { id: 'recut-selection-v1', stage: 'selection', run: async (context) => {
    const source = await local.loadSource(context.data.sourceId), script = await local.loadScript(context.task.scriptId);
    if (!source || !script || String(source.scriptId) !== String(script._id)) throw fail('選段來源無效。', 'RECUT_SOURCE_INVALID');
    const sourceKey = String(source._id);
    if (!frozenSelectionInputs.has(sourceKey)) frozenSelectionInputs.set(sourceKey, structuredClone({ question: script.topic,
      variants: [...(script.sourceQuestions || [])].sort((a, b) => b.askCount - a.askCount).slice(0, 5).map(({ question, askCount }) => ({ question, askCount })),
      sentences: source.sentences.map((s) => ({ id: s.id, text: s.text, startSec: s.startSec, endSec: s.endSec, marker: s.retrievalHit ? '★' : '', words: s.words,
        ...((source.excludedSentenceIds || []).includes(s.id) ? { selectionAllowed: false, exclusionReason: '來源快照視窗邊界截斷，禁止選入' } : {}) })) }));
    const result = await retryDecision(context, { stage: 'selection', decide: adapters.decide, instructions: prompt.INSTRUCTIONS, responseSchema: prompt.responseSchema,
      input: { ...structuredClone(frozenSelectionInputs.get(sourceKey)), errors: context.data.repairIssues || [] },
      validate: (output) => {
        const result = validateSelection(source, output);
        if (result.valid && result.selection.answerable && options.gemini?.trialPolicy && (result.selection.ranges.length !== 1 || result.selection.openingSentenceId !== null)) return { valid: false, errors: ['本次試片只允許單一連續完整句範圍，不加入冷開場。'] };
        if (result.valid && result.clips.some((clip) => clip.sentenceIds.some((id) => (source.excludedSentenceIds || []).includes(id)))) return { valid: false, errors: ['不可選入已標示截斷的邊界句。'] };
        return result;
      } });
    const value = { sourceId: String(source._id), selection: result.selection, selectionResult: result, fullScript: result.fullScript, modelId: context.task.settingsSnapshot.model.model };
    if (!result.selection.answerable) value.version = { sourceId: value.sourceId, selection: result.selection, fullScript: '', plan: null, modelId: value.modelId, shortRenderVersion: 'not-rendered' };
    return value;
  } };
  const pipeline = createRecutPipeline({ ...adapters, sourceSteps, selectionStep });
  return { ...adapters, pipeline, model, callLimit, renderLocal,
    persistLocal: local.persistLocal, close: local.close,
    // RC11b reuses one frozen source and three independent first-step calls.
    async repeatSelection({ sourceId, scriptId, courseId, checkCancelled = async () => {} }) {
      const { runSingleTopicTrial } = require('./recutRuntimeTrial.service');
      const step = { ...selectionStep, run: async (context) => {
        const result = await selectionStep.run(context);
        return { ...result, version: { sourceId, selection: result.selection, fullScript: result.fullScript, plan: null } };
      } };
      return runSingleTopicTrial({ pipeline: { generate: [step] }, input: { sourceId, scriptId, courseId }, model, callLimit, allowModel: true, checkCancelled });
    },
  };
}

// Render adapter accepts explicit local source lookup and output directory.
// short_render modules and their processes are loaded only at render invocation.
function createRecutRenderAdapter({ loadSource, resolveSourcePath, outputDir, rendererLoader, renderLoader, ...renderOptions } = {}) {
  return async ({ version, checkCancelled }) => {
    if (!outputDir || typeof loadSource !== 'function' || typeof resolveSourcePath !== 'function') throw fail('本機渲染設定不足。', 'RECUT_RENDER_NOT_CONFIGURED');
    try {
      await checkCancelled();
      const source = await loadSource(version.sourceId);
      const renderer = (rendererLoader || (() => require('../../../short_render/src/plan')))();
      const rendering = (renderLoader || (() => require('../../../short_render/src/render/render')))();
      const resolution = renderer.resolvePlan(version.plan, { sentences: source.sentences, evidence: source });
      if (resolution.errors?.length || !resolution.resolved) throw new Error('invalid plan');
      const resolved = resolution.resolved;
      const sourcePath = await resolveSourcePath(source.videoId);
      const stageDir = await rendering.stageProject({ ...renderOptions, plan: version.plan, resolved, sentences: source.sentences, evidence: source, sourcePath, outDir: outputDir });
      await checkCancelled();
      const filePath = await rendering.renderProject({ ...renderOptions, plan: version.plan, resolved, stageDir, outDir: outputDir });
      await checkCancelled(); return { filePath };
    } catch (error) { throw fail('本機渲染失敗。', error.code === 'RECUT_TASK_CANCELLED' ? error.code : 'RECUT_RENDER_FAILED'); }
  };
}
module.exports = { createRecutLocalRuntime, createRecutRenderAdapter };
