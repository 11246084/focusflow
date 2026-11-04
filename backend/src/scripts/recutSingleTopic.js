'use strict';
// No dotenv, implicit database connection, default model client or external tools.
const fs = require('node:fs/promises');
const path = require('node:path');
const { runSingleTopicTrial } = require('../services/recutRuntimeTrial.service');
const { assertLoopbackMongoTarget } = require('../services/recutRuntime.service');
async function main(argv = process.argv.slice(2), { env = process.env, createRuntime } = {}) {
  const flags = new Set(['--allow-model', '--render']);
  const values = new Set(['--input', '--adapter', '--runtime', '--output', '--target-uri', '--target-uri-env', '--resume-from', '--resume-checkpoint', '--rerender-from']);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags.has(arg)) options[arg.slice(2)] = true;
    else if (values.has(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[arg.slice(2)] = argv[++i];
    else throw new Error('RECUT_ARGUMENT_INVALID');
  }
  if (!options['allow-model'] && !options['rerender-from']) return runSingleTopicTrial();
  if (!options.input || (!options.adapter && !options.runtime) || (options.adapter && options.runtime) || !options.output) throw new Error('RECUT_ARGUMENT_REQUIRED');
  if (options['target-uri-env'] && !/^[A-Z][A-Z0-9_]*$/.test(options['target-uri-env'])) throw new Error('RECUT_ARGUMENT_INVALID');
  const inputPath = path.resolve(options.input);
  if (path.extname(inputPath) !== '.json') throw new Error('RECUT_ARGUMENT_INVALID');
  const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const targetUri = options['target-uri-env'] ? env[options['target-uri-env']] : options['target-uri'];
  if (targetUri !== undefined) assertLoopbackMongoTarget(targetUri);
  const output = path.resolve(options.output);
  let factory = createRuntime, config;
  if (options.runtime) {
    config = JSON.parse(await fs.readFile(path.resolve(options.runtime), 'utf8'));
    factory ||= require('../services/recutCliRuntime.service').createCliRuntime;
  } else if (!factory) {
    const adapterPath = path.resolve(options.adapter);
    if (!['.js', '.cjs'].includes(path.extname(adapterPath))) throw new Error('RECUT_ARGUMENT_INVALID');
    factory = require(adapterPath).createRuntime;
  }
  if (typeof factory !== 'function') throw new Error('RECUT_ADAPTER_INVALID');
  const { assertCliTrialPolicy, isProfessorTrialTarget } = require('../services/recutCliRuntime.service');
  const protectedTrial = Boolean(config?.trialPolicy) || isProfessorTrialTarget(targetUri);
  if (options['rerender-from']) {
    if (!options.runtime || options.adapter || options['resume-from'] || options['allow-model']) throw new Error('RECUT_ARGUMENT_INVALID');
    return require('../services/recutTrialResume.service').executeRecutTrialRerender({
      loadCheckpoint: () => fs.readFile(path.resolve(options['rerender-from'])), output, targetUri, input, config,
      runtimeFactory: (args) => factory({ ...args, env }),
    });
  }
  if (options['resume-from']) {
    if (!options.runtime || options.adapter || !protectedTrial) throw new Error('RECUT_TRIAL_RESUME_INVALID');
    const base = path.dirname(inputPath);
    const loadArtifacts = async () => Object.fromEntries(await Promise.all([
      ['report', path.resolve(options['resume-from'])], ['input', inputPath], ['config', path.resolve(options.runtime)],
      ['bootstrap', path.join(base, 'bootstrap.json')], ['checkpoint', path.resolve(options['resume-checkpoint'] || path.join(base, 'source-checkpoint.json'))],
    ].map(async ([key, file]) => [key, await fs.readFile(file)])));
    return require('../services/recutTrialResume.service').executeRecutTrialResume({ loadArtifacts, output, targetUri,
      allowModel: true, render: Boolean(options.render), runtimeFactory: (args) => factory({ ...args, env }) });
  }
  // Paid policy runs own a new output directory before constructing any provider.
  // Keep it after failures too: a retry must never overwrite earlier usage evidence.
  if (protectedTrial) {
    assertCliTrialPolicy({ config, input, targetUri });
    await fs.mkdir(path.dirname(output), { recursive: true });
    try { await fs.mkdir(output); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('RECUT_TRIAL_OUTPUT_EXISTS'); throw error; }
  }
  // This preflight is emitted before construction or any model invocation.
  const estimate = await runSingleTopicTrial();
  if (require.main === module) process.stdout.write(`${JSON.stringify({ ...estimate, notice: '模型授權參數已提供；以下開始執行。' })}\n`);
  const runtime = await factory({ input, config, output, targetUri, env, allowModel: true });
  let completedResult;
  try {
    if (runtime.missing?.length) throw new Error('RECUT_STEPS_NOT_CONFIGURED');
    if (protectedTrial) {
      if (typeof runtime.reserveTrialBudget !== 'function') throw new Error('RECUT_TRIAL_BUDGET_NOT_CONFIGURED');
      await runtime.reserveTrialBudget();
    }
    const result = completedResult = await runSingleTopicTrial({ ...runtime, input, allowModel: true, render: Boolean(options.render), targetUri });
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'plan.json'), JSON.stringify(result.version.plan, null, 2));
    await fs.writeFile(path.join(output, 'full-script.txt'), result.version.fullScript);
    await fs.writeFile(path.join(output, 'run.json'), JSON.stringify(result, null, 2));
    return { state: result.state, callsUsed: result.callsUsed, output, capabilities: runtime.capabilities, optionalMissing: runtime.optionalMissing };
  } catch (error) {
    const progress = error.trial || (completedResult ? { ...completedResult, stage: 'finalize' } : null);
    if (progress) {
      const report = { ...progress, status: 'failed', code: /^RECUT_[A-Z_]+$/.test(error.code || '') ? error.code : 'RECUT_TRIAL_FAILED' };
      const raw = JSON.stringify(report, null, 2);
      // Durable per-request reservations already precede HTTP. Failure of a
      // filesystem report must not prevent the independent DB evidence update.
      await fs.mkdir(output, { recursive: true }).then(() => fs.writeFile(path.join(output, 'run.json'), raw)).catch(() => {});
      if (report.checkpoint && runtime.recordTrialFailure) {
        const { canonicalSha256 } = require('../services/recutTrialResume.service');
        const requests = report.attempts.filter((a) => a.trialRequest).map((a) => a.trialRequest);
        await runtime.recordTrialFailure({ reportSha256: require('node:crypto').createHash('sha256').update(raw).digest('hex'),
          checkpointSha256: canonicalSha256(report.checkpoint), workflowCallsUsed: report.callsUsed,
          providerCallsUsed: requests.at(-1)?.trialModelCalls || 0, reservedUsd: requests.at(-1)?.cumulativeBudgetReservationUsd || 0 }).catch(() => {});
      }
    }
    throw error;
  } finally { await runtime.close?.(); }
}
if (require.main === module) main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
  // Provider errors may contain connection credentials. Print only stable codes.
  process.stderr.write(`${JSON.stringify({ code: /^RECUT_[A-Z_]+$/.test(error.code || error.message) ? error.code || error.message : 'RECUT_TRIAL_FAILED', stage: error.trial?.stage })}\n`);
  process.exitCode = 1;
});
module.exports = { main };
