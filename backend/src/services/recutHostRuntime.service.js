'use strict';

const path = require('node:path');
const { fail } = require('./recutRuntime.service');

const TOOL_ENV_KEYS = ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC', 'SystemDrive'];
const localAbsolute = (value) => typeof value === 'string' && path.isAbsolute(value) && !/^[\\/]{2}/.test(value);
const inside = (root, file) => { const relative = path.relative(root, file); return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const invalid = () => fail('Recut host 設定不足。', 'RECUT_STEPS_NOT_CONFIGURED');
function isProfessorTrialNamespace(databaseUri, databaseName) {
  const decode = (value) => { try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); } };
  // Strip authority before inspecting namespaces: credentials never become a
  // reason code or log field. Check an explicit connection dbName as well.
  const suffix = String(databaseUri || '').replace(/^[^:]+:\/\/[^/]*(?:\/|$)/, '');
  const [pathname, query = ''] = suffix.split('?');
  const names = [databaseName, decode(pathname)];
  for (const [key, value] of new URLSearchParams(query)) if (/^(?:dbname|database)$/i.test(key)) names.push(decode(value));
  return names.some((name) => /^recut_trial_professor(?:[-_]|$)/i.test(String(name || '')));
}

// The host reads only an explicitly selected nonsecret JSON configuration.
// Disabled construction performs no configuration, environment or client access.
// Tool execution and provider HTTP calls remain lazy until a queued job runs.
async function createRecutHostRuntime({ enabled = false, runtimeConfigPath, databaseUri, databaseName, env = process.env, fs,
  getSetting, settingsLoader = () => require('./recutSettings.service'), run,
  runtimeFactory = (options) => require('./recutRuntimeAdapters.service').createRecutRuntimeAdapters(options),
  providerFactory = (options) => require('./recutRuntimeAdapters.service').createGeminiProvider(options),
  mediaFactory = (options) => require('./recutRuntimeAdapters.service').createRecutMediaAdapter(options),
  rendererLoader = () => require('../../../short_render/src/plan'), resolveSourcePath,
} = {}) {
  if (!enabled) return { missing: ['host.disabled'], hostStatus: 'disabled' };
  const unavailable = (reason) => ({ missing: [`host.${reason}`], hostStatus: reason });
  if (isProfessorTrialNamespace(databaseUri, databaseName)) return unavailable('professorTrialNamespace');
  if (!runtimeConfigPath) return unavailable('runtimeConfigMissing');
  let phase = 'runtimeConfigInvalid';
  try {
    if (!localAbsolute(runtimeConfigPath) || /^(?:\.env(?:\..*)?|CLAUDE\.local\.md|.*credentials.*)$/i.test(path.basename(runtimeConfigPath))) throw invalid();
    const files = fs || require('node:fs/promises');
    const configStat = await files.stat(runtimeConfigPath);
    if (!configStat.isFile() || configStat.size > 65536) throw invalid();
    const config = JSON.parse(await files.readFile(runtimeConfigPath, 'utf8'));
    const fields = ['schemaVersion', 'modelCallsEnabled', 'geminiApiKeyEnv', 'allowedGeminiModels', 'maxOutputTokens', 'thinkingLevel', 'media', 'workspaceRoot', 'codeCardsEnabled'];
    if (!config || Object.keys(config).some((key) => !fields.includes(key)) || config.schemaVersion !== 1
      || config.modelCallsEnabled !== true || !/^[A-Z][A-Z0-9_]*$/.test(config.geminiApiKeyEnv || '')
      || !Array.isArray(config.allowedGeminiModels) || !config.allowedGeminiModels.length
      || config.allowedGeminiModels.some((model) => !/^[\w.-]+$/.test(model))
      || typeof config.codeCardsEnabled !== 'boolean'
      || !Number.isInteger(config.maxOutputTokens) || config.maxOutputTokens < 128 || config.maxOutputTokens > 16384
      || (config.thinkingLevel !== undefined && !['LOW', 'MEDIUM', 'HIGH'].includes(config.thinkingLevel))) throw invalid();
    const mediaFields = ['allowedRoot', 'ffmpeg', 'ffprobe', 'python', 'transcriber', 'asrModel'];
    if (!config.media || Object.keys(config.media).some((key) => !mediaFields.includes(key))) throw invalid();
    phase = 'pathsInvalid';
    const existing = async (file, directory = false) => {
      if (!localAbsolute(file)) throw invalid();
      const actual = await files.realpath(file);
      if (!localAbsolute(actual)) throw invalid();
      const stat = await files.stat(actual);
      if (!(directory ? stat.isDirectory() : stat.isFile())) throw invalid();
      return actual;
    };
    const root = await existing(config.media.allowedRoot, true);
    const workspaceRoot = await existing(config.workspaceRoot, true);
    const tools = {};
    for (const key of ['ffmpeg', 'ffprobe', 'python', 'transcriber']) tools[key] = await existing(config.media[key]);
    // Python 虛擬環境的直譯器是指向系統 Python 的 symlink（Linux 預設）；用 realpath 執行會脫離虛擬環境、
    // 找不到 faster_whisper（2026-11-14 實測）。仍要求實際目標存在且是檔案，但以設定的路徑執行。
    tools.python = config.media.python;
    tools.asrModel = await existing(config.media.asrModel, true);
    // Keep the existing S1 settings adapter and queue snapshot as the authority.
    // The JSON allowlist is an additional deployment guard, never a model override.
    phase = 'modelNotAllowed';
    const setting = getSetting || settingsLoader().getSetting;
    const allowed = ({ model } = {}) => model?.provider === 'gemini' && config.allowedGeminiModels.includes(model.model)
      && (!config.thinkingLevel || /^gemini-[34](?:\.|-)/.test(model.model));
    if (!allowed({ model: await setting('recut.geminiModel') })) throw invalid();
    phase = 'providerKeyMissing';
    const apiKey = env[config.geminiApiKeyEnv];
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw invalid();
    const resolveSource = async (file) => {
      try { const actual = await existing(file); if (!inside(root, actual)) throw invalid(); return actual; }
      catch { throw fail('原片不在允許的本機目錄。', 'RECUT_SOURCE_UNAVAILABLE'); }
    };
    const lookup = resolveSourcePath || (async (id) => {
      const video = await require('../models/video.model').findById(id).select('filePath').lean();
      return video?.filePath;
    });
    const toolEnvironment = () => ({ ...Object.fromEntries(TOOL_ENV_KEYS.flatMap((key) =>
      typeof env[key] === 'string' ? [[key, env[key]]] : [])), PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
    });
    const execute = (binary, args, options = {}) => {
      const executor = run || require('node:util').promisify(require('node:child_process').execFile);
      return executor(binary, args, { ...options, env: toolEnvironment(), windowsHide: true });
    };
    const workspaces = {
      createWorkspace: async () => {
        // Recheck the configured root before writes to reject a replaced symlink.
        if (await existing(workspaceRoot, true) !== workspaceRoot) throw invalid();
        return files.mkdtemp(path.join(workspaceRoot, 'recut-'));
      },
      removeWorkspace: async (directory) => {
        if (!localAbsolute(directory) || !/^recut-[^/\\]+$/.test(path.relative(workspaceRoot, directory))
          || !inside(workspaceRoot, await files.realpath(directory))) throw invalid();
        await files.rm(directory, { recursive: true, force: true });
      },
    };
    phase = 'adaptersInvalid';
    const media = mediaFactory({ ...tools, ...workspaces, run: execute, resolveSource,
      readJson: async (file) => JSON.parse(await files.readFile(file, 'utf8')) });
    const provider = providerFactory({ apiKey, maxOutputTokens: config.maxOutputTokens, thinkingLevel: config.thinkingLevel });
    // RC5's plan contract is pure; MP4/browser work belongs to the separate RC7 worker.
    const renderer = rendererLoader();
    const adapters = runtimeFactory({ provider, media, renderer, getSetting: setting, allowModel: allowed,
      codeCards: config.codeCardsEnabled ? { enabled: true, ...workspaces, run: execute, ffmpeg: tools.ffmpeg,
        resolveSourcePath: lookup, resolveSource, readFile: (...args) => files.readFile(...args) } : undefined });
    return { ...adapters, hostStatus: adapters.missing?.length ? 'adaptersInvalid' : 'configured' };
  } catch {
    // Only fixed reason codes escape construction; paths, key values and provider
    // exception text must not reach HTTP details or startup logs.
    return unavailable(phase);
  }
}

module.exports = { createRecutHostRuntime };
