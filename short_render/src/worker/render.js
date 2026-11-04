'use strict';

const path = require('node:path');
const { createCommandRunner, toolEnvironment } = require('./process');
const { stageProject, renderProject } = require('../render/render');
const { ensureFontLoaded } = require('../render/browser');
const { inspectResult } = require('./checks');
const { workerError } = require('./http');

// Loaded only after an approved frozen job passed version/hash/timing checks.
// No ASR/model/API calls or generated plan substitutions belong in this adapter.
function createRenderer({ browserExecutable, fontFile, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe' }, {
  runCommand = createCommandRunner(), stage = stageProject, render = renderProject, fontCheck = ensureFontLoaded, inspect = inspectResult, environment,
} = {}) {
  if (!path.isAbsolute(browserExecutable || '') || !path.isAbsolute(fontFile || '')) throw workerError('RECUT_RENDER_CONFIG_INVALID');
  return async ({ job, resolved, sourcePath, outDir, signal }) => {
    signal.throwIfAborted();
    const execute = (binary, args, options = {}) => runCommand(binary, args, { ...options, signal });
    // RC5 gets the explicit binary through its run adapter; no discovery/download.
    const mediaCommand = (_binary, args, options) => execute(ffmpeg, args, options);
    const stageDir = await stage({ plan: job.plan, resolved, sentences: job.source.sentences, evidence: job.source,
      sourcePath, outDir, runCommand: mediaCommand, resolveFont: () => fontFile });
    signal.throwIfAborted();
    let fontLoaded = false;
    const filePath = await render({ plan: job.plan, resolved, stageDir, outDir, runCommand: mediaCommand,
      hyperframesImpl: (args, cwd) => {
        const root = path.dirname(require.resolve('hyperframes/package.json'));
        return execute(process.execPath, [path.join(root, 'bin', 'hyperframes.mjs'), ...args], {
          cwd, env: { ...toolEnvironment(environment), HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_BROWSER_PATH: browserExecutable },
        });
      },
      ensureFontLoaded: async ({ stageDir: staged }) => {
        fontLoaded = await fontCheck({ stageDir: staged, browserExecutable, signal, env: toolEnvironment(environment) });
        return fontLoaded;
      } });
    signal.throwIfAborted();
    const checks = await inspect({ filePath, fontLoaded, runCommand: execute, ffmpeg, ffprobe, signal });
    return { filePath, checks };
  };
}
module.exports = { createRenderer };
