'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { createRecutRuntimeAdapters, createRecutMediaAdapter } = require('../src/services/recutRuntimeAdapters.service');
const { createRecutLocalRuntime, createRecutRenderAdapter } = require('../src/services/recutLocalRuntime.service');
const { runSingleTopicTrial } = require('../src/services/recutRuntimeTrial.service');
const { fixture, fakeRenderer } = require('./helpers/recutPipelineFixtures');
const media = () => ({ probe: async () => ({ streams: [{ codec_type: 'audio' }], format: { duration: 150 } }), decode: async () => {},
  measure: async () => ({ integratedLufs: -18, truePeakDbtp: -4 }), transcribe: async () => fixture().source.sentences.flatMap((s) => s.words.map((w) => ({ w: w.text, s: w.startSec, e: w.endSec }))) });
it('runtime constructor is inert, exposes missing adapters and guards each model call', async () => {
  let load = 0, calls = 0;
  const missing = createRecutRuntimeAdapters({ rendererLoader: () => { load++; return fakeRenderer(); } });
  assert.equal(load, 0); assert.deepEqual(missing.missing, ['provider', 'media.probe', 'media.decode', 'media.measure', 'media.transcribe']);
  await assert.rejects(missing.decide({}), { code: 'RECUT_MODEL_NOT_ALLOWED' });
  const locked = createRecutRuntimeAdapters({ provider: async () => { calls++; }, renderer: fakeRenderer(), media: media() });
  assert.deepEqual(locked.missing, []); await assert.rejects(locked.decide({}), { code: 'RECUT_MODEL_NOT_ALLOWED' }); assert.equal(calls, 0);
  let permitted = true;
  const runtime = createRecutRuntimeAdapters({ provider: async () => { calls++; return { output: {} }; }, allowModel: () => permitted });
  await runtime.decide({}); permitted = false; await assert.rejects(runtime.decide({}), { code: 'RECUT_MODEL_NOT_ALLOWED' }); assert.equal(calls, 1);
});
it('Gemini adapter uses explicit key only at invocation and never returns provider errors containing URI', async () => {
  let request;
  const runtime = createRecutRuntimeAdapters({ gemini: { apiKey: 'test-key', fetchImpl: async (...args) => { request = args; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }], usageMetadata: { totalTokenCount: 3 } }) }; } }, allowModel: true });
  assert.equal(request, undefined);
  const result = await runtime.decide({ model: { provider: 'gemini', model: 'fake-model' }, instructions: 'x', input: {}, responseSchema: {} });
  assert.equal(result.output, '{}'); assert.equal(request[1].headers['x-goog-api-key'], 'test-key');
  const bad = createRecutRuntimeAdapters({ provider: async () => { throw new Error('mongodb+srv://secret:p@private/db'); }, allowModel: true });
  await assert.rejects(bad.decide({}), (e) => e.code === 'RECUT_MODEL_FAILED' && !JSON.stringify(e).includes('mongodb'));
});
it('explicit media adapter preserves RC2 signatures and forces offline ASR', async () => {
  const calls = []; let clean = false;
  const adapter = createRecutMediaAdapter({ run: async (...args) => { calls.push(args); return { stdout: '{}', stderr: '{"input_i":"-18","input_tp":"-4"}' }; },
    ffmpeg: 'fake-ffmpeg', ffprobe: 'fake-probe', python: 'fake-python', transcriber: 'fake-transcriber', asrModel: 'local-model', resolveSource: async (s) => s,
    createWorkspace: async () => 'D:/fake', removeWorkspace: async () => { clean = true; }, readJson: async () => [{ w: 'x', s: 0, e: 1 }] });
  assert.deepEqual(adapter.missing, []); assert.equal(calls.length, 0);
  await adapter.probe('D:/source'); await adapter.decode('D:/source', { startSec: 1, endSec: 5 });
  assert.deepEqual(await adapter.measure('D:/source', { startSec: 1, endSec: 5 }), { integratedLufs: -18, truePeakDbtp: -4 });
  await adapter.transcribe('D:/source', { startSec: 1, endSec: 5 });
  assert.equal(calls.at(-1)[2].env.HF_HUB_OFFLINE, '1'); assert.equal(clean, true);
});
it('native local runtime follows actual RC2→RC3→RC4 and persists RC8 version plus rendered asset', async () => {
  const f = fixture(), order = []; const selection = { ...f.selection }; delete selection.lockedSentenceIds;
  let stored, topic = 'OpenCV', responses = [selection, f.cards, { issues: [] }]; const questions = [];
  const repository = { loadInputs: async (task) => { assert.equal(task.courseId, 'course'); order.push('inputs'); return { script: { topic: 'OpenCV' }, video: { _id: 'video', filePath: 'fake.mp4' },
    hits: [{ chunkId: 'c1', videoId: 'video', startSec: 0, endSec: 30 }], segments: Array.from({ length: 5 }, (_, i) => ({ chunkId: `c${i + 1}`, videoId: 'video', startSec: i * 30, endSec: (i + 1) * 30 })) }; },
    saveSource: async (row) => { stored = { ...row, _id: 'source' }; assert.equal(row.transcriptVersion, 'legacy'); order.push('source'); return stored; },
    loadSource: async () => stored, loadScript: async () => ({ _id: 'script', topic }), loadBaseVersion: async () => null,
    persistLocal: async ({ input, result }) => { order.push('persist'); assert.equal(input.courseId, 'course'); assert.equal(result.version.sourceId, 'source'); assert.equal(result.asset.filePath, 'fake.mp4'); return { versionId: 'version', assetId: 'asset' }; }, close: async () => {} };
  const runtime = createRecutLocalRuntime({ repository, model: { provider: 'gemini', model: 'fake' }, media: media(), renderer: fakeRenderer(), allowModel: true,
    provider: async ({ input }) => { if (input.question) questions.push(input.question); order.push(`model${4 - responses.length}`); return { output: responses.shift(), usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }; },
    renderLocal: async () => { order.push('render'); return { filePath: 'fake.mp4' }; } });
  const result = await runSingleTopicTrial({ ...runtime, input: { scriptId: 'script', courseId: 'course' }, targetUri: 'mongodb://127.0.0.1:27131/trial', allowModel: true, render: true });
  assert.deepEqual(order, ['inputs', 'source', 'model1', 'model2', 'model3', 'render', 'persist']);
  assert.equal(result.callsUsed, 3); assert.equal(result.state, 'script_review'); assert.equal(result.persisted.versionId, 'version');
  assert.equal(result.attempts.filter((a) => a.consumesCall).length, 3); assert.ok(result.renderDurationMs >= 0);
  topic = 'changed after first run'; responses = [selection, selection];
  await runtime.repeatSelection({ sourceId: 'source', scriptId: 'script', courseId: 'course' });
  await runtime.repeatSelection({ sourceId: 'source', scriptId: 'script', courseId: 'course' });
  assert.deepEqual(questions, ['OpenCV', 'OpenCV', 'OpenCV']);
});
it('render adapter remains lazy, validates resolution, and stops if staging fails', async () => {
  const order = [];
  const render = createRecutRenderAdapter({ outputDir: 'D:/fake', loadSource: async () => ({ videoId: 'video', sentences: [] }), resolveSourcePath: async () => 'fake.mp4',
    rendererLoader: () => ({ resolvePlan: () => ({ resolved: { total: 40 }, errors: [] }) }), renderLoader: () => ({ stageProject: async () => { order.push('stage'); throw new Error('mongodb://private'); }, renderProject: async () => { order.push('render'); } }) });
  assert.deepEqual(order, []); await assert.rejects(render({ version: { sourceId: 'source', plan: {} }, checkCancelled: async () => {} }), { code: 'RECUT_RENDER_FAILED' });
  assert.deepEqual(order, ['stage']);
});
it('real RC5 plan resolver feeds unwrapped clips into fake staging and rendering', async () => {
  const renderer = require('../../short_render/src/plan'), f = fixture(), order = [];
  const { plan, errors } = renderer.buildRecutPlan({ source: f.source, selectionResult: f.selectionResult, ...f.cards, endCard: { seconds: 0 }, modelId: 'fake', audio: f.source.audio, theme: 'N2' });
  assert.deepEqual(errors, []);
  const adapter = createRecutRenderAdapter({ outputDir: 'D:/fake', loadSource: async () => f.source, resolveSourcePath: async () => 'D:/fake/source.mp4',
    rendererLoader: () => renderer, renderLoader: () => ({ stageProject: async ({ resolved, sourcePath }) => { assert.ok(resolved.clips.length); assert.ok(resolved.total > 30); assert.equal(sourcePath, 'D:/fake/source.mp4'); order.push('stage'); return 'D:/fake/stage'; },
      renderProject: async ({ resolved, stageDir }) => { assert.ok(resolved.clips.length); assert.equal(stageDir, 'D:/fake/stage'); order.push('render'); return 'D:/fake/final.mp4'; } }) });
  assert.deepEqual(await adapter({ version: { sourceId: 'source', plan }, checkCancelled: async () => {} }), { filePath: 'D:/fake/final.mp4' });
  assert.deepEqual(order, ['stage', 'render']);
});
