'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resumeFixture, uri, sha } = require('./helpers/recutTrialResumeFixtures');
const { prepareResumeArtifacts, createRecutTrialResumeService, executeRecutTrialResume, canonicalSha256, executeRecutTrialRerender } = require('../src/services/recutTrialResume.service');
const { createRecutLocalRepository } = require('../src/services/recutCopyRuntime.service');
const { createRecutPipeline } = require('../src/services/recutPipeline.service');
const { createGeminiProvider } = require('../src/services/recutRuntimeAdapters.service');
const renderer = require('../../short_render/src/plan');
async function temp(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-resume-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
function harness(f, hooks = {}) {
  const calls = []; let persisted = 0;
  const runtimeFactory = async ({ resumeCheckpoint }) => {
    const repository = createRecutLocalRepository({ targetUri: uri, driverLoader: f.driverLoader });
    const decide = createGeminiProvider({ apiKey: 'synthetic-provider-key', trialPolicy: f.config.trialPolicy, thinkingLevel: 'LOW',
      initialUsage: { calls: resumeCheckpoint.identity.providerCalls, reservedUsd: resumeCheckpoint.identity.reservedUsd },
      onUsageReserved: (request) => repository.recordTrialReservation({ input: f.input, request, resume: resumeCheckpoint }),
      fetchImpl: async (_url, request) => {
        calls.push(JSON.parse(request.body)); await hooks.onFetch?.(calls.length);
        if (hooks.httpFailure) throw new Error('private upstream failure');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(calls.length === 1
          ? hooks.invalidCards ? { scenes: [], subtitles: [] } : f.cards : { issues: hooks.issues || [] }) }] } }] }) };
      } });
    const pipeline = createRecutPipeline({ decide, renderer, loadSource: repository.loadSource });
    return { pipeline, model: f.config.model, callLimit: 5,
      claimTrialResume: () => repository.claimTrialResume(resumeCheckpoint), verifyTrialResume: () => repository.verifyTrialResume(resumeCheckpoint),
      verifyResumeSource: async () => {}, recordResumeGeneration: (generation) => repository.recordResumeGeneration(resumeCheckpoint, generation),
      renderLocal: async () => { throw Object.assign(new Error('synthetic capture failure'), { code: 'RECUT_RENDER_FAILED' }); }, close: repository.close,
      persistLocal: async () => { persisted++; await hooks.onPersist?.(); return { versionId: 'synthetic-result' }; } };
  };
  const service = createRecutTrialResumeService({ reviewed: f.reviewed });
  return { run: (output, extra = {}) => service.execute({ loadArtifacts: async () => f.artifacts, runtimeFactory, output, targetUri: uri, allowModel: true, render: false, ...extra }),
    calls, persisted: () => persisted };
}
it('reviewed roots reject modified report, source, settings, bootstrap, input, or lowered seed before a runtime', async (t) => {
  const directory = await temp(t), f = resumeFixture();
  for (const key of Object.keys(f.artifacts)) {
    const changed = { ...f.artifacts, [key]: Buffer.concat([f.artifacts[key], Buffer.from(' ')] ) };
    // JSON formatting changes in the canonical source checkpoint alone are benign;
    // actual source content changes must fail its independently pinned root.
    if (key === 'checkpoint') { const cp = JSON.parse(changed[key]); cp.source.audio.fixedGainDb++; changed[key] = Buffer.from(JSON.stringify(cp)); }
    assert.throws(() => prepareResumeArtifacts(changed, f.reviewed), { code: 'RECUT_TRIAL_RESUME_INVALID' });
  }
  const lowered = JSON.parse(f.artifacts.report); lowered.attempts[0].trialRequest.trialModelCalls = 0;
  assert.throws(() => prepareResumeArtifacts({ ...f.artifacts, report: Buffer.from(JSON.stringify(lowered)) }, f.reviewed), { code: 'RECUT_TRIAL_RESUME_INVALID' });
  // Execution payloads cannot replace the production trusted registry.
  await assert.rejects(executeRecutTrialResume({ loadArtifacts: async () => f.artifacts, reviewed: f.reviewed, output: path.join(directory, 'untrusted'), targetUri: uri }), { code: 'RECUT_TRIAL_RESUME_INVALID' });
  assert.equal(f.state.connects(), 0);
});
it('dry-run has no DB, provider or output; resume success starts at cards and carries ordinals four/five', async (t) => {
  const directory = await temp(t), f = resumeFixture(), h = harness(f), output = path.join(directory, 'resume');
  const before = sha(f.artifacts.report);
  const dry = await h.run(output, { allowModel: false }); assert.equal(dry.dryRun, true);
  assert.equal(f.state.connects(), 0); await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  const result = await h.run(output);
  assert.equal(result.providerCallsUsed, 5); assert.equal(result.workflowCallsUsed, 6); assert.equal(h.calls.length, 2); assert.equal(h.persisted(), 1);
  const report = JSON.parse(await fs.readFile(path.join(output, 'run.json')));
  assert.deepEqual(report.attempts.filter((a) => a.trialRequest).map((a) => a.trialRequest.trialModelCalls), [1, 2, 3, 4, 5]);
  assert.equal(report.priorWorkflowCallsUsed, 4); assert.ok(report.cumulativeBudgetReservationUsd > f.reviewed.reservedUsd && report.cumulativeBudgetReservationUsd <= 0.5);
  assert.equal(JSON.parse(h.calls[0].contents[0].parts[0].text).selectionLocked, false);
  assert.equal(sha(f.artifacts.report), before);
  await assert.rejects(h.run(output), { code: 'RECUT_TRIAL_OUTPUT_EXISTS' });
  await assert.rejects(h.run(path.join(directory, 'different-output')), { code: 'RECUT_TRIAL_RESUME_ALREADY_CLAIMED' }); assert.equal(h.calls.length, 2);
});
it('two different output tickets race one atomic permanent budget claim', async (t) => {
  const directory = await temp(t), f = resumeFixture(), h = harness(f);
  const outcomes = await Promise.allSettled([h.run(path.join(directory, 'first')), h.run(path.join(directory, 'second'))]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1); assert.equal(h.calls.length, 2);
  assert.equal(f.state.rows.recuttrialbudgets[0].resumeClaimed, true);
});
for (const mutation of ['source-before', 'script-before', 'persisted', 'budget-before', 'source-during-claim']) it(`resume rejects state drift and never releases a consumed ticket: ${mutation}`, async (t) => {
  const directory = await temp(t), f = resumeFixture(), h = harness(f);
  if (mutation === 'source-before') f.state.rows.recutsources[0] = { ...f.source, endSec: 149 };
  if (mutation === 'script-before') f.state.rows.shortscripts[0].recut.revision++;
  if (mutation === 'persisted') f.state.rows.recuttrialruns.push({ scriptId: f.input.scriptId });
  if (mutation === 'budget-before') f.state.rows.recuttrialbudgets[0].budgetUsd = 1;
  if (mutation === 'source-during-claim') f.state.beforeUpdate = async () => { f.state.rows.recutsources[0] = { ...f.source, endSec: 149 }; };
  await assert.rejects(h.run(path.join(directory, mutation)), { code: 'RECUT_TRIAL_RESUME_INVALID' }); assert.equal(h.calls.length, 0);
  if (mutation === 'source-during-claim') assert.equal(f.state.rows.recuttrialbudgets[0].resumeClaimed, true);
});
for (const scenario of ['http-failure', 'invalid-cards', 'credibility-selection']) it(`remaining calls cannot skip wholeCheck or refund a failed resume: ${scenario}`, async (t) => {
  const directory = await temp(t), f = resumeFixture();
  const issues = [{ type: 'missing_reference', problem: 'synthetic missing context', proposedChange: 'remove sentence', impact: 'changes content', sentenceIds: ['s1'], presentationPaths: [], selectionChanges: [{ sentenceId: 's1', action: 'remove' }] }];
  const h = harness(f, { httpFailure: scenario === 'http-failure', invalidCards: scenario === 'invalid-cards', issues: scenario === 'credibility-selection' ? issues : [] });
  await assert.rejects(h.run(path.join(directory, 'failed'))); assert.equal(h.persisted(), 0);
  const report = JSON.parse(await fs.readFile(path.join(directory, 'failed/run.json')));
  assert.equal(report.providerCallsUsed, scenario === 'credibility-selection' ? 5 : 4); assert.equal(h.calls.length, scenario === 'credibility-selection' ? 2 : 1);
  assert.equal(f.state.rows.recuttrialbudgets[0].resumeClaimed, true);
  await assert.rejects(h.run(path.join(directory, 'retry')), { code: 'RECUT_TRIAL_RESUME_ALREADY_CLAIMED' });
});
for (const failurePoint of ['after-cards', 'final-artifact', 'final-io']) it(`failure accounting retains the latest paid progress: ${failurePoint}`, async (t) => {
  const directory = await temp(t), f = resumeFixture(), output = path.join(directory, 'failed');
  const h = harness(f, { onFetch: async (n) => {
    if (failurePoint === 'after-cards' && n === 1) f.artifacts.report = Buffer.concat([f.artifacts.report, Buffer.from(' ')]);
    if (failurePoint === 'final-io' && n === 2) await fs.writeFile(path.join(output, 'plan.json'), 'already exists');
  }, onPersist: async () => { if (failurePoint === 'final-artifact') f.artifacts.report = Buffer.concat([f.artifacts.report, Buffer.from(' ')]); } });
  await assert.rejects(h.run(output));
  const report = JSON.parse(await fs.readFile(path.join(output, 'run.json')));
  assert.equal(report.providerCallsUsed, failurePoint === 'after-cards' ? 4 : 5);
  assert.ok(report.cumulativeBudgetReservationUsd > f.reviewed.reservedUsd); assert.equal(f.state.rows.recuttrialbudgets[0].resumeClaimed, true);
});
it('raw file replacement or changed video mapping fails before a ticket/provider; missing key also precedes DB', async (t) => {
  const directory = await temp(t), file = path.join(directory, 'source.mp4'); await fs.writeFile(file, 'synthetic source');
  const f = resumeFixture({ sourcePath: file }), prepared = prepareResumeArtifacts(f.artifacts, f.reviewed);
  const config = { ...f.config, media: { allowedRoot: directory, ffmpeg: 'fake', ffprobe: 'fake', python: 'fake', transcriber: 'fake', asrModel: 'offline' } };
  const options = { config, input: f.input, output: path.join(directory, 'out'), targetUri: uri, allowModel: true,
    driverLoader: f.driverLoader, resumeCheckpoint: { ...prepared, ticket: { ...prepared.identity, output: directory }, ticketHash: 'synthetic' } };
  const { createCliRuntime } = require('../src/services/recutCliRuntime.service');
  await assert.rejects(createCliRuntime({ ...options, env: {} }), { code: 'RECUT_PROVIDER_NOT_CONFIGURED' }); assert.equal(f.state.connects(), 0);
  await fs.writeFile(file, 'different bytes');
  const runtime = await createCliRuntime({ ...options, env: { GEMINI_API_KEY: 'synthetic-only' } });
  try { await assert.rejects(runtime.verifyResumeSource(), { code: 'RECUT_TRIAL_RESUME_INVALID' }); }
  finally { await runtime.close(); }
  assert.equal(f.state.rows.recuttrialbudgets[0].resumeClaimed, undefined);
  await fs.writeFile(file, 'synthetic source'); const other = path.join(directory, 'other.mp4'); await fs.writeFile(other, 'synthetic source');
  f.state.rows.videos[0].filePath = other;
  const mapped = await createCliRuntime({ ...options, env: { GEMINI_API_KEY: 'synthetic-only' } });
  try { await assert.rejects(mapped.verifyResumeSource(), { code: 'RECUT_TRIAL_RESUME_INVALID' }); } finally { await mapped.close(); }
});
it('guard seeded at three never sends a sixth provider request', async () => {
  let count = 0;
  const f = resumeFixture(), decide = createGeminiProvider({ apiKey: 'synthetic-only', trialPolicy: f.config.trialPolicy,
    initialUsage: { calls: 3, reservedUsd: f.reviewed.reservedUsd }, fetchImpl: async () => { count++; return { ok: true, json: async () => ({}) }; } });
  const request = { model: f.config.model, input: {}, instructions: '', responseSchema: {} };
  assert.equal((await decide(request)).trialRequest.trialModelCalls, 4); assert.equal((await decide(request)).trialRequest.trialModelCalls, 5);
  await assert.rejects(decide(request), { code: 'RECUT_TRIAL_CALL_LIMIT' }); assert.equal(count, 2);
});

