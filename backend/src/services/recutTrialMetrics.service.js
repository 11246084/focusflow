'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { fail } = require('./recutRuntime.service');
const PHASES = ['script_review', 'asset_review', 'production_wait'];
function statistics(values) {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b), n = sorted.length;
  return { count: n, median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    min: n ? sorted[0] : null, max: n ? sorted[n - 1] : null };
}
function intervals(clips) {
  const result = [];
  for (const clip of [...clips].sort((a, b) => a.startSec - b.startSec)) {
    if (!Number.isFinite(clip.startSec) || !Number.isFinite(clip.endSec) || clip.endSec <= clip.startSec) throw fail('穩定度時間無效。', 'RECUT_METRICS_INVALID');
    const previous = result.at(-1);
    if (previous && clip.startSec <= previous[1]) previous[1] = Math.max(previous[1], clip.endSec);
    else result.push([clip.startSec, clip.endSec]);
  }
  return result;
}
function selectionStability(runs) {
  if (!Array.isArray(runs) || runs.length !== 3) throw fail('穩定度必須有三次第一步結果。', 'RECUT_METRICS_INVALID');
  const sets = runs.map((r) => intervals(r.clips || []));
  const labels = runs.map((r) => new Map((r.selection.sentenceLabels || []).map((v) => [v.sentenceId, v.label])));
  const sentenceIds = [...new Set(labels.flatMap((m) => [...m.keys()]))];
  const pairs = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => {
    let intersectionSec = 0;
    for (const x of sets[a]) for (const y of sets[b]) intersectionSec += Math.max(0, Math.min(x[1], y[1]) - Math.max(x[0], y[0]));
    const duration = (v) => v.reduce((sum, [start, end]) => sum + end - start, 0);
    const unionSec = duration(sets[a]) + duration(sets[b]) - intersectionSec;
    return { runs: [a + 1, b + 1], intersectionSec, unionSec, overlapRatio: unionSec ? intersectionSec / unionSec : null,
      differentLabelSentences: sentenceIds.filter((id) => labels[a].get(id) !== labels[b].get(id)).length };
  });
  const ratios = pairs.map((p) => p.overlapRatio).filter((v) => v !== null);
  return { pairs, meanOverlapRatio: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null,
    differentLabelSentences: sentenceIds.filter((id) => new Set(labels.map((m) => m.get(id))).size > 1).length,
    answerableConsistent: new Set(runs.map((r) => r.selection.answerable)).size === 1 };
}
function tokenUsage(attempts = []) {
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0, missingUsageCalls: 0 };
  for (const attempt of attempts.filter((a) => a.consumesCall || a.modelId || a.input?.budgetKind === 'code-card')) {
    usage.modelCalls++;
    const m = attempt.usageMetadata;
    if (!m || ![m.promptTokenCount, m.candidatesTokenCount, m.thoughtsTokenCount || 0, m.cachedContentTokenCount || 0].every((v) => Number.isFinite(v) && v >= 0)
      || (m.cachedContentTokenCount || 0) > m.promptTokenCount) { usage.missingUsageCalls++; continue; }
    usage.inputTokens += m.promptTokenCount;
    usage.cachedInputTokens += m.cachedContentTokenCount || 0;
    // Thinking output is billable output and is not always part of candidates.
    usage.outputTokens += m.candidatesTokenCount + (m.thoughtsTokenCount || 0);
    usage.totalTokens += m.totalTokenCount ?? (m.promptTokenCount + m.candidatesTokenCount + (m.thoughtsTokenCount || 0));
  }
  return usage;
}
function priceUsage(usage, price, modelId) {
  if (!price || price.modelId !== modelId || usage.missingUsageCalls || !price.currency ||
    ![price.inputPerMillion, price.outputPerMillion].every((n) => Number.isFinite(n) && n >= 0)
    || (usage.cachedInputTokens && !(Number.isFinite(price.cachedInputPerMillion) && price.cachedInputPerMillion >= 0))) return { amount: null, currency: price?.currency || null, status: 'unknown' };
  return { amount: ((usage.inputTokens - (usage.cachedInputTokens || 0)) * price.inputPerMillion + (usage.cachedInputTokens || 0) * (price.cachedInputPerMillion || 0)
    + usage.outputTokens * price.outputPerMillion) / 1e6, currency: price.currency, status: 'calculated', priceAsOf: price.asOf || null };
}
function summarizeTrial(topics) {
  const completed = topics.filter((t) => t.status === 'succeeded'), generated = completed.filter((t) => !t.unanswerable);
  return { topicCount: topics.length, completedCount: completed.length, generationSuccessCount: generated.length,
    generationSuccessRate: topics.length ? generated.length / topics.length : null,
    unanswerableCount: completed.filter((t) => t.unanswerable).length,
    renderTimeMs: statistics(generated.map((t) => t.renderDurationMs)),
    operationTimeMs: Object.fromEntries(PHASES.map((phase) => [phase, statistics(topics.flatMap((t) => t.operationTimes || []).filter((e) => e.phase === phase).map((e) => e.durationMs))])) };
}
const cell = (value) => value === null || value === undefined ? '待填／unknown' : String(value).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
function trialMarkdown(report) {
  const s = report.summary;
  const lines = ['# recut 正式技術試跑紀錄', '', `執行日期：${report.executedAt}`, '', `生成成功率：${s.generationSuccessCount}/${s.topicCount}；回答不了：${s.unanswerableCount}；完成流程：${s.completedCount}/${s.topicCount}`, '',
    '秒數重疊採三組 pairwise intersection / union，範圍先合併避免重複計數；標籤差計三次標籤不一致的句數。', '',
    '| 主題 | 結果 | 回答不了 | 呼叫 | input/output tokens | 費用 | 渲染 ms | 秒數重疊 | 標籤差句數 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const t of report.topics) lines.push(`| ${cell(t.topicId)} | ${cell(t.errorCode || t.status)} | ${cell(t.unanswerable)} | ${t.usage.modelCalls} | ${t.usage.inputTokens}/${t.usage.outputTokens} | ${cell(t.cost.amount)} ${cell(t.cost.currency)} | ${cell(t.renderDurationMs)} | ${cell(t.stability?.meanOverlapRatio)} | ${cell(t.stability?.differentLabelSentences)} |`);
  lines.push('', '| 時間（ms） | 筆數 | 中位數 | 最小 | 最大 |', '| --- | --- | --- | --- | --- |');
  for (const [phase, stats] of Object.entries({ render: s.renderTimeMs, ...s.operationTimeMs })) lines.push(`| ${phase} | ${stats.count} | ${cell(stats.median)} | ${cell(stats.min)} | ${cell(stats.max)} |`);
  lines.push('', '## 人工填寫', '', '| 主題 | 剪接自然度 | 團隊修改量 | 教授核准 | 回答不了判斷正確性 | 備註 |', '| --- | --- | --- | --- | --- | --- |');
  for (const t of report.topics) lines.push(`| ${cell(t.topicId)} |  |  |  |  |  |`);
  lines.push('', '表格費用與 token 含同題三次第一步的試跑總量；evidence 另列生成與穩定度的用量及費用。價格未提供、快取價不足或 token 用量不完整時，費用為 null／unknown。人工欄位空白不代表通過；本紀錄不代表正式部署或人工驗收。', '');
  return lines.join('\n');
}
async function writeTrialEvidence(report, output) {
  if (typeof output !== 'string' || !output.trim()) throw fail('必須明確指定本次輸出路徑。', 'RECUT_OUTPUT_REQUIRED');
  const directory = path.resolve(output); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'report.md'), trialMarkdown(report));
  await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify(report, null, 2));
  return directory;
}
module.exports = { statistics, selectionStability, tokenUsage, priceUsage, summarizeTrial, trialMarkdown, writeTrialEvidence };
