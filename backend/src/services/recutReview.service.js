const mongoose = require('mongoose');
const ShortAsset = require('../models/shortAsset.model');
const RecutVersion = require('../models/recutVersion.model');
const RecutSource = require('../models/recutSource.model');
const ReviewEvent = require('../models/recutReviewEvent.model');
const RecutTask = require('../models/recutTask.model');
const { loadForManage, toPublicTask } = require('./recut.service');
const { recutSnapshot, productionMode, withRecutTransition, narrationKey } = require('./recutState.service');
const { recutQueue } = require('./recutQueue.service');
const { preview, projectSelection, selectedIds } = require('./recutReviewSelection.service');
const { validPresentationPath } = require('./recutReviewScope.service');
const { RECUT_EDIT_REASONS, RECUT_TIMING_PHASES } = require('../constants/recut');
const { assertObjectId } = require('../utils/objectId');
const AppError = require('../utils/appError');
const same = (a, b) => a != null && b != null && String(a) === String(b);
function conflict(message, code = 'RECUT_STATE_INVALID') { throw new AppError(message, 409, code); }
function validation(message) { throw new AppError(message, 400, 'VALIDATION_ERROR'); }
function requireRevision(input, script) {
  assertObjectId(input.versionId, 'recut version');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) validation('expectedRevision 須為非負整數。');
  const snapshot = recutSnapshot(script);
  if (!same(input.versionId, snapshot.currentVersionId) || input.expectedRevision !== snapshot.revision) conflict('版本已更新，請重新讀取後再操作。');
}
function requireEditable(script, version) {
  const s = recutSnapshot(script);
  if (s.activeTaskId || !['script_review', 'script_approved', 'render_failed', 'asset_review', 'asset_approved', 'published'].includes(s.state)) conflict('目前階段不能修改講稿。');
  if (!version.selection.answerable) conflict('這段錄音無法回答問題，第一版不提供從零手動選句。', 'RECUT_REVIEW_NOT_READY');
}
async function load(options) {
  const script = await loadForManage(options); const state = recutSnapshot(script);
  if (productionMode(script) !== 'recut' || !state.currentVersionId) conflict('尚無可審閱的 recut 版本。', 'RECUT_REVIEW_NOT_READY');
  const version = await RecutVersion.findById(state.currentVersionId).lean();
  const source = version && await RecutSource.findById(version.sourceId).lean();
  if (!version || !source || !same(version.scriptId, script._id) || !same(source.scriptId, script._id)) conflict('審閱來源或版本無效。');
  const pending = state.pendingEditId ? await ReviewEvent.findById(state.pendingEditId).lean() : null;
  if (state.pendingEditId && (!pending || !same(pending.versionId, version._id) || !pending.draftSelection)) conflict('未套用修改資料不完整。');
  return { script, version, source, pending };
}
function needsConfirmation(suggestion, selection) {
  const locked = new Set(selection.lockedSentenceIds || []);
  return suggestion.proposal?.kind === 'selection' && (suggestion.proposal?.changes || []).some((c) => locked.has(c.sentenceId));
}
const publicTiming = (event) => ({ id: String(event._id), versionId: String(event.versionId), phase: event.phase,
  startedAt: event.startedAt, endedAt: event.endedAt || null, durationMs: event.durationMs ?? null });
