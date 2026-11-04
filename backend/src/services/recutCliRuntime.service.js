'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRecutLocalRuntime, createRecutRenderAdapter } = require('./recutLocalRuntime.service');
const { createRecutLocalRepository } = require('./recutCopyRuntime.service');
const { createRecutMediaAdapter } = require('./recutRuntimeAdapters.service');
const { fail } = require('./recutRuntime.service');
const { hashLocalFile, validateSnapshotCache } = require('./recutSnapshotCache.service');

const isProfessorTrialTarget = (uri) => typeof uri === 'string' && /\/recut_trial_professor-siri-[^/?]*(?:[/?]|$)/.test(uri);
function assertCliTrialPolicy({ config, input = {}, targetUri, now = new Date() }) {
  if (!config?.trialPolicy) {
    if (isProfessorTrialTarget(targetUri)) throw fail('教授試片必須提供完整核准預算政策。', 'RECUT_TRIAL_POLICY_INVALID');
    return;
  }
  const p = config.trialPolicy, model = input.model || config.model, calls = input.callLimit || config.callLimit;
  require('./recutTrialGuard.service').createRecutTrialGuard(p);
  if (!/^mongodb:\/\/127\.0\.0\.1:27029\/recut_trial_professor-siri-\d{8}$/.test(targetUri || '')) throw fail('試片資料庫不在本次允許範圍。', 'RECUT_LOCAL_DB_INVALID');
  if (config.geminiApiKeyEnv !== 'GEMINI_API_KEY' || model?.provider !== 'gemini' || model.model !== 'gemini-3.8-flash'
    || config.model?.model !== model.model || config.callLimit !== 5 || !Number.isInteger(calls) || calls < 3 || calls > 5
    || config.maxOutputTokens !== 4096 || String(config.thinkingLevel).toUpperCase() !== 'LOW' || config.codeCards?.enabled !== false
    || p.modelId !== model.model || p.maxCalls !== 5 || p.maxRequestBytes !== 100000 || p.maxOutputTokens !== 4096 || p.budgetUsd !== 0.5
    || p.inputPerMillion !== 0.75 || p.outputPerMillion !== 3.75 || p.validUntil !== '2026-12-31'
    || config.fallback || config.fallbackModel || config.fallbackModels) throw fail('試片設定與當次核准模型及預算不符。', 'RECUT_TRIAL_POLICY_INVALID');
  if (now.toISOString().slice(0, 10) > p.validUntil) throw fail('試片價目期限已過。', 'RECUT_TRIAL_POLICY_EXPIRED');
}

