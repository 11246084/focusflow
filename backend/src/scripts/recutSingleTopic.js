'use strict';
// No dotenv, implicit database connection, default model client or external tools.
const fs = require('node:fs/promises');
const path = require('node:path');
const { runSingleTopicTrial } = require('../services/recutRuntimeTrial.service');
async function main(argv = process.argv.slice(2)) {
  const flags = new Set(['--allow-model', '--render']);
  const values = new Set(['--input', '--adapter', '--output', '--target-uri']);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags.has(arg)) options[arg.slice(2)] = true;
    else if (values.has(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[arg.slice(2)] = argv[++i];
    else throw new Error('RECUT_ARGUMENT_INVALID');
  }
  if (!options['allow-model']) return runSingleTopicTrial();
  if (!options.input || !options.adapter || !options.output) throw new Error('RECUT_ARGUMENT_REQUIRED');
  const inputPath = path.resolve(options.input), adapterPath = path.resolve(options.adapter);
  if (path.extname(inputPath) !== '.json' || !['.js', '.cjs'].includes(path.extname(adapterPath))) throw new Error('RECUT_ARGUMENT_INVALID');
  const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const adapter = require(adapterPath);
  if (typeof adapter.createRuntime !== 'function') throw new Error('RECUT_ADAPTER_INVALID');
  const runtime = await adapter.createRuntime({ input });
  const result = await runSingleTopicTrial({ ...runtime, input, allowModel: true, render: Boolean(options.render), targetUri: options['target-uri'] });
  const output = path.resolve(options.output);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'plan.json'), JSON.stringify(result.version.plan, null, 2));
  await fs.writeFile(path.join(output, 'full-script.txt'), result.version.fullScript);
  await fs.writeFile(path.join(output, 'run.json'), JSON.stringify(result, null, 2));
  return { state: result.state, callsUsed: result.callsUsed, output };
}
if (require.main === module) main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
  // Provider errors may contain connection credentials. Print only stable codes.
  process.stderr.write(`${JSON.stringify({ code: /^RECUT_[A-Z_]+$/.test(error.code || error.message) ? error.code || error.message : 'RECUT_TRIAL_FAILED', stage: error.trial?.stage })}\n`);
  process.exitCode = 1;
});
module.exports = { main };
