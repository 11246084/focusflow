'use strict';
const { createRecutCopyRuntime } = require('../services/recutCopyRuntime.service');
async function main(argv = process.argv.slice(2), { env = process.env, runtimeFactory = createRecutCopyRuntime } = {}) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--execute') options.execute = true;
    else if (['--source-uri-env', '--target-uri-env', '--courses'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[key] = argv[++i];
    else throw new Error('RECUT_ARGUMENT_INVALID');
  }
  if (!options['--source-uri-env'] || !options['--target-uri-env'] || !options['--courses']) throw new Error('RECUT_ARGUMENT_REQUIRED');
  for (const key of ['--source-uri-env', '--target-uri-env']) if (!/^[A-Z][A-Z0-9_]*$/.test(options[key])) throw new Error('RECUT_ARGUMENT_INVALID');
  const sourceUri = env[options['--source-uri-env']], targetUri = env[options['--target-uri-env']];
  if (!sourceUri || !targetUri) throw new Error('RECUT_CONNECTION_SETTING_REQUIRED');
  return runtimeFactory({ sourceUri, targetUri }).copy({ courseIds: options['--courses'].split(','), execute: options.execute === true });
}
if (require.main === module) main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
  process.stderr.write(`${JSON.stringify({ code: /^RECUT_[A-Z_]+$/.test(error.code || error.message) ? error.code || error.message : 'RECUT_COPY_FAILED' })}\n`); process.exitCode = 1;
});
module.exports = { main };
