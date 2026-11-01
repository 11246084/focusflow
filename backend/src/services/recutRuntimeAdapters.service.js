'use strict';
const { fail } = require('./recutRuntime.service');
const path = require('node:path');

function createGeminiProvider({ apiKey, fetchImpl = global.fetch, timeoutMs = 120000, maxOutputTokens = 4096 } = {}) {
  return async ({ model, instructions, input, responseSchema, images = [] }) => {
    if (!apiKey || model?.provider !== 'gemini' || !/^[\w.-]+$/.test(model.model || '')) throw fail('模型設定不足。', 'RECUT_PROVIDER_NOT_CONFIGURED');
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 16384 || !Array.isArray(images) || images.length > 3
      || images.some((image) => !['image/png', 'image/jpeg'].includes(image?.mimeType) || typeof image.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) || image.data.length > 3 * 1024 * 1024)) throw fail('模型圖片或輸出上限無效。', 'RECUT_PROVIDER_NOT_CONFIGURED');
    try {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }, ...images.map((image) => ({ inlineData: image }))] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema, maxOutputTokens } }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error('provider');
      return { output: body.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '',
        modelId: body.modelVersion || model.model, usageMetadata: body.usageMetadata || null };
    } catch { throw fail('模型呼叫失敗。', 'RECUT_MODEL_FAILED'); }
  };
}

// Explicit paths and executor only. Construction never imports env, opens a
// client, spawns a process, downloads a model, or probes a local file.
function createRecutMediaAdapter({ run, ffmpeg, ffprobe, python, transcriber, asrModel, resolveSource, createWorkspace, removeWorkspace, readJson } = {}) {
  const missing = Object.entries({ run, ffmpeg, ffprobe, python, transcriber, asrModel, resolveSource, createWorkspace, removeWorkspace, readJson })
    .filter(([, v]) => !v).map(([key]) => `mediaConfig.${key}`);
  const call = async (binary, args, extra = {}) => {
    if (missing.length) throw fail('媒體工具設定不足。', 'RECUT_MEDIA_NOT_CONFIGURED');
    try { return await run(binary, args, { timeout: 600000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...extra }); }
    catch { throw fail('媒體工具執行失敗。', 'RECUT_MEDIA_FAILED'); }
  };
  const input = async (file, w) => ['-nostdin', '-v', 'error', '-xerror', '-ss', String(w.startSec), '-t', String(w.endSec - w.startSec), '-protocol_whitelist', 'file,pipe', '-i', await resolveSource(file)];
  return { missing,
    probe: async (file) => JSON.parse((await call(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', await resolveSource(file)])).stdout),
    decode: async (file, w) => call(ffmpeg, [...await input(file, w), '-map', '0:a:0', '-f', 'null', '-']),
    measure: async (file, w) => {
      const args = await input(file, w); args[2] = 'info';
      const { stderr } = await call(ffmpeg, [...args, '-map', '0:a:0', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
      const raw = [...String(stderr).matchAll(/\{[^{}]*"input_i"[^{}]*\}/g)].at(-1)?.[0];
      if (!raw) throw fail('音量量測無效。', 'RECUT_MEDIA_FAILED');
      const data = JSON.parse(raw); return { integratedLufs: Number(data.input_i), truePeakDbtp: Number(data.input_tp) };
    },
    transcribe: async (file, w) => {
      if (missing.length) throw fail('媒體工具設定不足。', 'RECUT_MEDIA_NOT_CONFIGURED');
      const directory = await createWorkspace();
      try {
        const wav = path.join(directory, 'window.wav'), output = path.join(directory, 'words.json');
        await call(ffmpeg, [...await input(file, w), '-vn', '-ac', '1', '-ar', '16000', wav]);
        // Offline flags prevent faster-whisper downloading missing models.
        await call(python, ['-I', transcriber, wav, output, asrModel], { env: { PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } });
        return await readJson(output);
      } finally { await removeWorkspace(directory); }
    },
  };
}

function createRecutRuntimeAdapters({ provider, gemini, media, mediaConfig, renderer, rendererLoader, codeCards,
  sourceOptions = {}, loadSource, loadBaseVersion, codeCardHandler, courseTerms = [], captureSettings, getSetting, allowModel = false } = {}) {
  const invoke = typeof provider === 'function' ? provider : provider?.generateDecision?.bind(provider);
  const decision = invoke || (gemini?.apiKey ? createGeminiProvider(gemini) : null);
  const tools = media || sourceOptions.media || (mediaConfig ? createRecutMediaAdapter(mediaConfig) : null);
  const missing = [];
  if (!decision) missing.push('provider');
  for (const key of ['probe', 'decode', 'measure', 'transcribe']) if (typeof tools?.[key] !== 'function') missing.push(`media.${key}`);
  missing.push(...(tools?.missing || []));
  // Plan methods are pure and loaded only on first use. No render process is
  // started by obtaining or registering this contract.
  let plan = renderer;
  const load = () => (plan ||= (rendererLoader || (() => require('../../../short_render/src/plan')))());
  const planMethods = ['buildRecutPlan', 'validatePlan', 'getCardsResponseSchema', 'getComponentCatalog', 'getAllowedIcons', 'resolvePlan'];
  if (renderer) for (const key of planMethods.slice(0, 4)) if (typeof renderer[key] !== 'function') missing.push(`renderer.${key}`);
  const lazyRenderer = Object.fromEntries(planMethods.map((key) => [key, (...args) => {
    if (typeof load()?.[key] !== 'function') throw fail('渲染契約設定不足。', 'RECUT_RENDER_NOT_CONFIGURED');
    return load()[key](...args);
  }]));
  const decide = async (request) => {
    if ((typeof allowModel === 'function' ? await allowModel(request) : allowModel) !== true) throw fail('尚未授權模型呼叫。', 'RECUT_MODEL_NOT_ALLOWED');
    if (!decision) throw fail('模型轉接尚未設定。', 'RECUT_PROVIDER_NOT_CONFIGURED');
    try { return await decision(request); } catch (error) {
      throw fail('模型呼叫失敗。', /^RECUT_[A-Z_]+$/.test(error.code || '') ? error.code : 'RECUT_MODEL_FAILED');
    }
  };
  const optionalMissing = [];
  if (codeCards?.enabled && !codeCardHandler) {
    const codeRuntime = require('./recutCodeRuntime.service').createRecutCodeRuntime({ ...codeCards, decide });
    if (codeRuntime.missing.length) missing.push(...codeRuntime.missing); else codeCardHandler = codeRuntime.handler;
  } else if (!codeCardHandler) optionalMissing.push('codeCards.enabled');
  const activeRenderer = renderer || lazyRenderer;
  return { decide, renderer: codeCardHandler ? require('./recutCodeRuntime.service').withRecutCodeRequests(activeRenderer) : activeRenderer,
    media: tools, sourceOptions: { ...sourceOptions, media: tools }, loadSource, loadBaseVersion,
    codeCardHandler, courseTerms, captureSettings, getSetting, missing, optionalMissing, capabilities: { codeCards: Boolean(codeCardHandler) } };
}
module.exports = { createRecutRuntimeAdapters, createGeminiProvider, createRecutMediaAdapter };
