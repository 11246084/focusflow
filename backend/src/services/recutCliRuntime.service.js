'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRecutLocalRuntime, createRecutRenderAdapter } = require('./recutLocalRuntime.service');
const { createRecutLocalRepository } = require('./recutCopyRuntime.service');
const { createRecutMediaAdapter } = require('./recutRuntimeAdapters.service');
const { fail } = require('./recutRuntime.service');

async function createCliRuntime({ config, input, output, targetUri, allowModel = false, env = process.env, driverLoader, run } = {}) {
  if (!allowModel) throw fail('尚未授權模型呼叫。', 'RECUT_MODEL_NOT_ALLOWED');
  if (!/^[A-Z][A-Z0-9_]*$/.test(config?.geminiApiKeyEnv || '')) throw fail('須指定金鑰環境變數名稱。', 'RECUT_PROVIDER_NOT_CONFIGURED');
  const repository = createRecutLocalRepository({ targetUri, driverLoader });
  if (!path.isAbsolute(config.media?.allowedRoot || '') || /^[\\/]{2}/.test(config.media.allowedRoot)) throw fail('須指定本機原片目錄。', 'RECUT_SOURCE_UNAVAILABLE');
  const root = await fs.realpath(config.media.allowedRoot);
  const resolveSource = async (file) => {
    if (!path.isAbsolute(file) || /^[\\/]{2}/.test(file)) throw fail('原片必須在本機。', 'RECUT_SOURCE_UNAVAILABLE');
    const actual = await fs.realpath(file), relative = path.relative(root, actual);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.isAbsolute(file)) throw fail('原片不在本機允許目錄。', 'RECUT_SOURCE_UNAVAILABLE');
    return actual;
  };
  const execute = run || require('node:util').promisify(require('node:child_process').execFile);
  const workspaceRoot = path.join(path.resolve(output), 'media-work');
  const workspaces = {
    createWorkspace: async () => { await fs.mkdir(workspaceRoot, { recursive: true }); return fs.mkdtemp(path.join(workspaceRoot, 'recut-')); },
    removeWorkspace: async (directory) => {
      const relative = path.relative(workspaceRoot, directory);
      if (path.isAbsolute(relative) || !/^recut-[^/\\]+$/.test(relative)) throw fail('暫存路徑無效。', 'RECUT_MEDIA_FAILED');
      await fs.rm(directory, { recursive: true, force: true });
    } };
  const media = createRecutMediaAdapter({ ...config.media, ...workspaces, run: execute, resolveSource, readJson: async (file) => JSON.parse(await fs.readFile(file, 'utf8')) });
  const renderLocal = createRecutRenderAdapter({ loadSource: repository.loadSource,
    resolveSourcePath: async (id) => resolveSource(await repository.resolveSourcePath(id)), outputDir: output,
    // RC5 only delegates FFmpeg to runCommand; use the explicit CLI binary.
    runCommand: (_binary, args, extra) => execute(config.media.ffmpeg, args, { windowsHide: true, ...extra }),
    ...(config.fontPath ? { resolveFont: () => config.fontPath } : {}),
    hyperframesImpl: async (args, cwd) => {
      if (!path.isAbsolute(config.browserExecutable || '') || /^[\\/]{2}/.test(config.browserExecutable)) throw fail('須指定已有的本機瀏覽器。', 'RECUT_RENDER_NOT_CONFIGURED');
      await fs.access(config.browserExecutable);
      const packageRoot = path.dirname(require.resolve('hyperframes/package.json', { paths: [path.resolve(__dirname, '../../../short_render')] }));
      return execute(process.execPath, [path.join(packageRoot, 'bin/hyperframes.mjs'), ...args], { cwd, windowsHide: true,
        env: { HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_BROWSER_PATH: config.browserExecutable }, timeout: 3600000, maxBuffer: 16 * 1024 * 1024 });
    },
    ensureFontLoaded: (args) => require('../../../short_render/src/render/browser').ensureFontLoaded({ ...args, browserExecutable: config.browserExecutable }) });
  const runtime = createRecutLocalRuntime({ repository, targetUri, model: input.model || config.model, callLimit: input.callLimit || config.callLimit || 5,
    gemini: { apiKey: env[config.geminiApiKeyEnv], maxOutputTokens: config.maxOutputTokens || 4096 }, media, allowModel: true, renderLocal,
    codeCards: config.codeCards?.enabled ? { enabled: true, ...workspaces, run: execute, ffmpeg: config.media.ffmpeg,
      resolveSourcePath: repository.resolveSourcePath, resolveSource, readFile: fs.readFile } : undefined });
  if (runtime.missing.length) throw fail('試產工具設定不足。', 'RECUT_STEPS_NOT_CONFIGURED');
  return runtime;
}
module.exports = { createCliRuntime };
