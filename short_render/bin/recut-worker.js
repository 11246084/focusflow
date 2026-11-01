#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createWorker } = require('../src/worker/client');
const USAGE = `recut-worker --config <absolute-config.cjs> [--once]
Config exports backendUrl, getWorkerKey(), workRoot, browserExecutable, fontFile.
Dedicated worker key only; config is local and must not be checked into Git.
No work is accepted without explicit config. Ctrl+C cancels the active lease.
`;
async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || !argv.length) { console.log(USAGE); return; }
  const args = argv.filter((arg) => arg !== '--once');
  if (args.length !== 2 || args[0] !== '--config' || !path.isAbsolute(args[1])) throw new Error('RECUT_CONFIG_REQUIRED');
  // User-selected trusted local module injects the key; never scan env or credential files.
  const config = require(args[1]);
  const worker = createWorker(config);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const onStatus = (result) => console.log(JSON.stringify(result));
    const result = argv.includes('--once') ? await worker.runOnce({ signal: controller.signal })
      : await worker.run({ signal: controller.signal, onStatus });
    onStatus(result);
    if (['failed', 'cancelled'].includes(result.status) || result.code) process.exitCode = 1;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (require.main === module) main().catch(() => { console.error('RECUT_WORKER_START_FAILED: check the explicit local config.'); process.exitCode = 2; });
module.exports = { main };
