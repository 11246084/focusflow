'use strict';
// No dotenv, implicit database connection, default model client or external tools.
const fs = require('node:fs/promises');
const path = require('node:path');
const { runSingleTopicTrial } = require('../services/recutRuntimeTrial.service');
const { assertLoopbackMongoTarget } = require('../services/recutRuntime.service');
async function main(argv = process.argv.slice(2), { env = process.env, createRuntime } = {}) {
  const flags = new Set(['--allow-model', '--render']);
  const values = new Set(['--input', '--adapter', '--runtime', '--output', '--target-uri', '--target-uri-env']);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags.has(arg)) options[arg.slice(2)] = true;
    else if (values.has(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[arg.slice(2)] = argv[++i];
    else throw new Error('RECUT_ARGUMENT_INVALID');
  }
  if (!options['allow-model']) return runSingleTopicTrial();
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
  // This preflight is emitted before construction or any model invocation.
  const estimate = await runSingleTopicTrial();
  if (require.main === module) process.stdout.write(`${JSON.stringify({ ...estimate, notice: '模型授權參數已提供；以下開始執行。' })}\n`);
  const runtime = await factory({ input, config, output, targetUri, env, allowModel: true });
  try {
    if (runtime.missing?.length) throw new Error('RECUT_STEPS_NOT_CONFIGURED');
    const result = await runSingleTopicTrial({ ...runtime, input, allowModel: true, render: Boolean(options.render), targetUri });
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'plan.json'), JSON.stringify(result.version.plan, null, 2));
    await fs.writeFile(path.join(output, 'full-script.txt'), result.version.fullScript);
    await fs.writeFile(path.join(output, 'run.json'), JSON.stringify(result, null, 2));
    return { state: result.state, callsUsed: result.callsUsed, output };
  } catch (error) {
    if (error.trial) {
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(path.join(output, 'run.json'), JSON.stringify({ status: 'failed', code: /^RECUT_[A-Z_]+$/.test(error.code || '') ? error.code : 'RECUT_TRIAL_FAILED', ...error.trial }, null, 2));
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
