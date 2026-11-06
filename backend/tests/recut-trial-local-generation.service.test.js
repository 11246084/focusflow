'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resumeFixture } = require('./helpers/recutTrialResumeFixtures');
const { canonicalSha256, executeRecutTrialRerender } = require('../src/services/recutTrialResume.service');
const { createCliRuntime } = require('../src/services/recutCliRuntime.service');
const { runSingleTopicTrial } = require('../src/services/recutRuntimeTrial.service');
const { createRecutPipeline } = require('../src/services/recutPipeline.service');
const renderer = require('../../short_render/src/plan');

// A trial without a paid trialPolicy (for example the 2026-11-05 OpenCV runs) must
// also freeze a trusted generation before rendering. Synthetic data only.
const localUri = 'mongodb://127.0.0.1:27131/recut_trial_opencv-20261105';
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-local-gen-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, 'media', 'source.mp4');
  await fs.mkdir(path.dirname(sourceFile)); await fs.writeFile(sourceFile, 'synthetic source');
  const f = resumeFixture({ sourcePath: sourceFile });
  delete f.state.rows.recuttrialbudgets; f.state.rows.recuttrialbudgets = [];
  const config = { geminiApiKeyEnv: 'GEMINI_API_KEY', model: { provider: 'gemini', model: 'gemini-3.8-flash' }, callLimit: 20,
    maxOutputTokens: 4096, thinkingLevel: 'LOW', codeCards: { enabled: false },
    media: { allowedRoot: path.dirname(sourceFile), ffmpeg: 'fake', ffprobe: 'fake', python: 'fake', transcriber: 'fake', asrModel: 'offline' } };
  const env = { GEMINI_API_KEY: 'synthetic-key-never-sent' };
  const runtime = (args) => createCliRuntime({ config, input: f.input, targetUri: localUri, driverLoader: f.driverLoader, env, ...args });
  return { directory, f, config, runtime };
}
const fileHashes = async (directory) => Object.fromEntries(await Promise.all((await fs.readdir(directory)).filter((n) => n.endsWith('.json') || n.endsWith('.txt'))
  .map(async (name) => [name, crypto.createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex')])));

// Runs generation with counted fake model calls and a render that fails.
async function generateWithRenderFailure({ f, runtime, output }) {
  // The output folder is deliberately not created here: the hook must create it
  // (a cached source skips the ASR workspace that used to create it as a side effect).
  const live = await runtime({ output, allowModel: true });
  const calls = [];
  const pipeline = createRecutPipeline({ renderer, loadSource: async () => f.source,
    decide: async ({ input }) => { calls.push(input.plan ? 'wholeCheck' : 'cards'); return { output: input.plan ? { issues: [] } : f.cards }; },
    sourceSteps: [{ id: 'source', stage: 'sourceCheck', run: async () => ({ sourceId: String(f.source._id), sourceCheckpoint: f.source }) }],
    selectionStep: { id: 'selection', stage: 'selection', run: async () => ({ selection: f.selection, selectionResult: f.selectionResult, fullScript: f.selectionResult.fullScript }) } });
  let error;
  try {
    await runSingleTopicTrial({ pipeline, input: f.input, model: live.model || { provider: 'gemini', model: 'gemini-3.8-flash' }, allowModel: true, render: true, targetUri: localUri,
      onGenerationVerified: live.onGenerationVerified,
      renderLocal: async () => { throw Object.assign(new Error('synthetic capture failure'), { code: 'RECUT_RENDER_FAILED' }); } });
  } catch (caught) { error = caught; } finally { await live.close(); }
  return { error, calls, checkpointPath: path.join(output, 'generation-checkpoint.json') };
}
const rerender = ({ f, config, runtime, output, loadCheckpoint, rendered, input = f.input, cfg = config }) => executeRecutTrialRerender({ output, input, config: cfg, targetUri: localUri,
  loadCheckpoint, runtimeFactory: async (args) => {
    assert.equal(args.allowModel, false); assert.equal(args.renderOnly, true);
    const live = await runtime({ ...args });
    return { ...live, renderLocal: async ({ version, checkCancelled }) => { await checkCancelled(); rendered.push(version.plan); return { filePath: path.join(args.output, 'final.mp4') }; } };
  } });

it('only non-policy, non-render-only runtimes register the local generation hook', async (t) => {
  const { directory, runtime } = await setup(t);
  const live = await runtime({ output: path.join(directory, 'a'), allowModel: true });
  const renderOnly = await runtime({ output: path.join(directory, 'b'), renderOnly: true });
  try { assert.equal(typeof live.onGenerationVerified, 'function'); assert.equal(renderOnly.onGenerationVerified, undefined); }
  finally { await live.close(); await renderOnly.close(); }
});

it('render failure, then a restarted zero-API rerender from the frozen generation; records stay intact', async (t) => {
  const { directory, f, config, runtime } = await setup(t);
  const output = path.join(directory, 'run-1');
  const generated = await generateWithRenderFailure({ f, runtime, output });
  assert.equal(generated.error.code, 'RECUT_RENDER_FAILED');
  assert.equal(generated.error.trial.generationCheckpoint.ledger, 'local');
  assert.deepEqual(generated.calls, ['cards', 'wholeCheck']);
  const checkpoint = JSON.parse(await fs.readFile(generated.checkpointPath));
  assert.equal(canonicalSha256(checkpoint.payload), checkpoint.sha256);
  const [row] = f.state.rows.recuttrialgenerations;
  assert.equal(row._id, checkpoint.sha256); assert.equal(row.status, 'verified');
  const before = { files: await fileHashes(output), row: structuredClone(row), attempts: structuredClone(checkpoint.payload.result.attempts) };

  // "Restart": a new runtime is built from scratch; only the checkpoint file and DB ledger carry over.
  const rendered = [];
  const result = await rerender({ f, config, runtime, output: path.join(directory, 'rerender-1'), loadCheckpoint: () => fs.readFile(generated.checkpointPath), rendered });
  assert.equal(result.modelCallsThisRun, 0);
  assert.equal(result.rerenderedFrom, checkpoint.sha256);
  assert.deepEqual(rendered, [checkpoint.payload.result.version.plan]);
  assert.deepEqual(generated.calls, ['cards', 'wholeCheck'], 'no selection, cards or wholeCheck calls were repeated');
  const report = JSON.parse(await fs.readFile(path.join(directory, 'rerender-1', 'run.json')));
  assert.deepEqual(report.attempts, before.attempts);
  assert.deepEqual(await fileHashes(output), before.files, 'original run artifacts unchanged');
  assert.deepEqual(f.state.rows.recuttrialgenerations, [before.row], 'ledger row unchanged by a rerender');
  await assert.rejects(rerender({ f, config, runtime, output: path.join(directory, 'rerender-1'), loadCheckpoint: () => fs.readFile(generated.checkpointPath), rendered }),
    { code: 'RECUT_TRIAL_OUTPUT_EXISTS' });
});

it('rejects stale, modified, mismatched, incomplete and unrecorded checkpoints without rendering', async (t) => {
  const { directory, f, config, runtime } = await setup(t);
  const generated = await generateWithRenderFailure({ f, runtime, output: path.join(directory, 'run-1') });
  const original = JSON.parse(await fs.readFile(generated.checkpointPath));
  const rendered = []; let n = 0;
  const reject = async (loadCheckpoint, extra = {}, code = 'RECUT_TRIAL_RESUME_INVALID') => assert.rejects(
    rerender({ f, config, runtime, output: path.join(directory, `bad-${++n}`), loadCheckpoint, rendered, ...extra }), { code });
  const variant = (mutate, rehash = true) => async () => { const cp = structuredClone(original); mutate(cp); if (rehash) cp.sha256 = canonicalSha256(cp.payload); return cp; };

  await reject(variant((cp) => { cp.payload.result.version.plan.scenes[0].params.text = 'tampered'; }, false)); // modified, hash not updated
  await reject(variant((cp) => { cp.payload.result.version.plan.scenes[0].params.text = 'tampered'; })); // modified and re-hashed: not in ledger
  await reject(variant((cp) => { delete cp.payload.result.version.plan; })); // incomplete
  await reject(variant((cp) => { cp.payload.semanticCheckPassed = false; })); // incomplete: wholeCheck not passed
  await reject(async () => original, { input: { ...f.input, scriptId: 'e'.repeat(24) } }); // mismatched input
  await reject(async () => original, { cfg: { ...config, callLimit: 30 } }); // mismatched execution config
  // Manufactured checkpoint for a run that never recorded one (e.g. historical run-6).
  const ledger = f.state.rows.recuttrialgenerations; f.state.rows.recuttrialgenerations = [];
  await reject(async () => original);
  f.state.rows.recuttrialgenerations = ledger;
  // Stale: the frozen source snapshot or the script changed after generation.
  const source = f.state.rows.recutsources[0], text = source.sentences[0].text;
  source.sentences[0].text = 'changed after generation'; await reject(async () => original); source.sentences[0].text = text;
  f.state.rows.shortscripts[0].recut.revision += 1; await reject(async () => original); f.state.rows.shortscripts[0].recut.revision -= 1;
  // Source media bytes changed.
  await fs.writeFile(f.state.rows.videos[0].filePath, 'modified source'); await reject(async () => original);
  assert.equal(rendered.length, 0);
});

it('a recorded generation cannot be recorded twice and policy scripts keep using the budget ledger', async (t) => {
  const { directory, f, runtime } = await setup(t);
  const generated = await generateWithRenderFailure({ f, runtime, output: path.join(directory, 'run-1') });
  const checkpoint = JSON.parse(await fs.readFile(generated.checkpointPath));
  const live = await runtime({ output: path.join(directory, 'again'), allowModel: true });
  const { createRecutLocalRepository } = require('../src/services/recutCopyRuntime.service');
  const repository = createRecutLocalRepository({ targetUri: localUri, driverLoader: f.driverLoader });
  try {
    await assert.rejects(repository.recordLocalGeneration({ input: f.input, source: f.source, generation: { sha256: checkpoint.sha256, artifact: 'x' } }), { code: 'RECUT_TRIAL_RESUME_ALREADY_CLAIMED' });
    f.state.rows.recuttrialbudgets.push({ _id: f.input.scriptId, status: 'reserved' });
    await assert.rejects(repository.recordLocalGeneration({ input: f.input, source: f.source, generation: { sha256: 'f'.repeat(64), artifact: 'x' } }), { code: 'RECUT_TRIAL_RESUME_INVALID' });
  } finally { await live.close(); await repository.close(); }
});

it('persisting a recovered generation marks the ledger row and keeps the run attempts', async (t) => {
  const { directory, f, runtime } = await setup(t);
  const generated = await generateWithRenderFailure({ f, runtime, output: path.join(directory, 'run-1') });
  const checkpoint = JSON.parse(await fs.readFile(generated.checkpointPath));
  const { createRecutLocalRepository } = require('../src/services/recutCopyRuntime.service');
  const repository = createRecutLocalRepository({ targetUri: localUri, driverLoader: f.driverLoader });
  try {
    const result = { ...checkpoint.payload.result, asset: { filePath: '/synthetic/final.mp4' }, generationCheckpoint: { sha256: checkpoint.sha256, ledger: 'local' } };
    const persisted = await repository.persistLocal({ result, input: f.input });
    const [row] = f.state.rows.recuttrialgenerations;
    assert.equal(row.status, 'persisted'); assert.equal(String(row.versionId), persisted.versionId);
    assert.deepEqual(f.state.rows.recuttrialruns.at(-1).attempts, checkpoint.payload.result.attempts);
    const versions = f.state.rows.recutversions.length, assets = f.state.rows.shortassets.length;
    await assert.rejects(repository.persistLocal({ result, input: f.input }), { code: 'RECUT_TRIAL_RESUME_INVALID' });
    assert.equal(f.state.rows.recutversions.length, versions, 'no partial version on a repeated persist');
    assert.equal(f.state.rows.shortassets.length, assets);
  } finally { await repository.close(); }
});

it('an output folder that already holds a checkpoint is refused before any model call; hook failures keep progress', async (t) => {
  const { directory, f, config, runtime } = await setup(t);
  const output = path.join(directory, 'run-1');
  const first = await generateWithRenderFailure({ f, runtime, output });
  assert.equal(first.error.code, 'RECUT_RENDER_FAILED');
  await assert.rejects(runtime({ output, allowModel: true }), { code: 'RECUT_TRIAL_OUTPUT_EXISTS' });
  // A ledger failure inside the hook (here: the generation is already recorded) carries
  // stage and attempts so the CLI can still write run.json with the spent calls.
  const other = path.join(directory, 'run-2');
  // Force the ledger write to fail after the model calls: a budget row means this
  // script belongs to the policy ledger, so recordLocalGeneration refuses.
  f.state.rows.recuttrialbudgets.push({ _id: f.input.scriptId, status: 'reserved' });
  const second = await generateWithRenderFailure({ f, runtime, output: other });
  assert.equal(second.error.code, 'RECUT_TRIAL_RESUME_INVALID');
  assert.equal(second.error.trial.stage, 'checkpoint');
  assert.ok(second.error.trial.attempts.some((a) => a.stage === 'cards' && a.consumesCall), 'spent calls are kept for run.json');
  assert.deepEqual(second.calls, ['cards', 'wholeCheck']);
});
