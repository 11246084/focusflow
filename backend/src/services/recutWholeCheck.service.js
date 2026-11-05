'use strict';
const { retryDecision, fail } = require('./recutRuntime.service');
const { INSTRUCTIONS, responseSchema, ISSUE_TYPES } = require('../prompts/recutWholeCheck');
const loadSourceDefault = (id) => require('../models/recutSource.model').findById(id).lean();

function validateIssues(output, source, plan) {
  const errors = [];
  if (!output || !Array.isArray(output.issues) || Object.keys(output).some((k) => k !== 'issues')) return { valid: false, errors: ['整段檢查只接受 issues 陣列。'] };
  const scenePaths = (plan?.scenes || []).map((_, i) => `/plan/scenes/${i}/params`);
  const subtitlePaths = (plan?.subtitles || []).flatMap((sub, i) => (sub.runs || []).map((_, j) => `/plan/subtitles/${i}/runs/${j}/t`));
  const pathHint = () => `可用路徑：${[...scenePaths, ...subtitlePaths.slice(0, 6)].join('、')}${subtitlePaths.length > 6 ? ' 等字幕路徑' : ''}`;
  for (const [index, issue] of output.issues.entries()) {
    const label = `issues[${index}]（${issue?.type}）`;
    if (!issue || !ISSUE_TYPES[issue.type] || Object.keys(issue).some((k) => !['type', 'problem', 'proposedChange', 'impact', 'sentenceIds', 'presentationPaths', 'selectionChanges'].includes(k))
      || ['problem', 'proposedChange', 'impact'].some((k) => typeof issue[k] !== 'string' || !issue[k].trim())
      || !Array.isArray(issue.sentenceIds) || issue.sentenceIds.some((id) => !source.sentences.some((s) => s.id === id))
      || !Array.isArray(issue.presentationPaths) || !Array.isArray(issue.selectionChanges)
      || issue.selectionChanges.some((c) => !c || Object.keys(c).some((k) => !['sentenceId', 'action'].includes(k)) || !['add', 'remove'].includes(c.action) || !source.sentences.some((s) => s.id === c.sentenceId))) { errors.push(`${label} 分類或說明格式無效：type 須為允許類型，problem/proposedChange/impact 不可空白，sentenceIds 與 selectionChanges 只能用提供的句子ID。`); continue; }
    if (ISSUE_TYPES[issue.type].target === 'selection' && issue.presentationPaths.length) errors.push(`${label} 是選段問題，presentationPaths 必須是 []。`);
    if (ISSUE_TYPES[issue.type].target === 'selection' && !issue.selectionChanges.length) errors.push(`${label} 是選段問題，須在 selectionChanges 明列 {sentenceId, action: add|remove}。`);
    if (ISSUE_TYPES[issue.type].target === 'cards' && issue.selectionChanges.length) errors.push(`${label} 是圖卡問題，selectionChanges 必須是 []；要改選段請改用選段類型。`);
    if (ISSUE_TYPES[issue.type].target === 'cards' && !issue.presentationPaths.length) errors.push(`${label} 是圖卡問題，須在 presentationPaths 列出要修的卡片或字幕路徑；plan.clips 的剪點由程式依 selection 產生，不能當成圖卡問題回報。${pathHint()}`);
    for (const path of issue.presentationPaths) {
      const match = /^\/plan\/(scenes|subtitles)\/(0|[1-9]\d*)\/(params(?:\/[\w-]+)*|runs\/(0|[1-9]\d*)\/t)$/.exec(path);
      if (!match || /(?:^|\/)(__proto__|constructor|prototype)(?:\/|$)/.test(path) || !plan?.[match[1]]?.[+match[2]] || (match[1] === 'subtitles' ? !plan.subtitles[+match[2]].runs?.[+match[4]] : !match[3].startsWith('params'))) errors.push(`${label} 的呈現路徑 ${path} 無效。${pathHint()}`);
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
    let quality = issues.filter((i) => i.severity === 'quality');
    const repair = async (problems) => {
      if (problems.some((i) => i.target === 'selection')) {
        if (!selection || task.callLimit - task.callsUsed < 2) return false;
        Object.assign(data, await selection.run({ ...context, data: { ...data, repairIssues: problems } }));
        if (!data.selection.answerable) return true;
      } else if (task.callsUsed >= task.callLimit) return false;
      Object.assign(data, await cards.run({ ...context, data: { ...data, repairIssues: problems } }));
      return true;
    };
    if (credibility.length) {
      // Reserve the mandatory post-repair semantic check from the same pool.
      // A structurally valid renderer plan cannot prove the issue was fixed.
      const required = credibility.some((i) => i.target === 'selection') ? 3 : 2;
      if (task.callLimit - task.callsUsed < required || !await repair(credibility)) throw fail('可信度修正與複檢額度不足。', 'RECUT_CALL_LIMIT_EXCEEDED');
      if (data.selection?.answerable === false) return { version: data.version, suggestions: [] };
      result = await retryDecision(context, { decide, instructions: INSTRUCTIONS, responseSchema,
        input: { selection: data.selection, fullScript: data.fullScript, plan: data.plan, sentences: source.sentences },
        validate: (output) => validateIssues(output, source, data.plan) });
      issues = result.issues;
      if (data.selectionLocked) {
        suggestions.push(...issues.filter((i) => i.target === 'selection').map((i) => asSuggestion(i, source, data.selection)));
        issues = issues.filter((i) => i.target !== 'selection');
      }
      if (issues.some((i) => i.severity === 'credibility')) throw fail('修正後仍有可信度錯誤，不能保存版本。');
      quality = issues.filter((i) => i.severity === 'quality');
    }
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