it('render/capture failure retains a source-bound verified generation for zero-model rerender', async (t) => {
  const directory = await temp(t), f = resumeFixture(), h = harness(f), output = path.join(directory, 'render-failed');
  await assert.rejects(h.run(output, { render: true }), { code: 'RECUT_RENDER_FAILED' });
  assert.equal(h.calls.length, 2); assert.equal(h.persisted(), 0);
  const generation = JSON.parse(await fs.readFile(path.join(output, 'generation-checkpoint.json')));
  assert.equal(canonicalSha256(generation.payload), generation.sha256);
  assert.equal(generation.payload.semanticCheckPassed, true); assert.ok(generation.payload.result.version.plan);
  assert.equal(generation.payload.result.providerCallsUsed, 5);
  assert.equal(f.state.rows.recuttrialbudgets[0].resumeGenerationSha256, generation.sha256);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'source.json'))), f.source);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'plan.json'))), generation.payload.result.version.plan);
  const report = JSON.parse(await fs.readFile(path.join(output, 'run.json')));
  assert.equal(report.providerCallsUsed, 5); assert.equal(report.stage, 'render'); assert.ok(report.generationCheckpoint);
});

it('已付ledger先於HTTP寫入，run.json I/O失敗也不遺失第4/5次額度', async (t) => {
  const directory = await temp(t), f = resumeFixture(), output = path.join(directory, 'ledger');
  const h = harness(f, { onFetch: async (n) => {
    const budget = f.state.rows.recuttrialbudgets[0];
    assert.equal(budget.providerCallsUsed, n + 3);
    assert.equal(budget.lastReservation.trialModelCalls, n + 3);
    if (n === 2) await fs.mkdir(path.join(output, 'run.json'));
  } });
  await assert.rejects(h.run(output));
  assert.equal(h.calls.length, 2);
  assert.equal(f.state.rows.recuttrialbudgets[0].providerCallsUsed, 5);
  assert.ok(f.state.rows.recuttrialbudgets[0].cumulativeBudgetReservationUsd > f.reviewed.reservedUsd);
});

