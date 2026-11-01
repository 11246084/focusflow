const ShortScript = require('../models/shortScript.model');
const ShortAsset = require('../models/shortAsset.model');
const RecutVersion = require('../models/recutVersion.model');
const RecutSource = require('../models/recutSource.model');
const RecutApproval = require('../models/recutApproval.model');
const RecutReviewEvent = require('../models/recutReviewEvent.model');
const RecutTask = require('../models/recutTask.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { PRODUCTION_MODES, RECUT_STATES: S } = require('../constants/recut');

const productionMode = (script) => script.productionMode || PRODUCTION_MODES.AVATAR;
const recutSnapshot = (script) => ({
  state: S.IDLE, revision: 0, currentVersionId: null, currentAssetId: null,
  currentAssetGenerationVersion: null, activeTaskId: null, lastCompletedTaskId: null,
  pendingEditId: null, ...script.recut,
});
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const scriptLocks = new Map();
async function withRecutScriptLock(scriptId, action) {
  const key = String(scriptId);
  const previous = scriptLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  scriptLocks.set(key, current);
  await previous;
  try { return await action(); } finally {
    release();
    if (scriptLocks.get(key) === current) scriptLocks.delete(key);
  }
}
function invalid(message) { throw new AppError(message, 409, 'RECUT_STATE_INVALID'); }
function requireState(state, allowed) {
  if (!allowed.includes(state)) invalid(`Cannot perform this action in recut state ${state}.`);
}
function assertRecut(script) {
  if (productionMode(script) !== PRODUCTION_MODES.RECUT) invalid('Choose recut production mode first.');
}
async function loadScript(scriptId) {
  assertObjectId(scriptId, 'short script');
  const script = await ShortScript.findById(scriptId).lean();
  if (!script) throw new AppError('Short script not found.', 404, 'SHORT_SCRIPT_NOT_FOUND');
  return script;
}

// 不用 findByIdAndUpdate：讀到的版本／狀態必須仍相同才能寫入，避免並行請求覆蓋。
async function saveSnapshot(script, next, extra = {}) {
  const updated = await ShortScript.findOneAndUpdate({
    _id: script._id, productionMode: script.productionMode ?? null,
    'recut.revision': script.recut?.revision ?? null,
  }, { $set: { recut: { ...next, revision: recutSnapshot(script).revision + 1 }, ...extra } },
  { new: true, runValidators: true });
  if (!updated) invalid('The recut version or state changed. Reload before retrying.');
  return updated;
}

async function setProductionModeOwned({ scriptId, mode }) {
  if (!Object.values(PRODUCTION_MODES).includes(mode)) {
    throw new AppError('productionMode must be avatar or recut.', 400, 'VALIDATION_ERROR');
  }
  const script = await loadScript(scriptId);
  if (productionMode(script) === mode) return { ...script, productionMode: mode };
  const snapshot = recutSnapshot(script);
  if (snapshot.activeTaskId || [S.QUEUED, S.GENERATING, S.UPDATING, S.RENDER_QUEUED, S.RENDERING].includes(snapshot.state)) {
    invalid('Wait for or cancel the current task before changing production mode.');
  }
  // 切換只換模式；avatar versions 與所有 recut 歷史、目前版參照均保留。
  return saveSnapshot(script, snapshot, { productionMode: mode });
}

function validateSentenceList(source) {
  if (!Number.isFinite(source.startSec) || !Number.isFinite(source.endSec) || source.startSec < 0 || source.endSec <= source.startSec) {
    throw new AppError('Invalid recut source window.', 400, 'VALIDATION_ERROR');
  }
  let previousEnd = source.startSec;
  for (const [index, sentence] of (source.sentences || []).entries()) {
    if (sentence.id !== `s${index + 1}` || typeof sentence.text !== 'string' || !sentence.text.trim()
      || typeof sentence.retrievalHit !== 'boolean' || !Array.isArray(sentence.words) || !sentence.words.length
      || !Number.isFinite(sentence.startSec) || !Number.isFinite(sentence.endSec)
      || sentence.startSec < previousEnd || sentence.endSec <= sentence.startSec || sentence.endSec > source.endSec) {
      throw new AppError('Invalid recut sentence list.', 400, 'VALIDATION_ERROR');
    }
    let wordEnd = sentence.startSec;
    for (const word of sentence.words) {
      if (typeof word.text !== 'string' || !word.text.trim() || !Number.isFinite(word.startSec)
        || !Number.isFinite(word.endSec) || word.startSec < wordEnd || word.endSec <= word.startSec || word.endSec > sentence.endSec) {
        throw new AppError('Invalid recut word timings.', 400, 'VALIDATION_ERROR');
      }
      wordEnd = word.endSec;
    }
    previousEnd = sentence.endSec;
  }
  return source;
}
async function createRecutSource(input) {
  validateSentenceList(input);
  return RecutSource.create(input);
}
async function createRecutVersion(input) {
  const source = await RecutSource.findById(input.sourceId).lean();
  if (!source || !sameId(source.scriptId, input.scriptId)) invalid('Version source does not belong to this script.');
  if (input.plan != null && input.plan.schemaVersion !== 'recut-v1') invalid('Expected a recut-v1 plan.');
  return RecutVersion.create(input);
}

async function versionFor(scriptId, versionId) {
  assertObjectId(versionId, 'recut version');
  const version = await RecutVersion.findById(versionId).lean();
  if (!version || !sameId(version.scriptId, scriptId)) invalid('Recut version does not belong to this script.');
  return version;
}
// 第 75 項：依資料比較原音與順序，不信任呼叫端宣稱「只改顏色」。
function narrationKey(version) {
  const anchorKey = (anchor) => [anchor?.text || '', anchor?.nth || 1, anchor?.offset || 0];
  return JSON.stringify({ sourceId: String(version.sourceId),
    ranges: (version.selection?.ranges || []).map(({ from, to, startAt, endAt }) => [from, to, startAt || null, endAt || null]),
    openingSentenceId: version.selection?.openingSentenceId || null, fullScript: version.fullScript || '',
    planSourceVideoId: version.plan?.source?.videoId || null,
    planClips: (version.plan?.clips || []).map((clip) => [clip.chunkIds, anchorKey(clip.from), anchorKey(clip.to), clip.cut || 'snap']),
  });
}
async function scriptApproval(scriptId, versionId) {
  const approvals = await RecutApproval.find({ scriptId, versionId, type: 'script' }).lean();
  return approvals.find((a) => a.approvedBy && a.approvedAt && !a.revokedAt) || null;
}
async function assertCurrentAsset(script, snapshot, { assetId, generationVersion }) {
  if (!sameId(snapshot.currentAssetId, assetId) || snapshot.currentAssetGenerationVersion !== generationVersion) invalid('This is not the current MP4.');
  const asset = await ShortAsset.findById(assetId).lean();
  if (!asset || !sameId(asset.sourceScriptId, script._id) || !sameId(asset.recutVersionId, snapshot.currentVersionId)
    || asset.generationVersion !== generationVersion || asset.status === 'archived') invalid('The MP4 or its generation changed.');
  return asset;
}
function assertSettled(snapshot) {
  if (snapshot.pendingEditId) invalid('Apply or restore the pending selection edits first.');
  if (snapshot.activeTaskId) invalid('Recut is still generating or updating.');
}
async function assertRecutAssetPublishable(asset) {
  if (!asset.recutVersionId) return;
  const script = await loadScript(asset.sourceScriptId);
  assertRecut(script);
  const current = recutSnapshot(script);
  requireState(current.state, [S.ASSET_APPROVED, S.PUBLISHED]); assertSettled(current);
  await assertCurrentAsset(script, current, { assetId: asset._id, generationVersion: asset.generationVersion });
  const approvals = await RecutApproval.find({ scriptId: script._id, versionId: current.currentVersionId,
    type: 'asset', assetId: asset._id, generationVersion: asset.generationVersion }).lean();
  if (!approvals.some((a) => a.approvedBy && a.approvedAt && !a.revokedAt)) invalid('This MP4 has not been approved.');
}

/** 唯一 recut 狀態寫入入口。內部使用；route 必須先做課程管理權限檢查。 */
async function transitionOwned({ scriptId, event, versionId, assetId, generationVersion, actorId,
  taskId, baseSnapshot, pendingEditId, expectedRevision, scope, reasons = [], now = new Date() } = {}) {
  const script = await loadScript(scriptId);
  assertRecut(script);
  const current = recutSnapshot(script);
  const next = { ...current };
  if (expectedRevision !== undefined && expectedRevision !== current.revision) invalid('Recut state changed.');
  const reviewStates = [S.IDLE, S.SCRIPT_REVIEW, S.SCRIPT_APPROVED, S.RENDER_FAILED, S.ASSET_REVIEW, S.ASSET_APPROVED, S.PUBLISHED];
  const requireVersion = () => {
    if (!sameId(versionId, current.currentVersionId)) invalid('Approval must refer to the current version.');
  };
  const clearAsset = () => { next.currentAssetId = null; next.currentAssetGenerationVersion = null; };
  switch (event) {
    case 'queue_task':
      requireState(current.state, reviewStates);
      if (current.activeTaskId) invalid('A recut task is already active.');
      assertObjectId(taskId, 'recut task');
      next.activeTaskId = taskId; next.state = S.QUEUED;
      break;
    case 'start_task':
      requireState(current.state, [S.QUEUED]);
      if (!sameId(current.activeTaskId, taskId)) invalid('Task no longer owns this script.');
      next.state = current.currentVersionId ? S.UPDATING : S.GENERATING;
      break;
    case 'restore_task':
      if (!sameId(current.activeTaskId, taskId)) invalid('Task no longer owns this script.');
      // 原版與 pendingEditId 都來自開始時的 DB 快照，不採用步驟中產生的候選結果。
      Object.assign(next, baseSnapshot, { revision: current.revision, activeTaskId: null });
      break;
    case 'complete_task':
      requireState(current.state, [S.GENERATING, S.UPDATING]);
      if (!sameId(current.activeTaskId, taskId)) invalid('Task no longer owns this script.');
      if ((await RecutTask.findById(taskId).lean())?.status !== 'running') {
        throw new AppError('Recut task cancelled.', 409, 'RECUT_TASK_CANCELLED');
      }
      next.activeTaskId = null; next.lastCompletedTaskId = taskId; next.pendingEditId = null;
      // fall through：成功後才切換目前版本。
    case 'revise': { // eslint-disable-line no-fallthrough
      if (event === 'revise') { requireState(current.state, reviewStates); if (current.activeTaskId) invalid('A recut task is active.'); }
      const version = await versionFor(script._id, versionId);
      const previous = current.currentVersionId ? await versionFor(script._id, current.currentVersionId) : null;
      const approval = previous && narrationKey(previous) === narrationKey(version)
        ? await scriptApproval(script._id, previous._id) : null;
      next.currentVersionId = version._id; next.state = S.SCRIPT_REVIEW; clearAsset();
      if (approval && version.selection?.answerable && version.plan) {
        await RecutApproval.create({ scriptId: script._id, versionId: version._id, type: 'script',
          approvedBy: approval.approvedBy, approvedAt: approval.approvedAt, inheritedFromApprovalId: approval._id });
        next.state = S.SCRIPT_APPROVED;
      }
      break;
    }
    case 'set_pending_edits': {
      requireState(current.state, reviewStates);
      if (current.activeTaskId) invalid('Cannot replace edits during a task.');
      if (pendingEditId) {
        const edit = await RecutReviewEvent.findById(pendingEditId).lean();
        if (!edit || edit.kind !== 'edit' || !sameId(edit.scriptId, script._id)
          || !sameId(edit.versionId, current.currentVersionId)) invalid('Pending edit must belong to the current version.');
      }
      next.pendingEditId = pendingEditId || null;
      break;
    }
    case 'approve_script': {
      requireState(current.state, [S.SCRIPT_REVIEW]); assertSettled(current); requireVersion();
      assertObjectId(actorId, 'approver');
      const version = await versionFor(script._id, versionId);
      if (!version.selection?.answerable || !version.plan) invalid('There is no answerable script and plan to approve.');
      await RecutApproval.create({ scriptId: script._id, versionId, type: 'script', approvedBy: actorId, approvedAt: new Date() });
      next.state = S.SCRIPT_APPROVED;
      break;
    }
    case 'queue_render':
    case 'start_render':
      requireState(current.state, event === 'queue_render' ? [S.SCRIPT_APPROVED, S.RENDER_FAILED] : [S.RENDER_QUEUED]);
      assertSettled(current); requireVersion();
      if (!await scriptApproval(script._id, current.currentVersionId)) invalid('The current script has not been approved.');
      next.state = event === 'queue_render' ? S.RENDER_QUEUED : S.RENDERING;
      break;
    case 'requeue_render':
      requireState(current.state, [S.RENDERING]); requireVersion();
      next.state = S.RENDER_QUEUED;
      break;
    case 'render_failed':
      requireState(current.state, [S.RENDERING]); next.state = S.RENDER_FAILED;
      break;
    case 'attach_asset': {
      requireState(current.state, [S.RENDERING]); requireVersion();
      assertObjectId(assetId, 'short asset');
      const asset = await ShortAsset.findById(assetId).lean();
      if (!asset || !sameId(asset.sourceScriptId, script._id) || !sameId(asset.recutVersionId, versionId)
        || !Number.isInteger(generationVersion) || generationVersion < 1 || asset.generationVersion !== generationVersion) invalid('Render output must match the approved version.');
      next.currentAssetId = assetId; next.currentAssetGenerationVersion = generationVersion; next.state = S.ASSET_REVIEW;
      break;
    }
    case 'approve_asset': {
      requireState(current.state, [S.ASSET_REVIEW, S.ASSET_APPROVED, S.PUBLISHED]); assertSettled(current); requireVersion();
      const asset = await assertCurrentAsset(script, current, { assetId, generationVersion });
      assertObjectId(actorId, 'approver');
      if (asset.reviewStatus === 'rejected') invalid('This MP4 was rejected. Render a new generation.');
      let approval = (await RecutApproval.find({ scriptId: script._id, versionId, type: 'asset', assetId, generationVersion }).lean())
        .find((entry) => entry.approvedBy && entry.approvedAt && !entry.revokedAt);
      if (!approval) approval = await RecutApproval.create({ scriptId: script._id, versionId, type: 'asset', assetId, generationVersion,
        approvedBy: actorId, approvedAt: now });
      // Durable evidence first. Retry repairs a partial write; publishing requires both.
      if (asset.reviewStatus !== 'approved' || asset.reviewedGenerationVersion !== generationVersion) {
        const updated = await ShortAsset.findOneAndUpdate({ _id: assetId, sourceScriptId: script._id, recutVersionId: versionId,
          generationVersion, status: { $ne: 'archived' }, reviewStatus: asset.reviewStatus ?? null,
          'youtubeUpload.localCleanupAt': null, 'youtubeUpload.cleanupIntent': null }, { $set: {
          reviewStatus: 'approved', reviewedGenerationVersion: generationVersion, reviewedBy: approval.approvedBy,
          reviewedAt: approval.approvedAt, reviewReasons: [],
        }, $push: { reviewHistory: { generationVersion, status: 'approved', reviewedBy: approval.approvedBy,
          reviewedAt: approval.approvedAt, reasons: [] } } }, { new: true });
        if (!updated) invalid('MP4 review or lifecycle changed.');
      }
      if ([S.ASSET_APPROVED, S.PUBLISHED].includes(current.state)) return script;
      next.state = S.ASSET_APPROVED;
      break;
    }
    case 'reject_asset': {
      requireState(current.state, [S.ASSET_REVIEW, S.ASSET_APPROVED, S.PUBLISHED]); assertSettled(current); requireVersion();
      if (!['presentation', 'content'].includes(scope)) invalid('Rejection scope must be presentation or content.');
      assertObjectId(actorId, 'reviewer');
      const asset = await assertCurrentAsset(script, current, { assetId, generationVersion });
      const rejected = await ShortAsset.findOneAndUpdate({ _id: assetId, sourceScriptId: script._id, recutVersionId: versionId,
        generationVersion, status: asset.status, 'youtubeUpload.localCleanupAt': null, 'youtubeUpload.cleanupIntent': null },
      { $set: { status: 'draft', publishedAt: null, reviewStatus: 'rejected', reviewedGenerationVersion: generationVersion,
        reviewedBy: actorId, reviewedAt: now, reviewReasons: reasons },
      $push: { reviewHistory: { generationVersion, status: 'rejected', reviewedBy: actorId, reviewedAt: now, reasons } } }, { new: true });
      if (!rejected) invalid('MP4 lifecycle changed.');
      for (const approval of await RecutApproval.find({ scriptId: script._id, versionId }).lean()) {
        if (approval.type === 'asset' || scope === 'content') await RecutApproval.findByIdAndUpdate(approval._id, { $set: { revokedAt: now } });
      }
      await RecutReviewEvent.create({ scriptId: script._id, versionId, kind: 'asset_rejection', actorId,
        assetId, generationVersion, scope, reasons, occurredAt: now });
      next.state = scope === 'presentation' ? S.SCRIPT_APPROVED : S.SCRIPT_REVIEW; clearAsset();
      break;
    }
    case 'publish': {
      requireState(current.state, [S.ASSET_APPROVED, S.PUBLISHED]); assertSettled(current); requireVersion();
      const asset = await assertCurrentAsset(script, current, { assetId, generationVersion });
      if (asset.status !== 'published' || asset.youtubeUpload?.remoteState !== 'ready' || asset.reviewStatus !== 'approved'
        || asset.reviewedGenerationVersion !== generationVersion) invalid('The MP4 is not published and ready.');
      if (current.state === S.PUBLISHED) return script;
      const approvals = await RecutApproval.find({ scriptId: script._id, versionId, type: 'asset', assetId, generationVersion }).lean();
      if (!approvals.some((a) => a.approvedBy && a.approvedAt && !a.revokedAt)) invalid('This MP4 has not been approved.');
      next.state = S.PUBLISHED;
      break;
    }
    default: invalid('Unknown recut transition.');
  }
  return saveSnapshot(script, next);
}

const transitionRecut = (options) => withRecutScriptLock(options.scriptId, () => transitionOwned(options));
// 同一鎖內完成草稿／任務快照；scopedTransition 仍只走上面的狀態入口，避免遞迴取鎖。
const withRecutTransition = (scriptId, action) => withRecutScriptLock(scriptId,
  () => action((options) => transitionOwned({ ...options, scriptId })));
const setProductionModeForScript = (options) => withRecutScriptLock(options.scriptId, () => setProductionModeOwned(options));
module.exports = { transitionRecut, withRecutScriptLock, withRecutTransition, setProductionModeForScript, productionMode, recutSnapshot,
  createRecutSource, createRecutVersion, validateSentenceList, narrationKey, assertRecutAssetPublishable };