async function createCliRuntime({ config, input, output, targetUri, allowModel = false, env = process.env, driverLoader, run, resumeCheckpoint, renderOnly = false } = {}) {
  if (!allowModel && !renderOnly) throw fail('尚未授權模型呼叫。', 'RECUT_MODEL_NOT_ALLOWED');
  assertCliTrialPolicy({ config, input, targetUri });
  if (!/^[A-Z][A-Z0-9_]*$/.test(config?.geminiApiKeyEnv || '')) throw fail('須指定金鑰環境變數名稱。', 'RECUT_PROVIDER_NOT_CONFIGURED');
  if (!renderOnly && !env[config.geminiApiKeyEnv]) throw fail(`缺少具名環境變數：${config.geminiApiKeyEnv}`, 'RECUT_PROVIDER_NOT_CONFIGURED');
  const fixedModel = structuredClone(input.model || config.model), fixedCallLimit = input.callLimit || config.callLimit || 5;
  if (config.trialPolicy && (fixedModel?.model !== config.trialPolicy.modelId || fixedCallLimit > config.trialPolicy.maxCalls || config.codeCards?.enabled)) throw fail('本次試片模型、額度或媒體政策不符。', 'RECUT_TRIAL_POLICY_INVALID');
  const { canonicalSha256 } = require('./recutTrialResume.service');
  const checkpointIdentity = { inputSha256: canonicalSha256(input), configSha256: canonicalSha256(config), policy: config.trialPolicy || null };
  const repository = createRecutLocalRepository({ targetUri, driverLoader });
  if (!path.isAbsolute(config.media?.allowedRoot || '') || /^[\\/]{2}/.test(config.media.allowedRoot)) throw fail('須指定本機原片目錄。', 'RECUT_SOURCE_UNAVAILABLE');
  const root = await fs.realpath(config.media.allowedRoot);
  const resolveSource = async (file) => {
    if (!path.isAbsolute(file) || /^[\\/]{2}/.test(file)) throw fail('原片必須在本機。', 'RECUT_SOURCE_UNAVAILABLE');
    const actual = await fs.realpath(file), relative = path.relative(root, actual);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.isAbsolute(file)) throw fail('原片不在本機允許目錄。', 'RECUT_SOURCE_UNAVAILABLE');
    return actual;
  };
  const runTool = run || require('node:util').promisify(require('node:child_process').execFile);
  // Tools need OS paths and explicit offline/render flags, never provider keys
  // or database URIs inherited from the user's terminal.
  const toolKeys = ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC', 'SystemDrive',
    'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PYTHONUTF8', 'HF_HUB_OFFLINE',
    'TRANSFORMERS_OFFLINE', 'HYPERFRAMES_NO_TELEMETRY', 'DO_NOT_TRACK', 'HYPERFRAMES_BROWSER_PATH'];
  const toolEnvironment = (overrides = {}) => Object.fromEntries(toolKeys.flatMap((key) => {
    const value = overrides[key] ?? env[key]; return typeof value === 'string' ? [[key, value]] : [];
  }));
  const execute = (binary, args, options = {}) => runTool(binary, args, { ...options, env: toolEnvironment(options.env) });
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
    ensureFontLoaded: (args) => require('../../../short_render/src/render/browser').ensureFontLoaded({ ...args, browserExecutable: config.browserExecutable, env: toolEnvironment() }) });
  const runtime = createRecutLocalRuntime({ repository, targetUri, model: fixedModel, callLimit: fixedCallLimit,
    ...(renderOnly ? { provider: async () => { throw fail('重渲染禁止模型呼叫。', 'RECUT_MODEL_NOT_ALLOWED'); } } : {}),
    getSetting: (key) => {
      if (key === 'recut.geminiModel') return structuredClone(fixedModel);
      if (['recut.initialCallLimit', 'recut.modificationCallLimit'].includes(key)) return fixedCallLimit;
      throw new TypeError('RECUT_SETTING_INVALID');
    }, captureSettings: () => ({ model: structuredClone(fixedModel), callLimit: fixedCallLimit, initialCallLimit: fixedCallLimit, modificationCallLimit: fixedCallLimit }),
    gemini: renderOnly ? undefined : { apiKey: env[config.geminiApiKeyEnv], maxOutputTokens: config.maxOutputTokens || 4096, thinkingLevel: config.thinkingLevel,
      trialPolicy: config.trialPolicy, forbiddenValues: [root],
      ...(config.trialPolicy ? { onUsageReserved: (request) => repository.recordTrialReservation({ input, request, resume: resumeCheckpoint }) } : {}),
      ...(resumeCheckpoint ? { initialUsage: { calls: resumeCheckpoint.identity.providerCalls, reservedUsd: resumeCheckpoint.identity.reservedUsd } } : {}) }, media, allowModel: true, renderLocal,
    sourceFingerprint: async (file) => hashLocalFile(await resolveSource(file)),
    verifyCachedSource: async (source, file) => validateSnapshotCache({ ...source, window: { startSec: source.startSec, endSec: source.endSec } },
      { sourceSha256: await hashLocalFile(await resolveSource(file)), startSec: source.startSec, endSec: source.endSec }),
    codeCards: config.codeCards?.enabled ? { enabled: true, ...workspaces, run: execute, ffmpeg: config.media.ffmpeg,
      resolveSourcePath: repository.resolveSourcePath, resolveSource, readFile: fs.readFile } : undefined });
  if (runtime.missing.length) throw fail('試產工具設定不足。', 'RECUT_STEPS_NOT_CONFIGURED');
  let sourceStamp;
  const verifyResumeSource = async () => {
    if (!resumeCheckpoint) throw fail('缺少續跑來源。', 'RECUT_TRIAL_RESUME_INVALID');
    const actual = await resolveSource(await repository.resolveSourcePath(resumeCheckpoint.checkpoint.source.videoId));
    const expected = await fs.realpath(resumeCheckpoint.bootstrap.source.filePath);
    if (actual !== expected) throw fail('續跑原片對應已變更。', 'RECUT_TRIAL_RESUME_INVALID');
    const stat = await fs.stat(actual), stamp = [actual, stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join('|');
    if (!sourceStamp) {
      if ((await hashLocalFile(actual)).toLowerCase() !== resumeCheckpoint.identity.sourceSha256.toLowerCase()) throw fail('續跑原片 SHA 不符。', 'RECUT_TRIAL_RESUME_INVALID');
      const after = await fs.stat(actual);
      if (stamp !== [actual, after.size, after.mtimeMs, after.ctimeMs, after.ino].join('|')) throw fail('原片驗證期間已改變。', 'RECUT_TRIAL_RESUME_INVALID');
      sourceStamp = stamp;
    } else if (sourceStamp !== stamp) throw fail('續跑期間原片已改變。', 'RECUT_TRIAL_RESUME_INVALID');
  };
  const verifyGenerationSource = async (source) => {
    const actual = await resolveSource(await repository.resolveSourcePath(source.videoId));
    if (!source.sourceSha256 || (await hashLocalFile(actual)).toLowerCase() !== source.sourceSha256.toLowerCase()) throw fail('凍結原片 SHA 不符。', 'RECUT_TRIAL_RESUME_INVALID');
  };
  return { ...runtime, checkpointIdentity, verifyGenerationSource, verifyTrialGeneration: repository.verifyTrialGeneration,
    ...(config.trialPolicy ? { reserveTrialBudget: () => repository.reserveTrialBudget({ input, policy: config.trialPolicy, identity: checkpointIdentity }),
    onProgress: async (progress) => {
      const temporary = path.join(output, 'progress-checkpoint.tmp');
      await fs.writeFile(temporary, JSON.stringify(progress, null, 2));
      await fs.rename(temporary, path.join(output, 'progress-checkpoint.json'));
    },
    onGenerationVerified: async ({ result, source }) => {
      const generation = await require('./recutTrialResume.service').writeGenerationCheckpoint({ output, source, result, input, config });
      await repository.recordTrialGeneration({ input, source, generation });
      return generation;
    },
    recordTrialFailure: (failure) => repository.recordTrialFailure({ input, ...failure }) } : {}),
    ...(resumeCheckpoint ? {
      claimTrialResume: () => repository.claimTrialResume(resumeCheckpoint), verifyTrialResume: () => repository.verifyTrialResume(resumeCheckpoint),
      verifyResumeSource, recordResumeGeneration: (generation) => repository.recordResumeGeneration(resumeCheckpoint, generation),
      persistLocal: (args) => repository.persistLocal({ ...args, expectedRevision: resumeCheckpoint.checkpoint.script.recut.revision }),
    } : {}) };
}
module.exports = { createCliRuntime, assertCliTrialPolicy, isProfessorTrialTarget };