it('ledger無法持久化時禁止HTTP出站且不退款或重置claim', async (t) => {
  const directory = await temp(t), f = resumeFixture();
  f.state.beforeUpdate = async (name) => {
    if (name === 'recuttrialbudgets' && f.state.rows.recuttrialbudgets[0].resumeClaimed) throw new Error('synthetic DB unavailable');
  };
  const h = harness(f);
  await assert.rejects(h.run(path.join(directory, 'failed')));
  assert.equal(h.calls.length, 0); assert.equal(f.state.rows.recuttrialbudgets[0].resumeClaimed, true);
});

it('既有paidledger不符三次種子時不可用claim降低額度', async (t) => {
  const directory = await temp(t), f = resumeFixture();
  f.state.rows.recuttrialbudgets[0].providerCallsUsed = 4;
  f.state.rows.recuttrialbudgets[0].cumulativeBudgetReservationUsd = 0.2;
  const h = harness(f);
  await assert.rejects(h.run(path.join(directory, 'failed')), { code: 'RECUT_TRIAL_RESUME_INVALID' });
  assert.equal(h.calls.length, 0); assert.equal(f.state.rows.recuttrialbudgets[0].providerCallsUsed, 4);
});

it('零模型重渲染驗證持久generation與source；偽造plan即使重算hash仍拒絕', async (t) => {
  const directory = await temp(t), f = resumeFixture(), h = harness(f), generated = path.join(directory, 'generated');
  await h.run(generated);
  const checkpointPath = path.join(generated, 'generation-checkpoint.json');
  const repository = createRecutLocalRepository({ targetUri: uri, driverLoader: f.driverLoader });
  let rendered = 0, constructed = 0;
  const run = (output, loadCheckpoint = () => fs.readFile(checkpointPath)) => executeRecutTrialRerender({ output, input: f.input,
    config: f.config, targetUri: uri, loadCheckpoint, runtimeFactory: async (options) => {
      constructed++; assert.equal(options.allowModel, false); assert.equal(options.renderOnly, true);
      return { verifyTrialGeneration: repository.verifyTrialGeneration, verifyGenerationSource: async (source) => assert.deepEqual(source, f.source),
        renderLocal: async ({ checkCancelled }) => { await checkCancelled(); rendered++; return { path: '/synthetic/capture.mp4' }; }, close: repository.close };
    } });
  const result = await run(path.join(directory, 'rerender'));
  assert.equal(result.modelCallsThisRun, 0); assert.equal(rendered, 1); assert.equal(h.calls.length, 2);
  const changed = JSON.parse(await fs.readFile(checkpointPath)); changed.payload.result.version.plan.syntheticTamper = true;
  changed.sha256 = canonicalSha256(changed.payload);
  await assert.rejects(run(path.join(directory, 'forged'), async () => changed), { code: 'RECUT_TRIAL_RESUME_INVALID' });
  assert.equal(rendered, 1);
  f.state.rows.shortscripts[0].recut.revision++;
  await assert.rejects(run(path.join(directory, 'stale')), { code: 'RECUT_TRIAL_RESUME_INVALID' });
  assert.equal(rendered, 1); assert.equal(constructed, 3);
});

