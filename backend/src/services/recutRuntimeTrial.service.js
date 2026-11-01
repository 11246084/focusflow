'use strict';
const { assertLoopbackMongoTarget, fail } = require('./recutRuntime.service');
const COLLECTIONS = Object.freeze(['courses', 'videos', 'videosegments', 'questions']);

async function copyRecutCourseData({ courseIds, targetUri, readCourseData, writeLocal, execute = false }) {
  assertLoopbackMongoTarget(targetUri);
  if (!Array.isArray(courseIds) || courseIds.length !== 2 || new Set(courseIds).size !== 2 || courseIds.some((id) => typeof id !== 'string' || !id.trim())) throw fail('必須明確指定兩門不同課程。');
  if (typeof readCourseData !== 'function' || (execute && typeof writeLocal !== 'function')) throw fail('尚未提供唯讀來源與本機寫入轉接。');
  // The reader receives a fixed collection scope and explicit courses. No URI or
  // credentials enter returned manifests or model/attempt records.
  const rows = await readCourseData({ courseIds: [...courseIds], collections: [...COLLECTIONS] });
  if (!rows || Object.keys(rows).some((key) => !COLLECTIONS.includes(key)) || Object.values(rows).some((docs) => !Array.isArray(docs))) throw fail('課程複製回應格式無效。');
  const counts = Object.fromEntries(COLLECTIONS.map((name) => [name, rows[name]?.length || 0]));
  if (execute) for (const name of COLLECTIONS) await writeLocal({ targetUri, collection: name, documents: rows[name] || [] });
  return { dryRun: !execute, courseIds, counts };
}

async function runSingleTopicTrial({ pipeline, input = {}, model, callLimit = 5, allowModel = false,
  render = false, renderLocal, persistLocal, targetUri, checkCancelled = async () => {} } = {}) {
  if (targetUri !== undefined) assertLoopbackMongoTarget(targetUri);
  if (!allowModel) return { dryRun: true, estimatedSharedCalls: 3, sharedCallLimit: callLimit, extraCallsPerCodeCard: 2 };
  if (!pipeline?.generate?.length || !Number.isInteger(callLimit) || callLimit < 3 || !model?.model) throw fail('試產管線或固定模型設定無效。');
  const task = { _id: input.taskId || 'local-trial', scriptId: input.scriptId, courseId: input.courseId, input, settingsSnapshot: { model }, callsUsed: 0, callLimit };
  const data = { ...input }, attempts = [];
  let stage = 'prepare';
  for (const step of pipeline.generate) {
    stage = step.stage;
    await checkCancelled();
    const startedAt = new Date().toISOString();
    try {
      const result = await step.run({ task, data, checkCancelled, runAttempt: async ({ input: attemptInput, modelId, consumesCall = false, execute }) => {
        await checkCancelled();
        if (consumesCall && task.callsUsed >= callLimit) throw fail('共用呼叫額度已用完。', 'RECUT_CALL_LIMIT_EXCEEDED');
        if (consumesCall) task.callsUsed++;
        const attempt = { stepId: step.id, stage, input: attemptInput, modelId, consumesCall, startedAt: new Date().toISOString(), status: 'running' };
        attempts.push(attempt);
        try {
          const response = await execute(); Object.assign(attempt, response);
          await checkCancelled();
          if (response.validation?.valid === false) throw fail('此步驟未通過驗證。');
          attempt.status = 'succeeded'; return response.output;
        } catch (error) { attempt.status = error.code === 'RECUT_TASK_CANCELLED' ? 'discarded' : 'failed'; attempt.error = { code: error.code || 'RECUT_TRIAL_FAILED' }; throw error; }
        finally { attempt.finishedAt = new Date().toISOString(); attempt.durationMs = Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt); }
      } });
      Object.assign(data, result);
      attempts.push({ stepId: step.id, stage, status: 'succeeded', consumesCall: false, startedAt, finishedAt: new Date().toISOString() });
      if (data.version?.selection?.answerable === false) break;
    } catch (error) {
      // Attach safe progress, retaining recorded model usage even for failures.
      error.trial = { stage, callsUsed: task.callsUsed, attempts }; throw error;
    }
  }
  if (!data.version) throw fail('試產管線沒有產生版本。');
  await checkCancelled();
  let asset = null, renderDurationMs = null;
  if (render && data.version.plan) {
    if (typeof renderLocal !== 'function') throw fail('尚未提供本機渲染轉接。', 'RECUT_RENDER_NOT_CONFIGURED');
    const started = Date.now();
    asset = await renderLocal({ version: data.version, checkCancelled });
    renderDurationMs = Date.now() - started;
  }
  const result = { dryRun: false, state: data.version.selection.answerable ? 'script_review' : 'unanswerable',
    version: data.version, suggestions: data.suggestions || [], asset, renderDurationMs, callsUsed: task.callsUsed, attempts };
  if (persistLocal) {
    if (!targetUri) throw fail('寫入本機資料庫前必須指定目標。', 'RECUT_LOCAL_DB_REQUIRED');
    await checkCancelled(); result.persisted = await persistLocal({ targetUri, result, input });
  }
  return result;
}
module.exports = { COLLECTIONS, copyRecutCourseData, runSingleTopicTrial };
