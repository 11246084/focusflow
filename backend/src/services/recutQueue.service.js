const RecutTask = require('../models/recutTask.model');
const RecutAttempt = require('../models/recutAttempt.model');
const ShortScript = require('../models/shortScript.model');
const RecutVersion = require('../models/recutVersion.model');
const RecutSource = require('../models/recutSource.model');
const AppError = require('../utils/appError');
const { RECUT_STAGES, RECUT_TASK_TYPES: T, RECUT_TASK_STATUSES: J } = require('../constants/recut');
const { transitionRecut, recutSnapshot, createRecutVersion, withRecutScriptLock, narrationKey } = require('./recutState.service');
const notifications = require('./notification.service');
const { getSetting: defaultGetSetting } = require('./recutSettings.service');

const errorRecord = (error) => ({ code: error.code || 'RECUT_TASK_FAILED', message: String(error.message || error).slice(0, 1000) });
const cancelled = () => new AppError('Recut task cancelled.', 409, 'RECUT_TASK_CANCELLED');
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// 設定 S1 接上之前的轉接點。呼叫者可注入正式 getSetting；不從教師請求接受上限。
function createRecutQueue({ getSetting = defaultGetSetting, captureSettings = () => ({}), notify = (task) => notifications.notifyRecutTaskFinished(task), beforeEnqueue = async () => {}, checkWork = async () => {} } = {}) {
  const pipelines = new Map();
  let draining = null;
  let scheduled = false;
  let stopped = false;
  function configureRuntime(options = {}) {
    for (const key of ['getSetting', 'captureSettings', 'beforeEnqueue', 'checkWork']) {
      if (options[key] !== undefined && typeof options[key] !== 'function') throw new TypeError(`${key} must be a function.`);
    }
    getSetting = options.getSetting || getSetting;
    captureSettings = options.captureSettings || captureSettings;
    beforeEnqueue = options.beforeEnqueue || beforeEnqueue;
    checkWork = options.checkWork || checkWork;
  }

  function registerSteps(type, steps) {
    if (!Object.values(T).includes(type) || !Array.isArray(steps) || !steps.length
      || new Set(steps.map((s) => s.id)).size !== steps.length
      || steps.some((s) => typeof s.id !== 'string' || !s.id.trim() || !RECUT_STAGES[s.stage] || typeof s.run !== 'function')) {
      throw new TypeError('Register a task type and unique { id, stage, run } steps.');
    }
    // 排隊時固定 stepIds；同名程式變更須由後續工單更新 id（如 selection-v2）。
    pipelines.set(type, steps.map((s) => Object.freeze({ ...s })));
  }

  async function notifyFinished(task) {
    if (task.notifiedAt || ![J.SUCCEEDED, J.FAILED].includes(task.status)) return;
    try {
      await notify(task);
      await RecutTask.findByIdAndUpdate(task._id, { $set: { notifiedAt: new Date() } });
    } catch (error) {
      // 通知失敗不能把已完成的生成回滾；開機恢復會補送（通知服務依 taskId 去重）。
      console.error('[recut] notification failed', { taskId: String(task._id), code: error.code || 'NOTIFICATION_FAILED' });
    }
  }

  async function restore(task, error, status = J.FAILED, transition = transitionRecut) {
    const script = await ShortScript.findById(task.scriptId).lean();
    // 完成指標先寫入 ShortScript，開機時辨識「版本已提交，但 task 尚未收尾」。
    if (sameId(script?.recut?.lastCompletedTaskId, task._id)) {
      const done = await RecutTask.findByIdAndUpdate(task._id, { $set: { status: J.SUCCEEDED,
        resultVersionId: script.recut.currentVersionId, finishedAt: new Date(), error: null } }, { new: true });
      await notifyFinished(done);
      return;
    }
    if (sameId(script?.recut?.activeTaskId, task._id)) {
      await transition({ scriptId: task.scriptId, event: 'restore_task', taskId: task._id, baseSnapshot: task.baseSnapshot });
    }
    const failed = await RecutTask.findByIdAndUpdate(task._id, { $set: {
      status, error: errorRecord(error), finishedAt: new Date(),
    } }, { new: true });
    await notifyFinished(failed);
  }

  async function checkCancelled(taskId) {
    const current = await RecutTask.findById(taskId).lean();
    if (!current || current.status === J.CANCEL_REQUESTED || current.status === J.CANCELLED) throw cancelled();
    if (current.status !== J.RUNNING) throw new AppError('Recut task ownership changed.', 409, 'RECUT_STATE_INVALID');
    await checkWork(current);
    return current;
  }

  async function runTask(task) {
    try {
      const steps = pipelines.get(task.type);
      if (!steps || task.stepIds.length !== steps.length || task.stepIds.some((id, i) => id !== steps[i].id)) {
        throw new AppError('The registered recut pipeline does not match this task.', 503, 'RECUT_STEPS_NOT_CONFIGURED');
      }
      await transitionRecut({ scriptId: task.scriptId, event: 'start_task', taskId: task._id });
      const context = { task, data: { ...(task.input || {}) } };

      async function runAttempt(step, { input = null, modelId = null, consumesCall = false, execute }) {
        await checkCancelled(task._id);
        const attempt = await RecutAttempt.create({ taskId: task._id, stepId: step.id, stage: step.stage,
          status: 'running', input, modelId, consumesCall, startedAt: new Date() });
        const started = Date.now();
        let response;
        try {
          if (consumesCall) {
            const reserved = await RecutTask.findOneAndUpdate({ _id: task._id, status: J.RUNNING,
              callsUsed: { $lt: task.callLimit } }, { $inc: { callsUsed: 1 } }, { new: true });
            if (!reserved) {
              await checkCancelled(task._id);
              throw new AppError('Recut call budget exhausted.', 409, 'RECUT_CALL_LIMIT_EXCEEDED');
            }
            context.task.callsUsed = reserved.callsUsed;
          }
          response = await execute();
          const current = await RecutTask.findById(task._id).lean();
          const discarded = current?.status === J.CANCEL_REQUESTED;
          await RecutAttempt.findByIdAndUpdate(attempt._id, { $set: {
            output: response?.output ?? null, validation: response?.validation ?? null,
            modelId: response?.modelId || modelId, usageMetadata: response?.usageMetadata ?? null,
            status: discarded ? 'discarded' : (response?.validation?.valid === false ? 'failed' : 'succeeded'),
            finishedAt: new Date(), durationMs: Date.now() - started,
          } });
          if (discarded) throw cancelled();
          if (response?.validation?.valid === false) {
            throw new AppError('Recut step validation failed.', 422, 'RECUT_VALIDATION_FAILED');
          }
          return response?.output;
        } catch (error) {
          await RecutAttempt.findByIdAndUpdate(attempt._id, { $set: {
            status: error.code === 'RECUT_TASK_CANCELLED' ? 'discarded' : 'failed',
            error: errorRecord(error), finishedAt: new Date(), durationMs: Date.now() - started,
            ...(response ? {} : { output: error.output ?? null, validation: error.validation ?? null, usageMetadata: error.usageMetadata ?? null }),
          } });
          throw error;
        }
      }

      for (const step of steps) {
        await checkCancelled(task._id);
        const output = await runAttempt(step, { input: context.data, execute: async () => ({
          output: await step.run({ ...context,
            runAttempt: (options) => runAttempt(step, options),
            checkCancelled: () => checkCancelled(task._id),
          }),
        }) });
        if (output && typeof output === 'object') Object.assign(context.data, output);
        // 無法回答是有紀錄的終止結果，不再配圖、檢查或重試（決策第 27、56 項）。
        if (context.data.version?.selection?.answerable === false) break;
      }
      await checkCancelled(task._id);
      if (!context.data.version) throw new AppError('Recut pipeline returned no version.', 502, 'RECUT_VALIDATION_FAILED');
      if (task.input?.lockedSelection) {
        const { selectionKey } = require('./recutReviewSteps.service');
        const output = context.data.version;
        if (selectionKey(output.selection || {}) !== selectionKey(task.input.lockedSelection)
          || String(output.sourceId) !== String(task.input.sourceId) || output.fullScript !== task.input.fullScript
          || (task.input.originalNarrationKey && narrationKey(output) !== task.input.originalNarrationKey)) {
          throw new AppError('重新配圖或檢查改動了鎖定選段，原版與修改已保留。', 422, 'RECUT_LOCKED_SELECTION_CHANGED');
        }
      }
      if (task.input?.presentationScope) {
        const { scopeMatches } = require('./recutReviewScope.service');
        const scope = task.input.presentationScope;
        if (!scopeMatches(scope.before, { plan: context.data.version.plan, theme: context.data.version.theme }, scope.allowedPaths)) {
          throw new AppError('背景工作改動了未採納建議的範圍，原版已保留。', 422, 'RECUT_SUGGESTION_SCOPE_CHANGED');
        }
      }
      const version = await createRecutVersion({ ...context.data.version, scriptId: task.scriptId, taskId: task._id,
        parentVersionId: task.baseSnapshot.currentVersionId || null });
      if (task.input?.baseVersionId) {
        const previous = await RecutVersion.findById(task.input.baseVersionId).lean();
        const source = await RecutSource.findById(version.sourceId).lean();
        const { summarizeChanges } = require('./recutChangeSummary.service');
        await RecutTask.findByIdAndUpdate(task._id, { $set: { changeSummary: summarizeChanges(previous, context.data.version, source) } });
      }
      await RecutTask.findByIdAndUpdate(task._id, { $set: { suggestions: context.data.suggestions || [] } });
      for (const suggestion of context.data.suggestions || []) {
        await require('../models/recutReviewEvent.model').create({ scriptId: task.scriptId, versionId: version._id, taskId: task._id,
          kind: 'suggestion', suggestionType: suggestion.suggestionType || 'quality', content: suggestion.content, proposal: suggestion.proposal });
      }
      await checkCancelled(task._id);
      await transitionRecut({ scriptId: task.scriptId, event: 'complete_task', taskId: task._id, versionId: version._id });
      const finished = await RecutTask.findByIdAndUpdate(task._id, { $set: {
        status: J.SUCCEEDED, resultVersionId: version._id, finishedAt: new Date(),
      } }, { new: true });
      await notifyFinished(finished);
    } catch (error) {
      await restore(task, error, error.code === 'RECUT_TASK_CANCELLED' ? J.CANCELLED : J.FAILED);
    }
  }

  async function drain() {
    if (draining) return draining;
    draining = (async () => {
      while (!stopped) {
        const queued = await RecutTask.find({ status: { $in: [J.QUEUED, J.CANCEL_REQUESTED] }, readyAt: { $ne: null } })
          .sort({ queuedAt: 1, _id: 1 }).limit(1).lean();
        if (!queued.length) break;
        if (queued[0].status === J.CANCEL_REQUESTED) { await restore(queued[0], cancelled(), J.CANCELLED); continue; }
        const task = await RecutTask.findOneAndUpdate({ _id: queued[0]._id, status: J.QUEUED },
          { $set: { status: J.RUNNING, startedAt: new Date() } }, { new: true });
        if (task) await runTask(task.toObject ? task.toObject() : task);
      }
    })().finally(() => { draining = null; });
    return draining;
  }
  function wake() {
    if (scheduled || stopped) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      drain().catch((error) => console.error('[recut] queue failed', { code: error.code || 'RECUT_TASK_FAILED' }));
    });
  }

  async function enqueue({ script, requestedBy, type = T.GENERATE, input = {}, transition = transitionRecut }) {
    await beforeEnqueue({ script, requestedBy, type, input });
    const steps = pipelines.get(type);
    if (!steps) throw new AppError('Recut steps are not registered yet.', 503, 'RECUT_STEPS_NOT_CONFIGURED');
    if ((script.productionMode || 'avatar') !== 'recut' || script.recut?.activeTaskId) {
      throw new AppError('Choose recut and finish the active task before starting.', 409, 'RECUT_STATE_INVALID');
    }
    const key = type === T.GENERATE ? 'recut.initialCallLimit' : 'recut.modificationCallLimit';
    const callLimit = await getSetting(key);
    const minimum = type === T.GENERATE ? 3 : 2;
    if (!Number.isSafeInteger(callLimit) || callLimit < minimum) {
      throw new AppError(`Recut call limit must be an integer >= ${minimum}.`, 503, 'RECUT_SETTING_INVALID');
    }
    if (type !== T.GENERATE && !script.recut?.currentVersionId) {
      throw new AppError('An existing recut version is required for modifications.', 409, 'RECUT_STATE_INVALID');
    }
    const task = await RecutTask.create({ scriptId: script._id, courseId: script.courseId, requestedBy,
      type, status: J.QUEUED, callLimit, callsUsed: 0, input, stepIds: steps.map((s) => s.id),
      baseSnapshot: recutSnapshot(script), settingsSnapshot: await captureSettings(), queuedAt: new Date() });
    try {
      await transition({ scriptId: script._id, event: 'queue_task', taskId: task._id,
        expectedRevision: recutSnapshot(script).revision });
      await RecutTask.findByIdAndUpdate(task._id, { $set: { readyAt: new Date() } });
    } catch (error) {
      // RC8 可能仍持有腳本鎖；附加成功但 readyAt 寫入失敗也用同一 scoped transition 還原。
      await restore(task, error, J.FAILED, transition);
      throw error;
    }
    wake();
    return task;
  }

  async function requestCancel(taskId) {
    const observed = await RecutTask.findById(taskId).lean();
    if (!observed) return null;
    const task = await withRecutScriptLock(observed.scriptId, async () => {
      const script = await ShortScript.findById(observed.scriptId).lean();
      if (sameId(script?.recut?.lastCompletedTaskId, taskId)) {
        // 版本已提交就已結束；不要把 task 收尾前的空隙回報成可取消。
        return RecutTask.findOneAndUpdate({ _id: taskId, status: { $in: [J.QUEUED, J.RUNNING, J.CANCEL_REQUESTED] } },
          { $set: { status: J.SUCCEEDED, resultVersionId: script.recut.currentVersionId, finishedAt: new Date() } }, { new: true });
      }
      return RecutTask.findOneAndUpdate({ _id: taskId, status: { $in: [J.QUEUED, J.RUNNING] } },
        { $set: { status: J.CANCEL_REQUESTED } }, { new: true });
    });
    const current = task || await RecutTask.findById(taskId).lean();
    if (current?.status === J.CANCEL_REQUESTED && !draining) await restore(current, cancelled(), J.CANCELLED);
    if (current?.status === J.CANCEL_REQUESTED) wake();
    return RecutTask.findById(taskId).lean();
  }

  // 僅啟動時呼叫一次。running 不重送可能已付費的呼叫；保留紀錄並恢復原版。
  async function recover() {
    const interrupted = await RecutTask.find({ status: { $in: [J.RUNNING, J.CANCEL_REQUESTED] } }).lean();
    for (const task of interrupted) {
      const attempts = await RecutAttempt.find({ taskId: task._id, status: 'running' }).lean();
      for (const attempt of attempts) await RecutAttempt.findByIdAndUpdate(attempt._id, { $set: {
        status: 'failed', error: { code: 'RECUT_TASK_INTERRUPTED', message: 'Backend restarted during this attempt; output is unknown.' },
        finishedAt: new Date(), durationMs: Date.now() - new Date(attempt.startedAt).getTime(),
      } });
      await restore(task, task.status === J.CANCEL_REQUESTED ? cancelled()
        : new AppError('Backend restarted during recut processing. Original version restored.', 409, 'RECUT_TASK_INTERRUPTED'),
      task.status === J.CANCEL_REQUESTED ? J.CANCELLED : J.FAILED);
    }
    const queued = await RecutTask.find({ status: J.QUEUED }).sort({ queuedAt: 1, _id: 1 }).lean();
    for (const task of queued) {
      const script = await ShortScript.findById(task.scriptId).lean();
      try {
        if (!sameId(script?.recut?.activeTaskId, task._id)) {
          await transitionRecut({ scriptId: task.scriptId, event: 'queue_task', taskId: task._id,
            expectedRevision: task.baseSnapshot.revision });
        }
        await RecutTask.findByIdAndUpdate(task._id, { $set: { readyAt: new Date() } });
      } catch (error) { await restore(task, error); }
    }
    const unnotified = await RecutTask.find({ status: { $in: [J.SUCCEEDED, J.FAILED] }, notifiedAt: null }).lean();
    for (const task of unnotified) await notifyFinished(task);
    stopped = false;
    await drain();
  }
  return { registerSteps, configureRuntime, enqueue, requestCancel, recover, drain, stop: () => { stopped = true; },
    idle: async () => { if (scheduled) await new Promise(setImmediate); if (draining) await draining; } };
}

const recutQueue = createRecutQueue({ captureSettings: () => ({ model: defaultGetSetting('recut.geminiModel') }) });
module.exports = { createRecutQueue, recutQueue,
  registerRecutSteps: (...args) => recutQueue.registerSteps(...args),
  recoverQueuedRecutTasks: () => recutQueue.recover() };