it('renderOnly runtime不讀Gemini key且原片bytes改變立即阻擋', async (t) => {
  const directory = await temp(t), file = path.join(directory, 'source.mp4'); await fs.writeFile(file, 'synthetic source');
  const f = resumeFixture({ sourcePath: file }), config = { ...f.config,
    media: { allowedRoot: directory, ffmpeg: 'fake', ffprobe: 'fake', python: 'fake', transcriber: 'fake', asrModel: 'offline' } };
  const runtime = await require('../src/services/recutCliRuntime.service').createCliRuntime({ config, input: f.input,
    output: path.join(directory, 'out'), targetUri: uri, renderOnly: true, allowModel: false, driverLoader: f.driverLoader,
    env: new Proxy({}, { get(_target, key) { if (key === 'GEMINI_API_KEY') throw new Error('key must not be read'); return undefined; } }) });
  try { await runtime.verifyGenerationSource(f.source); await fs.writeFile(file, 'modified source');
    await assert.rejects(runtime.verifyGenerationSource(f.source), { code: 'RECUT_TRIAL_RESUME_INVALID' });
  } finally { await runtime.close(); }
});

it('正常新單題在source及每次paid嘗試持久進度，render前凍結完整generation', async (t) => {
  const directory = await temp(t), f = resumeFixture(), output = path.join(directory, 'normal'); await fs.mkdir(output);
  const { runSingleTopicTrial } = require('../src/services/recutRuntimeTrial.service');
  const { writeGenerationCheckpoint } = require('../src/services/recutTrialResume.service');
  const progress = [], fakes = createRecutPipeline({ renderer, loadSource: async () => f.source,
    decide: async ({ input }) => ({ output: input.plan ? { issues: [] } : f.cards }),
    sourceSteps: [{ id: 'source', stage: 'sourceCheck', run: async () => ({ sourceId: String(f.source._id), sourceCheckpoint: f.source }) }],
    selectionStep: { id: 'selection', stage: 'selection', run: async () => ({ selection: f.selection, selectionResult: f.selectionResult, fullScript: f.selectionResult.fullScript }) } });
  await assert.rejects(runSingleTopicTrial({ pipeline: fakes, input: f.input, model: f.config.model, allowModel: true,
    render: true, targetUri: uri, onProgress: async (value) => { progress.push(value); },
    onGenerationVerified: ({ result, source }) => writeGenerationCheckpoint({ output, result, source, input: f.input, config: f.config }),
    renderLocal: async () => { const cp = JSON.parse(await fs.readFile(path.join(output, 'generation-checkpoint.json')));
      assert.equal(canonicalSha256(cp.payload), cp.sha256); throw Object.assign(new Error('synthetic render'), { code: 'RECUT_RENDER_FAILED' }); },
  }), (error) => error.code === 'RECUT_RENDER_FAILED' && Boolean(error.trial.generationCheckpoint));
  assert.ok(progress.length >= 4); assert.deepEqual(progress[0].checkpoint.source, f.source);
});
