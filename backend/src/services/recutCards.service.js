'use strict';
const { retryDecision, fail } = require('./recutRuntime.service');
const { INSTRUCTIONS, getResponseSchema } = require('../prompts/recutCards');
const { validateSubtitleSources } = require('./recutCardsValidation.service');
const { autoFixCardsOutput, playbackTimeline } = require('./recutCardsAutoFix.service');
const loadSourceDefault = (id) => require('../models/recutSource.model').findById(id).lean();
const loadBaseDefault = (id) => require('../models/recutVersion.model').findById(id).lean();
const safeClone = (v) => structuredClone(v);
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);

function pointer(value, path) {
  return path.split('/').slice(1).reduce((v, key) => v?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], value);
}
function setPointer(value, path, next) {
  const keys = path.split('/').slice(1).map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) throw fail('建議路徑無效。');
  const last = keys.pop(); let parent = value;
  for (const key of keys) { if (!object(parent?.[key]) && !Array.isArray(parent?.[key])) throw fail('建議路徑不存在。'); parent = parent[key]; }
  if (!parent || !Object.hasOwn(parent, last) || next === undefined) throw fail('建議路徑不存在。');
  parent[last] = safeClone(next);
}
function restrictPresentation(candidate, scope) {
  if (!scope) return candidate;
  const result = safeClone(scope.before);
  for (const path of scope.allowedPaths || []) {
    if (!(path === '/theme' || /^\/plan\/(scenes|subtitles)\/(0|[1-9]\d*)\//.test(path))) throw fail('呈現建議路徑不在允許範圍。');
    setPointer(result, path, pointer(candidate, path));
  }
  return result;
}
// The cards schema sends cues as [{key, sentenceId, text?}] to stay within
// Gemini's schema limits; the plan keeps the keyed object form.
function foldTransportCues(output) {
  if (!object(output) || !Array.isArray(output.scenes)) return output;
  const scenes = output.scenes.map((scene, index) => {
    if (!object(scene) || !Array.isArray(scene.cues)) return scene;
    const cues = {};
    for (const cue of scene.cues) {
      if (!object(cue) || Object.keys(cue).some((key) => !['key', 'sentenceId', 'text'].includes(key))
        || typeof cue.key !== 'string' || !cue.key || ['__proto__', 'constructor', 'prototype'].includes(cue.key)) throw fail(`第 ${index + 1} 張圖卡的 cues 格式無效。`);
      if (Object.hasOwn(cues, cue.key)) throw fail(`第 ${index + 1} 張圖卡的 cue「${cue.key}」重複。`);
      cues[cue.key] = { sentenceId: cue.sentenceId, ...(cue.text !== undefined ? { text: cue.text } : {}) };
    }
    return { ...scene, cues };
  });
  return { ...output, scenes };
}
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function dangerousKeyPath(value, at) {
  if (Array.isArray(value)) { for (const [i, item] of value.entries()) { const hit = dangerousKeyPath(item, `${at}[${i}]`); if (hit) return hit; } return null; }
  if (!object(value)) return null;
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) return `${at}.${key}`;
    const hit = dangerousKeyPath(value[key], `${at}.${key}`); if (hit) return hit;
  }
  return null;
}
// The cards schema sends params as {<component>: {...that component's fields}}
// so no component is offered another's fields. Fold it back to the flat plan
// form. A flat legacy params object (no component-name key holding an object)
// passes through unchanged; checkParamFields and describeComponent still validate
// the folded result strictly, so nothing is dropped here.
function foldTransportParams(output, componentNames = []) {
  if (!object(output) || !Array.isArray(output.scenes)) return output;
  const names = new Set(componentNames);
  const scenes = output.scenes.map((scene, index) => {
    if (!object(scene) || !object(scene.params)) return scene;
    const card = `第 ${index + 1} 張圖卡`;
    const danger = dangerousKeyPath(scene.params, `scenes[${index}].params`);
    if (danger) throw fail(`${card}的 params 含不允許的欄位名稱：${danger}。`);
    const keys = Object.keys(scene.params);
    const wrapped = keys.filter((key) => names.has(key) && object(scene.params[key]));
    // Any non-component key means flat (legacy) params: leave it to the strict
    // field check so a stray field gets FIELD_UNKNOWN with the allowed list.
    if (!wrapped.length || wrapped.length !== keys.length) return scene;
    if (wrapped.length !== 1 || wrapped[0] !== scene.component) {
      throw fail(`${card}（component "${scene.component}"）的 params 只能有一個與 component 同名的鍵 "${scene.component}"，收到：${Object.keys(scene.params).join(', ')}。`);
    }
    return { ...scene, params: scene.params[scene.component] };
  });
  return { ...output, scenes };
}
function foldTransportOutput(output, componentNames) {
  return foldTransportParams(foldTransportCues(output), componentNames);
}
// Model transport has one canonical copy of each selected sentence. The full
// source remains local for renderer/subtitle validation and whole-segment review.
function audibleSource(source, selectionResult) {
  const timeline = playbackTimeline(source, selectionResult);
  const trimmed = new Map(timeline?.order.map(({ id, kept }) => [id, kept]));
  return { ...source, sentences: source.sentences.map((sentence) => {
    const words = trimmed.get(sentence.id);
    if (!words || words.length === sentence.words.length) return sentence;
    return { ...sentence, words, text: words.map((w) => w.text).join(''), startSec: words[0].startSec, endSec: words.at(-1).endSec };
  }) };
}
// Initial generation may paraphrase a caption that cannot fit on screen or
// introduce an unsupported term. Use that sentence's audible words instead.
// The regular splitter, renderer and semantic review still check the result.
function groundCaptions(output, audible, courseTerms) {
  const byId = new Map(audible.sentences.map((s) => [s.id, s]));
  const replace = new Set();
  for (const sub of output.subtitles) {
    if (!Array.isArray(sub.runs) || !byId.has(sub.from?.sentenceId)) continue;
    const text = sub.runs.map((r) => r.t).join('');
    if ([...text].length > 20 || !validateSubtitleSources({ subtitles: [sub] }, audible, courseTerms).valid) replace.add(sub.from.sentenceId);
  }
  if (!replace.size) return output;
  const emitted = new Set();
  const subtitles = output.subtitles.flatMap((sub) => {
    const id = sub.from?.sentenceId;
    if (!replace.has(id)) return [sub];
    if (emitted.has(id)) return [];
    emitted.add(id);
    return [{ from: { sentenceId: id }, runs: [{ t: byId.get(id).text }] }];
  });
  return { ...output, subtitles };
}
function buildCardsInput({ source, data, renderer, base, codeCardHandler }) {
  const selected = new Set(data.selectionResult.clips.flatMap((clip) => clip.sentenceIds));
  const sentences = audibleSource(source, data.selectionResult).sentences.filter((sentence) => selected.has(sentence.id));
  if (sentences.length !== selected.size) throw fail('選段缺少完整來源句子。', 'RECUT_SOURCE_INVALID');
  const catalog = renderer.getComponentCatalog({ aiOnly: true });
  const allowed = renderer.getAllowedIcons?.() || [];
  const icons = new Set();
  const collect = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'icon' && typeof child === 'string' && allowed.includes(child)) icons.add(child);
      else if (child && typeof child === 'object') collect(child);
    }
  };
  for (const card of catalog) { try { collect(JSON.parse(card.example)); } catch {} }
  collect(data.cardsOutput); collect(base?.plan);
  for (const name of ['fluent:mobile-phone', 'fluent:round-pushpin', 'fluent:speech-balloon', 'fluent:fork-and-knife-with-plate',
    'fluent:magnifying-glass-tilted-left', 'fluent:globe-showing-asia-australia', ...allowed]) {
    if (icons.size >= 64) break; if (allowed.includes(name)) icons.add(name);
  }
  return { selection: data.selection,
    clips: data.selectionResult.clips.map(({ sentenceIds, startSec, endSec, opening }) => ({ sentenceIds, startSec, endSec, opening })),
    sentences, catalog: catalog.map(({ name, purpose, example, doNotUse, aiEnabled, fields, required, nestedFields, exampleCues }) => ({ name, purpose, example, doNotUse, aiEnabled,
      ...(fields ? { fields, required: required || [], nestedFields: nestedFields || [] } : {}), ...(exampleCues ? { exampleCues } : {}) })),
    iconAllowlist: [...icons].slice(0, 64), selectionLocked: Boolean(data.selectionLocked), adoptedSuggestions: data.adoptedSuggestions || [],
    presentationScope: data.presentationScope || null, previousOutput: data.cardsOutput || null,
    errors: data.repairIssues || [], basePlan: base?.plan || null, codeAvailable: Boolean(codeCardHandler),
    playbackSeconds: playbackSeconds(source, data.selectionResult) };
}
// 每句在成品裡實際播放的秒數（含句後停頓），讓模型第一次就照秒數分圖卡。
function playbackSeconds(source, selectionResult) {
  const timeline = playbackTimeline(source, selectionResult);
  if (!timeline) return null;
  const { order, total } = timeline;
  return Object.fromEntries(order.map((o, i) => [o.id, Math.round(((order[i + 1]?.t0 ?? total) - o.t0) * 100) / 100]));
}
function createRecutCardsStep({ decide, renderer, loadSource = loadSourceDefault, loadBaseVersion = loadBaseDefault, codeCardHandler, courseTerms = [] } = {}) {
  if (!renderer?.buildRecutPlan || !renderer?.validatePlan) throw new TypeError('Provide the RC5 renderer contract.');
  return { id: 'recut-cards-sentence-v1', stage: 'cards', run: async (context) => {
    const { task, data } = context;
    if (data.selection?.answerable === false) return {};
    const source = await loadSource(data.sourceId);
    if (!source || String(source.scriptId) !== String(task.scriptId)) throw fail('配圖來源不屬於此腳本。', 'RECUT_SOURCE_INVALID');
    const base = data.baseVersionId ? await loadBaseVersion(data.baseVersionId) : null;
    const modelId = data.modelId || task.settingsSnapshot?.model?.model;
    const audible = audibleSource(source, data.selectionResult);
    const result = await retryDecision(context, { stage: 'cards', decide, instructions: INSTRUCTIONS, responseSchema: getResponseSchema(renderer),
      input: buildCardsInput({ source, data, renderer, base, codeCardHandler }),
      validate: async (output) => {
        try {
          if (!object(output) || !Array.isArray(output.scenes) || !Array.isArray(output.subtitles)
            || Object.keys(output).some((key) => !['scenes', 'subtitles'].includes(key))) throw fail('配圖輸出欄位無效。');
          if (output.scenes.some((scene) => !object(scene) || Object.keys(scene).some((key) => !['id', 'from', 'to', 'component', 'params', 'cues', 'stamp'].includes(key)))
            || output.subtitles.some((subtitle) => !object(subtitle) || Object.keys(subtitle).some((key) => !['from', 'runs', 'level'].includes(key)))) throw fail('圖卡或字幕含未定義欄位，不能自行填剪接或秒數。');
          const catalog = renderer.getComponentCatalog({ aiOnly: false });
          let prepared = foldTransportOutput(safeClone(output), catalog.map((card) => card.name));
          for (const scene of prepared.scenes) {
            const component = catalog.find((c) => c.name === scene.component);
            for (const field of component?.fields || []) {
              if (!component.required?.includes(field) && typeof scene.params?.[field] === 'string' && !scene.params[field].trim()) delete scene.params[field];
            }
          }
          if (task.type === 'generate' && !data.selectionLocked && !data.presentationScope) {
            prepared = groundCaptions(prepared, audible, courseTerms);
          }
          // 字幕過長、圖卡秒數差一點點由程式依句子邊界修正，不再花呼叫額度。
          prepared = autoFixCardsOutput(prepared, { source, selectionResult: data.selectionResult }).output;
          for (let i = 0; i < prepared.scenes.length; i++) if (prepared.scenes[i].component === 'code') {
            if (!codeCardHandler) throw fail('程式碼圖卡必須經過畫面辨識。');
            prepared.scenes[i] = await codeCardHandler({ ...context, source, scene: prepared.scenes[i] });
          }
          const built = renderer.buildRecutPlan({ source, selectionResult: data.selectionResult, ...prepared, endCard: { seconds: 0 },
            modelId, audio: source.audio, theme: base?.theme || 'N2' });
          if (built.errors?.length) return { valid: false, errors: built.errors };
          const candidate = restrictPresentation({ plan: built.plan, theme: base?.theme || 'N2' }, data.presentationScope);
          const validation = renderer.validatePlan(candidate.plan, { sentences: source.sentences, evidence: source });
          if (!validation.valid) return validation;
          const subtitleValidation = validateSubtitleSources(candidate.plan, audible, courseTerms);
          if (!subtitleValidation.valid) return subtitleValidation;
          return { valid: true, errors: [], plan: candidate.plan, theme: candidate.theme, cardsOutput: output };
        } catch (error) {
          if (['RECUT_TASK_CANCELLED', 'RECUT_CALL_LIMIT_EXCEEDED'].includes(error.code)) throw error;
          return { valid: false, errors: [error.message] };
        }
      } });
    return { plan: result.plan, theme: result.theme, cardsOutput: result.cardsOutput, modelId };
  } };
}
module.exports = { createRecutCardsStep, restrictPresentation, buildCardsInput, foldTransportCues, foldTransportParams, foldTransportOutput };
