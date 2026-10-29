'use strict';
const { retryDecision, fail } = require('./recutRuntime.service');
const { INSTRUCTIONS, responseSchema, ISSUE_TYPES } = require('../prompts/recutWholeCheck');
const loadSourceDefault = (id) => require('../models/recutSource.model').findById(id).lean();

function validateIssues(output, source, plan) {
  const errors = [];
  if (!output || !Array.isArray(output.issues) || Object.keys(output).some((k) => k !== 'issues')) return { valid: false, errors: ['整段檢查只接受 issues 陣列。'] };
  for (const issue of output.issues) {
    if (!issue || !ISSUE_TYPES[issue.type] || Object.keys(issue).some((k) => !['type', 'problem', 'proposedChange', 'impact', 'sentenceIds', 'presentationPaths', 'selectionChanges'].includes(k))
      || ['problem', 'proposedChange', 'impact'].some((k) => typeof issue[k] !== 'string' || !issue[k].trim())
      || !Array.isArray(issue.sentenceIds) || issue.sentenceIds.some((id) => !source.sentences.some((s) => s.id === id))
      || !Array.isArray(issue.presentationPaths) || !Array.isArray(issue.selectionChanges)
      || issue.selectionChanges.some((c) => !c || Object.keys(c).some((k) => !['sentenceId', 'action'].includes(k)) || !['add', 'remove'].includes(c.action) || !source.sentences.some((s) => s.id === c.sentenceId))) { errors.push('問題分類或說明格式無效。'); continue; }
    if (ISSUE_TYPES[issue.type].target === 'selection' && issue.presentationPaths.length) errors.push('選段問題不得帶呈現路徑。');
    if (ISSUE_TYPES[issue.type].target === 'selection' && !issue.selectionChanges.length) errors.push('選段問題須明列加回或移除句子。');
    if (ISSUE_TYPES[issue.type].target === 'cards' && issue.selectionChanges.length) errors.push('圖卡問題不得改選段。');
    if (ISSUE_TYPES[issue.type].target === 'cards' && !issue.presentationPaths.length) errors.push('圖卡問題須提供具體呈現路徑。');
    for (const path of issue.presentationPaths) {
      const match = /^\/plan\/(scenes|subtitles)\/(0|[1-9]\d*)\/(params(?:\/[\w-]+)*|runs\/(0|[1-9]\d*)\/t)$/.exec(path);
      if (!match || /(?:^|\/)(__proto__|constructor|prototype)(?:\/|$)/.test(path) || !plan?.[match[1]]?.[+match[2]] || (match[1] === 'subtitles' ? !plan.subtitles[+match[2]].runs?.[+match[4]] : !match[3].startsWith('params'))) errors.push('問題的呈現路徑無效。');
    }
  }
  return { valid: !errors.length, errors, issues: output.issues.map((issue) => ({ ...issue, ...ISSUE_TYPES[issue.type] })) };
}
function asSuggestion(issue) {
  const proposal = { kind: issue.target === 'selection' ? 'selection' : 'presentation', problem: issue.problem,
    proposedChange: issue.proposedChange, impact: issue.impact };
  if (proposal.kind === 'selection') proposal.changes = issue.selectionChanges;
  else proposal.allowedPaths = issue.presentationPaths;
  return { suggestionType: issue.type, content: issue.problem, proposal };
}
function createRecutWholeCheckStep({ decide, renderer, cards, selection, loadSource = loadSourceDefault } = {}) {
  return { id: 'recut-whole-check-sentence-v1', stage: 'wholeCheck', run: async (context) => {
    const { data, task } = context;
    const source = await loadSource(data.sourceId);
    if (!source || String(source.scriptId) !== String(task.scriptId)) throw fail('整段檢查來源無效。', 'RECUT_SOURCE_INVALID');
    let result = await retryDecision(context, { decide, instructions: INSTRUCTIONS, responseSchema,
      input: { selection: data.selection, fullScript: data.fullScript, plan: data.plan, sentences: source.sentences },
      validate: (output) => validateIssues(output, source, data.plan) });
    let issues = result.issues;
    const suggestions = [];
    // Locked teacher selection is never sent to the selection model. Its issues
    // become proposals, including issues found during an adopted presentation edit.
    if (data.selectionLocked) {
      suggestions.push(...issues.filter((i) => i.target === 'selection').map((i) => asSuggestion(i, source, data.selection)));
      issues = issues.filter((i) => i.target !== 'selection');
    }
    const credibility = issues.filter((i) => i.severity === 'credibility');
    const quality = issues.filter((i) => i.severity === 'quality');
    const repair = async (problems) => {
      if (problems.some((i) => i.target === 'selection')) {
        if (!selection || task.callLimit - task.callsUsed < 2) return false;
        Object.assign(data, await selection.run({ ...context, data: { ...data, repairIssues: problems } }));
        if (!data.selection.answerable) return true;
      } else if (task.callsUsed >= task.callLimit) return false;
      Object.assign(data, await cards.run({ ...context, data: { ...data, repairIssues: problems } }));
      return true;
    };
    if (credibility.length && !await repair(credibility)) throw fail('可信度錯誤尚未修正，無法產生新版。', 'RECUT_CALL_LIMIT_EXCEEDED');
    if (data.selection?.answerable === false) return { version: data.version, suggestions: [] };
    // During teacher edits, only explicitly adopted changes may be repaired.
    if (quality.length) {
      const required = quality.some((i) => i.target === 'selection') ? 3 : 2;
      if (data.selectionLocked || credibility.length || task.callLimit - task.callsUsed < required) suggestions.push(...quality.map((i) => asSuggestion(i, source, data.selection)));
      else {
        await repair(quality);
        result = await retryDecision(context, { decide, instructions: INSTRUCTIONS, responseSchema,
          input: { selection: data.selection, fullScript: data.fullScript, plan: data.plan, sentences: source.sentences },
          validate: (output) => validateIssues(output, source, data.plan) });
        if (result.issues.some((i) => i.severity === 'credibility')) throw fail('修正後仍有可信度錯誤。');
        suggestions.push(...result.issues.map((i) => asSuggestion(i, source, data.selection)));
      }
    }
    const validation = renderer.validatePlan(data.plan, { sentences: source.sentences, evidence: source });
    if (!validation.valid) throw fail(`施工單未通過 renderer 驗證：${validation.errors.join('；')}`);
    return { suggestions, version: { sourceId: data.sourceId, selection: data.selection, fullScript: data.fullScript,
      plan: data.plan, modelId: data.modelId, theme: data.theme || 'N2', shortRenderVersion: data.plan.versions.shortRender,
      assetVersions: data.plan.versions.assets } };
  } };
}
module.exports = { createRecutWholeCheckStep, validateIssues, asSuggestion };