function createRecutReviewService({ queue = recutQueue, now = () => new Date() } = {}) {
  async function getReview(options) {
    const { script, version, source, pending } = await load(options);
    const sourceVideo = await require('../models/video.model').findById(source.videoId).lean();
    const transcriptVersion = source.transcriptVersion || 'legacy';
    const sourceUpdated = transcriptVersion !== (sourceVideo?.activeTranscriptVersion || 'legacy');
    const current = preview(source, version.selection);
    const draft = pending ? { id: String(pending.draftId), ...preview(source, pending.draftSelection, version.selection.openingSentenceId) } : null;
    const effective = draft || current, selected = selectedIds(effective.selection, source);
    const labels = new Map(effective.selection.sentenceLabels.map((l) => [l.sentenceId, l.label]));
    const original = new Map(version.selection.sentenceLabels.map((l) => [l.sentenceId, l.label]));
    const originalIds = selectedIds(version.selection, source);
    const suggestions = await ReviewEvent.find({ scriptId: script._id, versionId: version._id, kind: 'suggestion' }).sort({ createdAt: 1, _id: 1 }).lean();
    const completed = version.taskId && await RecutTask.findById(version.taskId).lean();
    const latestChangeSummary = completed && same(completed.resultVersionId, version._id) && completed.changeSummary
      ? { taskId: String(completed._id), fromVersionId: completed.input.baseVersionId, toVersionId: String(version._id), changes: completed.changeSummary } : null;
    return { scriptId: String(script._id), versionId: String(version._id), revision: recutSnapshot(script).revision, recut: recutSnapshot(script),
      fullScript: current.fullScript, current, draft, latestChangeSummary,
      source: { videoId: String(source.videoId), startSec: source.startSec, endSec: source.endSec,
        transcriptVersion, sourceUpdated, notice: sourceUpdated ? '來源已更新，需要重新凍結；目前顯示原有來源快照。' : null,
        sentences: source.sentences.map((s) => ({ ...s,
          selectionAllowed: !(source.excludedSentenceIds || []).includes(s.id),
          exclusionReason: (source.excludedSentenceIds || []).includes(s.id) ? '辨識視窗邊界截斷，禁止選用或加回' : null, selected: selected.has(s.id), label: labels.get(s.id), originalLabel: original.get(s.id),
          opening: s.id === effective.selection.openingSentenceId, teacherChanged: selected.has(s.id) !== originalIds.has(s.id) })) },
      suggestions: suggestions.map((s) => ({ id: String(s._id), problem: s.proposal?.problem || s.content || '', proposedChange: s.proposal?.proposedChange || '',
        impact: s.proposal?.impact || '', requiresSelectionConfirmation: needsConfirmation(s, version.selection), adopted: s.adopted ?? null, adoptedAt: s.adoptedAt || null })) };
  }
  async function editSelection(options) {
    await loadForManage(options);
    await withRecutTransition(options.scriptId, async (transition) => {
      const { script, version, source, pending } = await load(options); requireRevision(options, script); requireEditable(script, version);
      const result = projectSelection(source, version.selection, pending?.draftSelection || version.selection, options.changes);
      if (!result.actual.length) return;
      const draftId = pending?.draftId || new mongoose.Types.ObjectId(); let last;
      for (const c of result.actual) last = await ReviewEvent.create({ scriptId: script._id, versionId: version._id, kind: 'edit', actorId: options.user.id,
        draftId, sentenceId: c.sentenceId, action: c.action, reasonLabel: c.reasonLabel,
        originalLabel: version.selection.sentenceLabels.find((l) => l.sentenceId === c.sentenceId).label,
        draftSelection: result.selection, occurredAt: now() });
      await transition({ event: 'set_pending_edits', expectedRevision: options.expectedRevision, pendingEditId: result.restored ? null : last._id });
      if (result.restored) {
        for (const event of await ReviewEvent.find({ scriptId: script._id, draftId, kind: 'edit' }).lean()) {
          await ReviewEvent.findByIdAndUpdate(event._id, { $set: { revertedAt: now() } });
        }
      }
    });
    return getReview(options);
  }
  async function restoreSelection(options) {
    await loadForManage(options);
    await withRecutTransition(options.scriptId, async (transition) => {
      const { script, version, pending } = await load(options); requireRevision(options, script); requireEditable(script, version);
      if (!pending) return;
      await transition({ event: 'set_pending_edits', expectedRevision: options.expectedRevision, pendingEditId: null });
      for (const event of await ReviewEvent.find({ scriptId: script._id, draftId: pending.draftId, kind: 'edit' }).lean()) {
        await ReviewEvent.findByIdAndUpdate(event._id, { $set: { revertedAt: now() } });
      }
    });
    return getReview(options);
  }
  async function applySelection(options) {
    await loadForManage(options);
    return withRecutTransition(options.scriptId, async (transition) => {
      const { script, version, source, pending } = await load(options); requireRevision(options, script); requireEditable(script, version);
      if (!pending) conflict('沒有未套用的修改。');
      const result = preview(source, pending.draftSelection, version.selection.openingSentenceId);
      if (!result.durationValid) throw new AppError('修改後總長必須為 30～65 秒。', 422, 'RECUT_DURATION_INVALID');
      const task = await queue.enqueue({ script, requestedBy: options.user.id, type: 'apply_selection', transition,
        input: { baseVersionId: String(version._id), sourceId: String(source._id), draftId: String(pending.draftId),
          lockedSelection: result.selection, fullScript: result.fullScript, selectionLocked: true, adoptedSuggestions: [],
          changeSummary: source.sentences.filter((s) => selectedIds(version.selection, source).has(s.id) !== selectedIds(result.selection, source).has(s.id))
            .map((s) => `${selectedIds(result.selection, source).has(s.id) ? '加回' : '移除'}：${s.text}`) } });
      await ReviewEvent.findByIdAndUpdate(pending._id, { $set: { taskId: task._id } });
      return toPublicTask(task);
    });
  }
  async function applySuggestions(options) {
    await loadForManage(options);
    return withRecutTransition(options.scriptId, async (transition) => {
      const { script, version, source, pending } = await load(options); requireRevision(options, script); requireEditable(script, version);
      if (pending) conflict('請先套用修改或全部復原。');
      const ids = options.suggestionIds, confirmed = options.confirmedSelectionChangeIds || [];
      for (const values of [ids, confirmed]) {
        if (!Array.isArray(values) || values.length > 50 || new Set(values).size !== values.length) validation('建議 ID 清單無效。');
        for (const id of values) assertObjectId(id, 'suggestion');
      }
      if (!ids.length || confirmed.some((id) => !ids.includes(id)) || (options.reasonLabel !== undefined && !RECUT_EDIT_REASONS.includes(options.reasonLabel))) validation('選取建議或修改原因無效。');
      const all = await ReviewEvent.find({ scriptId: script._id, versionId: version._id, kind: 'suggestion' }).lean();
      const chosen = ids.map((id) => all.find((s) => same(s._id, id)));
      if (chosen.some((s) => !s || !s.proposal || !['selection', 'presentation'].includes(s.proposal.kind))) validation('建議不存在、版本過時或尚無可套用的提案。');
      for (const s of chosen) if (needsConfirmation(s, version.selection) && !confirmed.includes(String(s._id))) conflict(`此建議會改動您鎖定的選段：${s.proposal.impact || s.content}。請確認後再套用。`, 'RECUT_LOCK_CONFIRM_REQUIRED');
      let result = preview(source, version.selection); const changed = new Map();
      for (const s of chosen) if (s.proposal.kind === 'selection') {
        for (const c of s.proposal.changes || []) {
          if (changed.has(c.sentenceId) && changed.get(c.sentenceId) !== c.action) validation('所選建議互相衝突，請分開處理。');
          changed.set(c.sentenceId, c.action);
        }
        result = projectSelection(source, version.selection, result.selection, s.proposal.changes);
      }
      if (!result.durationValid) throw new AppError('採納後總長必須為 30～65 秒。', 422, 'RECUT_DURATION_INVALID');
      const presentationOnly = chosen.every((s) => s.proposal.kind === 'presentation');
      const allowedPaths = chosen.flatMap((s) => s.proposal.allowedPaths || []);
      if (presentationOnly && (chosen.some((s) => !Array.isArray(s.proposal.allowedPaths) || !s.proposal.allowedPaths.length)
        || allowedPaths.some((path) => !validPresentationPath(path)))) conflict('建議尚未提供可修改的呈現範圍。', 'RECUT_SUGGESTION_NOT_READY');
      const task = await queue.enqueue({ script, requestedBy: options.user.id, type: 'apply_suggestions', transition, input: {
        baseVersionId: String(version._id), sourceId: String(source._id), lockedSelection: result.selection, fullScript: result.fullScript,
        selectionLocked: true, ...(presentationOnly ? { originalNarrationKey: narrationKey(version),
          presentationScope: { before: { plan: version.plan, theme: version.theme }, allowedPaths } } : {}),
        adoptedSuggestions: chosen.map((s) => ({ id: String(s._id), ...s.proposal })), confirmedSelectionChangeIds: confirmed,
        changeSummary: chosen.map((s) => s.proposal.proposedChange || s.content || '套用建議') } });
      for (const s of all) await ReviewEvent.findByIdAndUpdate(s._id, { $set: { adopted: ids.includes(String(s._id)),
        adoptedAt: ids.includes(String(s._id)) ? now() : null, ...(ids.includes(String(s._id)) ? { taskId: task._id, reasonLabel: options.reasonLabel } : {}) } });
      for (const s of chosen) if (s.proposal.kind === 'selection') for (const c of s.proposal.changes) {
        await ReviewEvent.create({ scriptId: script._id, versionId: version._id, kind: 'edit', actorId: options.user.id,
          taskId: task._id, suggestionId: s._id, sentenceId: c.sentenceId, action: c.action, reasonLabel: options.reasonLabel,
          originalLabel: version.selection.sentenceLabels.find((l) => l.sentenceId === c.sentenceId).label, occurredAt: now() });
      }
      return toPublicTask(task);
    });
  }
  async function act(options, event) {
    await loadForManage(options);
    await withRecutTransition(options.scriptId, async (transition) => {
      const { script, source, version } = await load(options);
      const current = recutSnapshot(script);
      const retry = event === 'approve_asset' && ['asset_approved', 'published'].includes(current.state)
        && same(options.versionId, current.currentVersionId) && same(options.assetId, current.currentAssetId)
        && options.generationVersion === current.currentAssetGenerationVersion
        && Number.isSafeInteger(options.expectedRevision) && options.expectedRevision >= 0 && options.expectedRevision <= current.revision;
      if (!retry) requireRevision(options, script);
      if (['approve_script', 'approve_asset'].includes(event)) {
        const actual = preview(source, version.selection);
        if (!actual.durationValid || version.fullScript !== actual.fullScript) conflict('講稿、選段或總長不一致，請先重新整理講稿。');
      }
      if (event === 'approve_asset' || event === 'reject_asset') {
        assertObjectId(options.assetId, 'short asset');
        if (!Number.isSafeInteger(options.generationVersion) || options.generationVersion < 1) validation('generationVersion 須為正整數。');
      }
      if (event === 'reject_asset') {
        if (!['presentation', 'content'].includes(options.scope)) validation('scope 須為 presentation 或 content。');
        options.reasons = require('./shortAsset.service').normalizeReviewReasons('rejected', options.reasons);
      }
      await transition({ event, scope: options.scope, reasons: options.reasons, versionId: options.versionId, expectedRevision: options.expectedRevision, actorId: options.user.id,
        assetId: options.assetId, generationVersion: options.generationVersion,
        ...(retry ? { expectedRevision: current.revision } : {}) });
      if (event === 'approve_script' || event === 'approve_asset') {
        for (const s of await ReviewEvent.find({ scriptId: options.scriptId, versionId: options.versionId, kind: 'suggestion', adopted: null }).lean()) {
          await ReviewEvent.findByIdAndUpdate(s._id, { $set: { adopted: false, adoptedAt: null } });
        }
      }
    });
    // Release script lock before publishing; publishing takes the same lock.
    if (event === 'queue_render') await require('./recutWorker.service').ensureRenderJob(options.scriptId);
    if (event === 'approve_asset') await require('./shortAssetPublish.service').publishApprovedShortAsset(await ShortAsset.findById(options.assetId).lean());
    if (event === 'reject_asset') {
      const asset = await ShortAsset.findById(options.assetId).lean();
      await require('./notification.service').notifyShortAssetRejected({ asset, reasons: options.reasons });
      await require('./shortAssetPublish.service').privatizeRejectedShortAsset(asset);
    }
    return getReview(options);
  }
  async function recordTime(options) {
    await loadForManage(options);
    return withRecutTransition(options.scriptId, async () => {
      if (!RECUT_TIMING_PHASES.includes(options.phase) || !['start', 'stop'].includes(options.action)) validation('計時階段或動作無效。');
      assertObjectId(options.versionId, 'recut version');
      if (options.action === 'stop') {
        assertObjectId(options.timingId, 'timing');
        const event = await ReviewEvent.findById(options.timingId).lean();
        if (!event || event.kind !== 'timing' || !same(event.scriptId, options.scriptId) || !same(event.versionId, options.versionId)
          || !same(event.actorId, options.user.id) || event.phase !== options.phase) validation('計時紀錄不屬於這次操作。');
        if (event.endedAt) return publicTiming(event);
        const endedAt = now();
        return publicTiming(await ReviewEvent.findByIdAndUpdate(event._id, { $set: { endedAt, durationMs: Math.max(0, endedAt - new Date(event.startedAt)) } }, { new: true }));
      }
      if (options.timingId !== undefined) validation('開始計時不能指定 timingId。');
      const { script, version } = await load(options); requireRevision(options, script); const state = recutSnapshot(script).state;
      const allowed = { script_review: ['script_review', 'script_approved'], asset_review: ['asset_review', 'asset_approved', 'published'],
        production_wait: ['queued', 'generating', 'updating', 'render_queued', 'rendering'] };
      if (!allowed[options.phase].includes(state)) conflict('計時階段與目前狀態不符。');
      const open = await ReviewEvent.find({ scriptId: script._id, versionId: version._id, kind: 'timing', actorId: options.user.id, phase: options.phase, endedAt: null }).lean();
      if (open.length) return publicTiming(open[0]);
      return publicTiming(await ReviewEvent.create({ scriptId: script._id, versionId: version._id, kind: 'timing', actorId: options.user.id,
        phase: options.phase, startedAt: now(), endedAt: null, durationMs: null }));
    });
  }
  return { getReview, editSelection, restoreSelection, applySelection, applySuggestions, recordTime,
    approveScript: (o) => act(o, 'approve_script'), queueRender: (o) => act(o, 'queue_render'), approveAsset: (o) => act(o, 'approve_asset'), rejectAsset: (o) => act(o, 'reject_asset') };
}
module.exports = { createRecutReviewService, ...createRecutReviewService() };
