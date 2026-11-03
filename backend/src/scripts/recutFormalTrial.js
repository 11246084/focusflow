'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { runFormalTrial } = require('../services/recutFormalTrial.service');
async function main(argv = process.argv.slice(2), { env = process.env, createRuntime, onEstimate = () => {} } = {}) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (['--allow-model', '--no-render'].includes(key)) options[key] = true;
    else if (['--topics', '--runtime', '--output', '--target-uri-env', '--price'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[key] = argv[++i];
    else throw new Error('RECUT_ARGUMENT_INVALID');
  }
  if (!options['--topics']) throw new Error('RECUT_ARGUMENT_REQUIRED');
  const topics = JSON.parse(await fs.readFile(path.resolve(options['--topics']), 'utf8'));
  const price = options['--price'] ? JSON.parse(await fs.readFile(path.resolve(options['--price']), 'utf8')) : null;
  if (!options['--allow-model']) return runFormalTrial({ topics, price });
  if (!options['--runtime'] || !options['--output'] || !/^[A-Z][A-Z0-9_]*$/.test(options['--target-uri-env'] || '')) throw new Error('RECUT_ARGUMENT_REQUIRED');
  const targetUri = env[options['--target-uri-env']];
  if (require('../services/recutCliRuntime.service').isProfessorTrialTarget(targetUri)) {
    throw require('../services/recutRuntime.service').fail('教授試片授權只允許單題入口。', 'RECUT_PROFESSOR_SINGLE_TOPIC_ONLY');
  }
  const config = JSON.parse(await fs.readFile(path.resolve(options['--runtime']), 'utf8'));
  const factory = createRuntime || require('../services/recutCliRuntime.service').createCliRuntime;
  return runFormalTrial({ topics, price, targetUri, output: options['--output'], allowModel: true, render: !options['--no-render'], onEstimate,
    runtimeFactory: (args) => factory({ ...args, config, env }) });
}
if (require.main === module) main(process.argv.slice(2), { onEstimate: (result) => process.stdout.write(`${JSON.stringify(result)}\n`) })
  .then((result) => process.stdout.write(`${JSON.stringify(result.dryRun ? result : { executedAt: result.executedAt, summary: result.summary })}\n`))
  .catch((error) => { process.stderr.write(`${JSON.stringify({ code: /^RECUT_[A-Z_]+$/.test(error.code || error.message) ? error.code || error.message : 'RECUT_TRIAL_FAILED' })}\n`); process.exitCode = 1; });
module.exports = { main };
