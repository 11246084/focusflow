'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { assertLoopbackMongoTarget, fail } = require('./recutRuntime.service');
const { runSingleTopicTrial } = require('./recutRuntimeTrial.service');
const { resolveSelection } = require('./recutSelectionValidation.service');
const { selectionStability, tokenUsage, priceUsage, summarizeTrial, writeTrialEvidence } = require('./recutTrialMetrics.service');

async function runFormalTrial({ topics, targetUri, runtimeFactory, allowModel = false, render = true, price, output, now = () => new Date(), onEstimate = () => {} } = {}) {
  if (!Array.isArray(topics) || topics.length !== 10 || new Set(topics.map((t) => t.topicId)).size !== 10 || topics.some((t) => !/^[\w.-]+$/.test(t.topicId || '') || !t.scriptId || !t.courseId)) throw fail('正式技術試跑須明確指定十個不同主題。', 'RECUT_TOPICS_INVALID');
  const estimate = { dryRun: true, topicCount: 10, firstStepRunsPerTopic: 3, estimatedSharedCalls: 50, extraCallsPerCodeCard: 2,
    estimatedSharedCallLimit: topics.reduce((sum, topic) => sum + 3 * (Number.isInteger(topic.callLimit) && topic.callLimit >= 3 ? topic.callLimit : 5), 0),
    estimatedInputTokens: null, estimatedOutputTokens: null, estimatedCost: null, priceStatus: price ? 'provided-not-estimated' : 'unknown' };
  if (!allowModel) return estimate;
  assertLoopbackMongoTarget(targetUri);
  if (!output || typeof runtimeFactory !== 'function') throw fail('試跑須指定 runtime 與本次輸出路徑。', 'RECUT_ARGUMENT_REQUIRED');
  await onEstimate(estimate);
  const rows = [];
  for (const [index, topic] of topics.entries()) {
    const directory = path.join(path.resolve(output), `${String(index + 1).padStart(2, '0')}-${topic.topicId}`);
    const operationTimes = (topic.operationTimes || []).filter((e) => ['script_review', 'asset_review', 'production_wait'].includes(e.phase)
      && Number.isFinite(e.durationMs) && e.durationMs >= 0).map(({ phase, durationMs }) => ({ phase, durationMs }));
    let runtime, result, attempts = [], stability = null;
    try {
      runtime = await runtimeFactory({ input: topic, output: directory, targetUri, allowModel: true });
      if (runtime.missing?.length || typeof runtime.repeatSelection !== 'function' || typeof runtime.loadSource !== 'function') throw fail('試跑轉接設定不足。', 'RECUT_STEPS_NOT_CONFIGURED');
      result = await runSingleTopicTrial({ ...runtime, targetUri, input: topic, allowModel: true, render });
      attempts.push(...result.attempts);
      const source = await runtime.loadSource(result.version.sourceId);
      // The complete run may repair selection during whole-check. Stability is
      // measured against its original first-step response, before those repairs.
      const selections = [result.initialSelection || resolveSelection(source, result.version.selection)];
      for (let repeat = 1; repeat < 3; repeat++) {
        const next = await runtime.repeatSelection({ sourceId: result.version.sourceId, scriptId: topic.scriptId, courseId: topic.courseId });
        attempts.push(...next.attempts);
        selections.push(resolveSelection(source, next.version.selection));
      }
      stability = selectionStability(selections);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'plan.json'), JSON.stringify(result.version.plan, null, 2));
      await fs.writeFile(path.join(directory, 'full-script.txt'), result.version.fullScript);
      await fs.writeFile(path.join(directory, 'run.json'), JSON.stringify({ ...result, stability, stabilityAttempts: attempts.slice(result.attempts.length) }, null, 2));
      const usage = tokenUsage(attempts);
      const generationUsage = tokenUsage(result.attempts), stabilityUsage = tokenUsage(attempts.slice(result.attempts.length));
      rows.push({ topicId: topic.topicId, status: 'succeeded', unanswerable: !result.version.selection.answerable,
        unanswerableReason: result.version.selection.unanswerableReason || null, usage, cost: priceUsage(usage, price, runtime.model.model),
        generationUsage, generationCost: priceUsage(generationUsage, price, runtime.model.model), stabilityUsage, stabilityCost: priceUsage(stabilityUsage, price, runtime.model.model),
        renderDurationMs: result.renderDurationMs, stability, operationTimes,
        human: { editingNaturalness: null, teamModification: null, professorApproval: null, unanswerableCorrect: null, notes: null } });
    } catch (error) {
      attempts.push(...(error.trial?.attempts || []));
      const usage = tokenUsage(attempts);
      rows.push({ topicId: topic.topicId, status: 'failed', errorCode: /^RECUT_[A-Z_]+$/.test(error.code || '') ? error.code : 'RECUT_TRIAL_FAILED',
        stage: error.trial?.stage || null, unanswerable: result ? !result.version.selection.answerable : null, usage,
        cost: priceUsage(usage, price, runtime?.model?.model), renderDurationMs: result?.renderDurationMs ?? null, stability,
        operationTimes, human: { editingNaturalness: null, teamModification: null, professorApproval: null, unanswerableCorrect: null, notes: null } });
    } finally { await runtime?.close?.(); }
  }
  const priceSchedule = price ? Object.fromEntries(['modelId', 'currency', 'inputPerMillion', 'outputPerMillion', 'cachedInputPerMillion', 'asOf'].filter((k) => price[k] !== undefined).map((k) => [k, price[k]])) : null;
  const report = { formatVersion: 'recut-trial-v1', executedAt: now().toISOString(), priceSchedule, summary: summarizeTrial(rows), topics: rows };
  await writeTrialEvidence(report, output);
  return report;
}
module.exports = { runFormalTrial };
