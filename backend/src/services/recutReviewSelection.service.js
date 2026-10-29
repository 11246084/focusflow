const { resolveSelection, KEEP } = require('./recutSelectionValidation.service');
const { selectionKey } = require('./recutReviewSteps.service');
const { RECUT_EDIT_REASONS } = require('../constants/recut');
const AppError = require('../utils/appError');
const copy = (v) => JSON.parse(JSON.stringify(v));
function bad(message) { throw new AppError(message, 400, 'VALIDATION_ERROR'); }
function validateChanges(changes, source) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) bad('changes 須為 1～100 筆整句修改。');
  const ids = new Set(source.sentences.map((s) => s.id)); const seen = new Set();
  for (const c of changes) {
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some((k) => !['sentenceId', 'action', 'reasonLabel'].includes(k))
      || !ids.has(c.sentenceId) || seen.has(c.sentenceId) || !['add', 'remove'].includes(c.action)
      || (c.reasonLabel !== undefined && !RECUT_EDIT_REASONS.includes(c.reasonLabel))) bad('整句修改的句子、動作或原因無效。');
    seen.add(c.sentenceId);
  }
}
function selectedIds(selection, source) {
  const index = new Map(source.sentences.map((s, i) => [s.id, i])); const result = new Set();
  for (const r of selection.ranges) for (let i = index.get(r.from); i <= index.get(r.to); i++) result.add(source.sentences[i].id);
  if (selection.openingSentenceId) result.add(selection.openingSentenceId);
  return result;
}
function preview(source, selection, originalOpening = selection.openingSentenceId) {
  const result = resolveSelection(source, selection, { allowInvalidDuration: true });
  return { selection: result.selection, durationSec: result.durationSec, durationValid: result.durationSec >= 30 && result.durationSec <= 65,
    fullScript: result.fullScript, warnings: originalOpening && !selection.openingSentenceId ? ['這句是目前的片頭，移除後會改變開場。'] : [] };
}
function projectSelection(source, original, current, changes) {
  validateChanges(changes, source);
  const desired = selectedIds(current, source); const base = selectedIds(original, source);
  const actual = changes.filter((c) => desired.has(c.sentenceId) !== (c.action === 'add'));
  for (const c of actual) { if (c.action === 'add') desired.add(c.sentenceId); else desired.delete(c.sentenceId); }
  const restored = desired.size === base.size && [...desired].every((id) => base.has(id));
  if (restored) return { ...preview(source, copy(original)), restored: true, actual };
  const index = new Map(source.sentences.map((s, i) => [s.id, i])); const used = new Set(); const ranges = [];
  const opening = original.openingSentenceId && desired.has(original.openingSentenceId) ? original.openingSentenceId : null;
  for (const r of original.ranges) {
    let group = [];
    const flush = () => { if (!group.length) return; const from = group[0], to = group.at(-1);
      ranges.push({ from, to, ...(from === r.from && r.startAt !== undefined ? { startAt: r.startAt } : {}),
        ...(to === r.to && r.endAt !== undefined ? { endAt: r.endAt } : {}) }); group = []; };
    for (let i = index.get(r.from); i <= index.get(r.to); i++) {
      const id = source.sentences[i].id;
      if (desired.has(id) && id !== opening) { used.add(id); group.push(id); } else flush();
    }
    flush();
  }
  for (const id of desired) if (!used.has(id) && id !== opening) ranges.push({ from: id, to: id });
  ranges.sort((a, b) => index.get(a.from) - index.get(b.from));
  const labels = new Map(original.sentenceLabels.map((l) => [l.sentenceId, l.label]));
  const locked = new Set(original.lockedSentenceIds || []);
  for (const s of source.sentences) if (desired.has(s.id) !== base.has(s.id)) locked.add(s.id);
  const selection = { answerable: true, unanswerableReason: null, ranges, openingSentenceId: opening,
    sentenceLabels: source.sentences.map((s) => ({ sentenceId: s.id,
      label: s.id === opening ? '冷開場' : desired.has(s.id) ? (KEEP.has(labels.get(s.id)) && labels.get(s.id) !== '冷開場' ? labels.get(s.id) : '結論或定義')
        : KEEP.has(labels.get(s.id)) ? '離題' : labels.get(s.id) })), lockedSentenceIds: [...locked].sort((a, b) => index.get(a) - index.get(b)) };
  return { ...preview(source, selection, original.openingSentenceId), restored: selectionKey(selection) === selectionKey(original), actual };
}
module.exports = { projectSelection, preview, selectedIds, validateChanges };
