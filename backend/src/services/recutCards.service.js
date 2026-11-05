'use strict';
const { retryDecision, fail } = require('./recutRuntime.service');
const { INSTRUCTIONS, getResponseSchema } = require('../prompts/recutCards');
const { validateSubtitleSources } = require('./recutCardsValidation.service');
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
// Model transport has one canonical copy of each selected sentence. The full
// source remains local for renderer/subtitle validation and whole-segment review.
function buildCardsInput({ source, data, renderer, base, codeCardHandler }) {
  const selected = new Set(data.selectionResult.clips.flatMap((clip) => clip.sentenceIds));
  const sentences = source.sentences.filter((sentence) => selected.has(sentence.id));
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
    errors: data.repairIssues || [], basePlan: base?.plan || null, codeAvailable: Boolean(codeCardHandler) };
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
    const result = await retryDecision(context, { decide, instructions: INSTRUCTIONS, responseSchema: getResponseSchema(renderer),
      input: buildCardsInput({ source, data, renderer, base, codeCardHandler }),
      validate: async (output) => {
        try {
          if (!object(output) || !Array.isArray(output.scenes) || !Array.isArray(output.subtitles)
            || Object.keys(output).some((key) => !['scenes', 'subtitles'].includes(key))) throw fail('配圖輸出欄位無效。');
          if (output.scenes.some((scene) => !object(scene) || Object.keys(scene).some((key) => !['id', 'from', 'to', 'component', 'params', 'cues', 'stamp'].includes(key)))
            || output.subtitles.some((subtitle) => !object(subtitle) || Object.keys(subtitle).some((key) => !['from', 'runs', 'level'].includes(key)))) throw fail('圖卡或字幕含未定義欄位，不能自行填剪接或秒數。');
          const prepared = foldTransportCues(safeClone(output));
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
          const subtitleValidation = validateSubtitleSources(candidate.plan, source, courseTerms);
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
module.exports = { createRecutCardsStep, restrictPresentation, buildCardsInput, foldTransportCues };
