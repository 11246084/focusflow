'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { bootstrapRecutTrial } = require('../services/recutTrialBootstrap.service');
async function main(argv = process.argv.slice(2), { env = process.env, bootstrap = bootstrapRecutTrial } = {}) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--execute') options.execute = true;
    else if (['--input', '--target-uri-env', '--teacher-password-env', '--output'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[key] = argv[++i];
    else throw new Error('RECUT_ARGUMENT_INVALID');
  }
  if (!options['--input'] || !/^[A-Z][A-Z0-9_]*$/.test(options['--target-uri-env'] || '') || (options['--teacher-password-env'] && !/^[A-Z][A-Z0-9_]*$/.test(options['--teacher-password-env']))) throw new Error('RECUT_ARGUMENT_REQUIRED');
  const input = JSON.parse(await fs.readFile(path.resolve(options['--input']), 'utf8'));
  if (input.sourceSnapshotCache && path.extname(input.sourceSnapshotCache) !== '.json') throw new Error('RECUT_ARGUMENT_INVALID');
  const sourceSnapshotCache = input.sourceSnapshotCache ? JSON.parse(await fs.readFile(path.resolve(input.sourceSnapshotCache), 'utf8')) : undefined;
  const result = await bootstrap({ input, targetUri: env[options['--target-uri-env']], execute: options.execute === true,
    sourceSnapshotCache, password: options.execute && options['--teacher-password-env'] ? env[options['--teacher-password-env']] : undefined });
  if (options.execute && options['--output']) {
    const directory = path.resolve(options['--output']); await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'topic.json'), JSON.stringify(result.input, null, 2));
    await fs.writeFile(path.join(directory, 'bootstrap.json'), JSON.stringify(result, null, 2));
  }
  return result;
}
if (require.main === module) main().then((r) => process.stdout.write(`${JSON.stringify(r)}\n`)).catch((error) => {
  process.stderr.write(`${JSON.stringify({ code: /^RECUT_[A-Z_]+$/.test(error.code || error.message) ? error.code || error.message : 'RECUT_TRIAL_IMPORT_FAILED' })}\n`); process.exitCode = 1;
});
module.exports = { main };
