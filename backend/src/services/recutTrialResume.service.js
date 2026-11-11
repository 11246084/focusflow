'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fail } = require('./recutRuntime.service');
const { validateSelection } = require('./recutSelectionValidation.service');

// Migration for one independently reviewed failure produced by 40f3d4b. These
// roots were captured before this fix, not supplied by an execution caller.
const REVIEWED_INCIDENT = Object.freeze({
  reportSha256: 'aed70f6899246d9f2fb318b9c97290dc8cb5781f4cbc9366dbb51d38f3478e9d',
  inputSha256: 'c7ef5519fe2edab90371aa1087de3454d5335cb7529ab2aabfa9916e7cb59b7d',
  configSha256: 'ea7404aad577b8b0296d1a7c8418ff6c5c5b8a8efe0709734fd323bd84373865',
  bootstrapSha256: '61a3b0f63e33a23d74e8a279b354a0f39f1b142a4747ca4c6d1fa8d47052c079',
  checkpointSha256: '709fd6faab1421b7f35c43ae1cdf87e9e9fe4260cabb8d0211675fe1a4fb54cb',
  providerCalls: 3, workflowCallsUsed: 4, reservedUsd: 0.1234725,
});
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toHexString === 'function') return value.toHexString().toLowerCase();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const canonicalSha256 = (value) => sha256(JSON.stringify(canonical(value)));
const same = (a, b) => canonicalSha256(a) === canonicalSha256(b);
const invalid = () => fail('續跑資料與已核准的凍結紀錄不符。', 'RECUT_TRIAL_RESUME_INVALID');
async function writeGenerationCheckpoint({ output, source, result, input, config, ticket }) {
  if (!source?.sourceSha256 || !result?.version?.plan || !result.version.selection?.answerable) throw invalid();
  const payload = { schemaVersion: 'recut-trial-generation-v1', semanticCheckPassed: true, source, result,
    executionIdentity: { inputSha256: canonicalSha256(input), configSha256: canonicalSha256(config) }, ...(ticket ? { ticket } : {}) };
  const sha256 = canonicalSha256(payload), artifact = path.join(output, 'generation-checkpoint.json');
  // Write the complete recovery artifact first; auxiliary files can be rebuilt.
  await fs.writeFile(artifact, JSON.stringify({ sha256, payload }, null, 2), { flag: 'wx' });
  for (const [file, content] of [['plan.json', JSON.stringify(result.version.plan, null, 2)],
    ['full-script.txt', result.version.fullScript], ['source.json', JSON.stringify(source, null, 2)]]) {
    await fs.writeFile(path.join(output, file), content, { flag: 'wx' });
  }
  return { sha256, artifact };
}

