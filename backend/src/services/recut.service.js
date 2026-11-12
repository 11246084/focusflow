const ShortScript = require('../models/shortScript.model');
const RecutTask = require('../models/recutTask.model');
const RecutRenderJob = require('../models/recutRenderJob.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { getCourseByIdOrThrow, assertCanManageCourse } = require('./courseAccess.service');
const { productionMode, recutSnapshot, setProductionModeForScript } = require('./recutState.service');
const { recutQueue } = require('./recutQueue.service');

async function loadForManage({ user, scriptId }) {
  assertObjectId(scriptId, 'short script');
  const script = await ShortScript.findById(scriptId).lean();
  if (!script) throw new AppError('Short script not found.', 404, 'SHORT_SCRIPT_NOT_FOUND');
  const course = await getCourseByIdOrThrow(script.courseId);
  await assertCanManageCourse(user, course);
  return script;
}
function toPublicTask(task) {
  if (!task) return null;
  return { id: String(task._id), scriptId: String(task.scriptId), type: task.type, status: task.status,
    callLimit: task.callLimit, callsUsed: task.callsUsed, stepIds: task.stepIds,
    resultVersionId: task.resultVersionId ? String(task.resultVersionId) : null,
    queuedAt: task.queuedAt, startedAt: task.startedAt || null, finishedAt: task.finishedAt || null, error: task.error || null };
}
async function setProductionMode({ user, scriptId, mode }) {
  await loadForManage({ user, scriptId });
  const script = await setProductionModeForScript({ scriptId, mode });
  return { scriptId: String(script._id), productionMode: productionMode(script), recut: recutSnapshot(script) };
}
async function startGeneration({ user, scriptId }, queue = recutQueue) {
  const script = await loadForManage({ user, scriptId });
  return toPublicTask(await queue.enqueue({ script, requestedBy: user.id }));
}
// 只公開目前版本渲染工作的狀態與錯誤代碼；worker 回報的原始訊息可能含技術細節，不給教師端。
function toPublicRender(job) {
  if (!job) return null;
  return { status: job.status, errorCode: job.status === 'failed' ? job.error?.code || 'RECUT_RENDER_FAILED' : null,
    attemptCount: job.attemptCount || 0, queuedAt: job.queuedAt || null, finishedAt: job.finishedAt || null };
}
async function getState({ user, scriptId }) {
  const script = await loadForManage({ user, scriptId });
  const snapshot = recutSnapshot(script);
  const tasks = await RecutTask.find({ scriptId }).sort({ createdAt: -1, _id: -1 }).limit(1).lean();
  const render = snapshot.currentVersionId
    ? await RecutRenderJob.findOne({ scriptId: script._id, versionId: snapshot.currentVersionId }).lean() : null;
  return { scriptId: String(script._id), productionMode: productionMode(script), recut: snapshot, task: toPublicTask(tasks[0]),
    render: toPublicRender(render) };
}
async function loadTask(options) {
  await loadForManage(options);
  assertObjectId(options.taskId, 'recut task');
  const task = await RecutTask.findById(options.taskId).lean();
  if (!task || String(task.scriptId) !== String(options.scriptId)) {
    throw new AppError('Recut task not found.', 404, 'RECUT_TASK_NOT_FOUND');
  }
  return task;
}
async function getTask(options) { return toPublicTask(await loadTask(options)); }
async function cancelTask(options, queue = recutQueue) {
  await loadTask(options);
  return toPublicTask(await queue.requestCancel(options.taskId));
}
function createRecutService({ queue = recutQueue } = {}) {
  return { setProductionMode, startGeneration: (options) => startGeneration(options, queue), getState, getTask,
    cancelTask: (options) => cancelTask(options, queue), loadForManage, toPublicTask };
}
module.exports = { createRecutService, ...createRecutService() };
