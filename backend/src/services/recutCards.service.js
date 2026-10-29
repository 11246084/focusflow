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
      input: { selection: data.selection, clips: data.selectionResult.clips, sentences: source.sentences,
        catalog: renderer.getComponentCatalog({ aiOnly: true }), iconAllowlist: renderer.getAllowedIcons?.() || [],
        selectionLocked: Boolean(data.selectionLocked), adoptedSuggestions: data.adoptedSuggestions || [],
        presentationScope: data.presentationScope || null, previousOutput: data.cardsOutput || null,
        errors: data.repairIssues || [], basePlan: base?.plan || null, codeAvailable: Boolean(codeCardHandler) },
      validate: async (output) => {
        try {
          if (!object(output) || !Array.isArray(output.scenes) || !Array.isArray(output.subtitles)
            || Object.keys(output).some((key) => !['scenes', 'subtitles'].includes(key))) throw fail('配圖輸出欄位無效。');
          if (output.scenes.some((scene) => !object(scene) || Object.keys(scene).some((key) => !['id', 'from', 'to', 'component', 'params', 'cues', 'stamp'].includes(key)))
            || output.subtitles.some((subtitle) => !object(subtitle) || Object.keys(subtitle).some((key) => !['from', 'runs', 'level'].includes(key)))) throw fail('圖卡或字幕含未定義欄位，不能自行填剪接或秒數。');
          const prepared = safeClone(output);
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
module.exports = { createRecutCardsStep, restrictPresentation };