// Model-free recovery consumes only a verified generation. It creates a fresh
// output artifact and never grants script approval or publishes an asset.
async function executeRecutTrialRerender({ loadCheckpoint, runtimeFactory, output, targetUri, input, config } = {}) {
  const raw = await loadCheckpoint(), checkpoint = typeof raw === 'object' && !Buffer.isBuffer(raw) ? raw : JSON.parse(raw);
  const payload = checkpoint.payload;
  if (!payload || checkpoint.sha256 !== canonicalSha256(payload) || payload.schemaVersion !== 'recut-trial-generation-v1'
    || payload.semanticCheckPassed !== true || !payload.result?.version?.plan
    || payload.executionIdentity?.inputSha256 !== canonicalSha256(input) || payload.executionIdentity?.configSha256 !== canonicalSha256(config)
    || String(payload.source?.scriptId) !== input.scriptId || String(payload.result.version.sourceId) !== String(payload.source?._id)) throw invalid();
  require('./recutCliRuntime.service').assertCliTrialPolicy({ input, config, targetUri });
  const directory = path.resolve(output);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  try { await fs.mkdir(directory); } catch (error) { if (error.code === 'EEXIST') throw fail('重渲染輸出已存在。', 'RECUT_TRIAL_OUTPUT_EXISTS'); throw error; }
  let runtime;
  try {
    runtime = await runtimeFactory({ input, config, output: directory, targetUri, allowModel: false, renderOnly: true });
    if (!runtime.verifyTrialGeneration || !runtime.verifyGenerationSource || !runtime.renderLocal) throw invalid();
    const checkCancelled = async () => {
      const currentRaw = await loadCheckpoint(), current = typeof currentRaw === 'object' && !Buffer.isBuffer(currentRaw) ? currentRaw : JSON.parse(currentRaw);
      if (current.sha256 !== checkpoint.sha256 || canonicalSha256(current.payload) !== checkpoint.sha256) throw invalid();
      await runtime.verifyTrialGeneration(checkpoint); await runtime.verifyGenerationSource(payload.source);
    };
    await checkCancelled();
    const asset = await runtime.renderLocal({ version: payload.result.version, checkCancelled });
    await checkCancelled();
    const result = { ...payload.result, asset, rerenderedFrom: checkpoint.sha256, modelCallsThisRun: 0 };
    await fs.writeFile(path.join(directory, 'run.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
    return { output: directory, asset, modelCallsThisRun: 0, providerCallsUsed: result.providerCallsUsed, rerenderedFrom: checkpoint.sha256 };
  } catch (error) {
    await fs.writeFile(path.join(directory, 'run.json'), JSON.stringify({ status: 'failed', code: /^RECUT_[A-Z_]+$/.test(error.code || '') ? error.code : 'RECUT_RENDER_FAILED',
      rerenderedFrom: checkpoint.sha256, modelCallsThisRun: 0, providerCallsUsed: payload.result.providerCallsUsed,
      cumulativeBudgetReservationUsd: payload.result.cumulativeBudgetReservationUsd }, null, 2), { flag: 'wx' }).catch(() => {});
    throw error;
  } finally { await runtime?.close?.(); }
}
function prepareResumeArtifacts(artifacts, reviewed = REVIEWED_INCIDENT) {
  const parsed = {};
  try { for (const key of ['report', 'input', 'config', 'bootstrap', 'checkpoint']) parsed[key] = JSON.parse(artifacts[key]); }
  catch { throw invalid(); }
  for (const key of ['report', 'input', 'config', 'bootstrap']) if (sha256(artifacts[key]) !== reviewed[`${key}Sha256`]) throw invalid();
  if (canonicalSha256(parsed.checkpoint) !== reviewed.checkpointSha256) throw invalid();
  const { report, input, config, bootstrap, checkpoint } = parsed;
  const { assertCliTrialPolicy } = require('./recutCliRuntime.service');
  const source = checkpoint.source, policy = config.trialPolicy;
  if (!source || !policy || report.status !== 'failed' || report.stage !== 'cards' || report.code !== 'RECUT_TRIAL_REQUEST_TOO_LARGE'
    || checkpoint.runSha256.toLowerCase() !== reviewed.reportSha256 || canonicalSha256(source) !== checkpoint.sourceCanonicalSha256.toLowerCase()
    || String(source.scriptId) !== input.scriptId || String(checkpoint.script?._id) !== input.scriptId
    || String(checkpoint.budget?._id) !== input.scriptId || !same(bootstrap.input, input)
    || source.sourceSha256?.toLowerCase() !== bootstrap.sourceSnapshot?.sourceSha256?.toLowerCase()
    || source.transcriptVersion !== bootstrap.sourceSnapshot?.transcriptVersion || !source.sourceCheck?.passed
    || checkpoint.script.recut?.revision !== 0 || checkpoint.script.recut?.state !== 'idle'
    || checkpoint.script.recut?.currentVersionId || checkpoint.script.recut?.activeTaskId) throw invalid();
  const sent = report.attempts.filter((attempt) => attempt.consumesCall && attempt.trialRequest);
  let reservedUsd = 0;
  for (const [index, attempt] of sent.entries()) {
    const r = attempt.trialRequest, reservation = (r.requestBodyBytes * policy.inputPerMillion + policy.maxOutputTokens * policy.outputPerMillion) / 1e6;
    reservedUsd += reservation;
    if (attempt.stage !== 'selection' || r.trialModelCalls !== index + 1 || r.requestedModelId !== config.model.model
      || !Number.isInteger(r.requestBodyBytes) || r.requestBodyBytes < 1 || r.requestBodyBytes > policy.maxRequestBytes
      || Math.abs(r.budgetReservationUsd - reservation) > 1e-10 || Math.abs(r.cumulativeBudgetReservationUsd - reservedUsd) > 1e-10) throw invalid();
  }
  if (sent.length !== reviewed.providerCalls || report.callsUsed !== reviewed.workflowCallsUsed
    || Math.abs(reservedUsd - reviewed.reservedUsd) > 1e-10 || policy.maxCalls - sent.length !== 2) throw invalid();
  const selectionAttempt = sent.at(-1), blocked = report.attempts.find((a) => a.stage === 'cards' && a.consumesCall);
  if (selectionAttempt.status !== 'succeeded' || !selectionAttempt.validation?.valid || !blocked || blocked.trialRequest || blocked.usageMetadata
    || blocked.error?.code !== 'RECUT_TRIAL_REQUEST_TOO_LARGE' || !same(blocked.input.sentences, source.sentences)) throw invalid();
  let result;
  try { result = validateSelection(source, JSON.parse(selectionAttempt.output)); } catch { throw invalid(); }
  if (!result.valid || !result.selection.answerable || result.selection.ranges.length !== 1 || result.selection.openingSentenceId !== null) throw invalid();
  for (const key of ['selection', 'clips', 'durationSec', 'fullScript']) if (!same(result[key], selectionAttempt.validation[key])) throw invalid();
  const identity = { originalReportSha256: reviewed.reportSha256, inputSha256: reviewed.inputSha256, configSha256: reviewed.configSha256,
    bootstrapSha256: reviewed.bootstrapSha256, checkpointSha256: reviewed.checkpointSha256,
    sourceId: String(source._id), sourceCanonicalSha256: canonicalSha256(source), sourceSha256: source.sourceSha256,
    selectionSha256: canonicalSha256(result), scriptId: input.scriptId, courseId: input.courseId,
    providerCalls: sent.length, workflowCallsUsed: report.callsUsed, reservedUsd, maxAdditionalCalls: 2 };
  return { ...parsed, identity, selectionResult: result, frozenQuestion: selectionAttempt.input.question,
    frozenVariants: selectionAttempt.input.variants || [], assertPolicy: (targetUri) => assertCliTrialPolicy({ config, input, targetUri }) };
}

// Host/queue-callable service. File loading and runtime construction are explicit
// dependencies; this core never reads environment variables or parses CLI flags.
async function executeWithReviewedRoot(reviewed, { loadArtifacts, runtimeFactory, output, targetUri, allowModel = false, render = true,
} = {}) {
  const prepared = prepareResumeArtifacts(await loadArtifacts(), reviewed); prepared.assertPolicy(targetUri);
  if (!allowModel) return { dryRun: true, originalReportSha256: prepared.identity.originalReportSha256, remainingProviderCalls: 2 };
  if (typeof runtimeFactory !== 'function' || !output) throw invalid();
  const directory = path.resolve(output);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  try { await fs.mkdir(directory); } catch (error) { if (error.code === 'EEXIST') throw fail('續跑輸出已存在。', 'RECUT_TRIAL_OUTPUT_EXISTS'); throw error; }
  const ticket = { ...prepared.identity, output: directory }, ticketHash = canonicalSha256(ticket);
  const resume = { ...prepared, ticket, ticketHash };
  let runtime, completedResult, currentStage = 'prepare';
  try {
    runtime = await runtimeFactory({ input: prepared.input, config: prepared.config, output: directory, targetUri, allowModel: true, resumeCheckpoint: resume });
    for (const method of ['claimTrialResume', 'verifyTrialResume', 'verifyResumeSource', 'recordResumeGeneration']) if (typeof runtime[method] !== 'function') throw invalid();
    const checkBindings = async () => {
      const current = prepareResumeArtifacts(await loadArtifacts(), reviewed);
      if (!same(current.identity, prepared.identity)) throw invalid();
      await runtime.verifyTrialResume(); await runtime.verifyResumeSource();
    };
    // Validate source bytes and immutable files before permanently using the ticket.
    prepareResumeArtifacts(await loadArtifacts(), reviewed);
    await runtime.verifyResumeSource(); await runtime.claimTrialResume(); await checkBindings();
    if (!runtime.pipeline?.cards || !runtime.pipeline?.wholeCheck) throw invalid();
    completedResult = await require('./recutRuntimeTrial.service').runSingleTopicTrial({ ...runtime,
      pipeline: { generate: [runtime.pipeline.cards, runtime.pipeline.wholeCheck] }, input: prepared.input, allowModel: true, targetUri, render: false, persistLocal: undefined,
      onGenerationVerified: undefined,
      checkCancelled: checkBindings, resumeSeed: { providerCalls: prepared.identity.providerCalls, reservedUsd: prepared.identity.reservedUsd,
        workflowCallsUsed: prepared.identity.workflowCallsUsed, attempts: prepared.report.attempts, selectionResult: prepared.selectionResult,
        ticket: { ...ticket, ticketHash }, data: { sourceId: String(prepared.checkpoint.source._id), selection: prepared.selectionResult.selection,
          selectionResult: prepared.selectionResult, fullScript: prepared.selectionResult.fullScript, modelId: prepared.config.model.model,
          selectionLocked: false } } });
    const result = completedResult;
    currentStage = 'generation-checkpoint';
    await checkBindings();
    const { sha256: generationHash, artifact } = await writeGenerationCheckpoint({ output: directory,
      source: prepared.checkpoint.source, result, input: prepared.input, config: prepared.config, ticket: { ...ticket, ticketHash } });
    await runtime.recordResumeGeneration({ sha256: generationHash, artifact, providerCallsUsed: result.providerCallsUsed,
      workflowCallsUsed: result.workflowCallsUsed, cumulativeBudgetReservationUsd: result.cumulativeBudgetReservationUsd });
    result.generationCheckpoint = { sha256: generationHash, artifact };
    if (render) {
      currentStage = 'render';
      if (typeof runtime.renderLocal !== 'function') throw fail('缺少本機渲染轉接。', 'RECUT_RENDER_NOT_CONFIGURED');
      const started = Date.now();
      result.asset = await runtime.renderLocal({ version: result.version, checkCancelled: checkBindings });
      result.renderDurationMs = Date.now() - started;
    }
    currentStage = 'persist';
    await checkBindings();
    if (runtime.persistLocal) result.persisted = await runtime.persistLocal({ targetUri, result, input: prepared.input });
    currentStage = 'finalize';
    prepareResumeArtifacts(await loadArtifacts(), reviewed); await runtime.verifyResumeSource();
    await fs.writeFile(path.join(directory, 'run.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
    return { state: result.state, workflowCallsUsed: result.workflowCallsUsed, providerCallsUsed: result.providerCallsUsed,
      cumulativeBudgetReservationUsd: result.cumulativeBudgetReservationUsd, output: directory, ticketHash };
  } catch (error) {
    const progress = error.trial || (completedResult ? { stage: currentStage, generationCheckpoint: completedResult.generationCheckpoint, version: completedResult.version, callsUsed: completedResult.callsUsed, workflowCallsUsed: completedResult.workflowCallsUsed,
      providerCallsUsed: completedResult.providerCallsUsed, cumulativeBudgetReservationUsd: completedResult.cumulativeBudgetReservationUsd, attempts: completedResult.attempts } : {});
    const report = { status: 'failed', code: /^RECUT_[A-Z_]+$/.test(error.code || '') ? error.code : 'RECUT_TRIAL_RESUME_FAILED',
      priorWorkflowCallsUsed: prepared.identity.workflowCallsUsed, priorProviderCalls: prepared.identity.providerCalls,
      resume: { ...ticket, ticketHash }, ...progress };
    await fs.writeFile(path.join(directory, 'run.json'), JSON.stringify(report, null, 2), { flag: 'wx' }).catch(() => {});
    throw error;
  } finally { await runtime?.close?.(); }
}
// Trusted host construction is separate from execution/request options. The
// production executor always uses the reviewed registry above; callers cannot
// replace roots or ledger seeds in an execution payload.
function createRecutTrialResumeService({ reviewed = REVIEWED_INCIDENT } = {}) {
  const roots = Object.freeze({ ...reviewed });
  return { execute: (options) => executeWithReviewedRoot(roots, options) };
}
const executeRecutTrialResume = createRecutTrialResumeService().execute;
module.exports = { REVIEWED_INCIDENT, canonical, canonicalSha256, prepareResumeArtifacts, createRecutTrialResumeService, executeRecutTrialResume,
  writeGenerationCheckpoint, executeRecutTrialRerender };
