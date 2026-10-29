const { resolveSelection } = require('./recutSelectionValidation.service');
const { recutQueue } = require('./recutQueue.service');
const RecutSource = require('../models/recutSource.model');
const AppError = require('../utils/appError');
const selectionKey = (s) => JSON.stringify({ ranges: (s.ranges || []).map((r) => [r.from, r.to, r.startAt || null, r.endAt || null]),
  opening: s.openingSentenceId || null, locked: [...(s.lockedSentenceIds || [])].sort() });
function createRecutReviewSteps({ cards, wholeCheck }) {
  if (cards?.stage !== 'cards' || wholeCheck?.stage !== 'wholeCheck') throw new TypeError('Provide cards and wholeCheck steps.');
  return [{ id: 'recut-review-prepare-v1', stage: 'selection', run: async ({ task }) => {
    const input = task.input; const source = await RecutSource.findById(input.sourceId).lean();
    if (!source || String(source.scriptId) !== String(task.scriptId)) throw new AppError('修改來源無效。', 422, 'RECUT_SOURCE_INVALID');
    const selectionResult = resolveSelection(source, input.lockedSelection);
    return { ...input, selection: selectionResult.selection, selectionResult, fullScript: selectionResult.fullScript, selectionLocked: true };
  } }, cards, wholeCheck];
}
function registerRecutReviewSteps(steps, queue = recutQueue) {
  const pipeline = createRecutReviewSteps(steps);
  for (const type of ['apply_selection', 'apply_suggestions']) queue.registerSteps(type, pipeline);
}
module.exports = { createRecutReviewSteps, registerRecutReviewSteps, selectionKey };
