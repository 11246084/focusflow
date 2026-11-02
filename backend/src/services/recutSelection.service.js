const ShortScript = require('../models/shortScript.model');
const RecutSource = require('../models/recutSource.model');
const { getSetting } = require('./recutSettings.service');
const { createRecutDecisionPoint, runValidatedDecision } = require('./recutDecision.service');
const { validateSelection } = require('./recutSelectionValidation.service');
const { INSTRUCTIONS, responseSchema } = require('../prompts/recutSelection');
const AppError = require('../utils/appError');
function createRecutSelectionStep({ decide = createRecutDecisionPoint(), readSetting = getSetting } = {}) {
  return { id: 'recut-selection-v1', stage: 'selection', run: async (context) => {
    const { task, data } = context;
    const source = await RecutSource.findById(data.sourceId).lean();
    const script = await ShortScript.findById(task.scriptId).lean();
    if (!source || !script || String(source.scriptId) !== String(task.scriptId)) throw new AppError('選段來源不屬於此腳本。', 422, 'RECUT_SOURCE_INVALID');
    const model = task.settingsSnapshot?.model || await readSetting('recut.geminiModel');
    if (model?.provider !== 'gemini' || typeof model.model !== 'string' || !model.model.trim()) throw new AppError('Recut 模型設定無效。', 503, 'RECUT_SETTING_INVALID');
    const input = { question: script.topic,
      variants: [...(script.sourceQuestions || [])].sort((a, b) => b.askCount - a.askCount).slice(0, 5).map((q) => ({ question: q.question, askCount: q.askCount })),
      sentences: source.sentences.map((s) => ({ id: s.id, text: s.text, startSec: s.startSec, endSec: s.endSec, marker: s.retrievalHit ? '★' : '', words: s.words,
        selectionAllowed: !(source.excludedSentenceIds || []).includes(s.id),
        exclusionReason: (source.excludedSentenceIds || []).includes(s.id) ? '辨識視窗邊界截斷，禁止選用或加回' : null })) };
    const result = await runValidatedDecision({ ...context, decide, model, instructions: INSTRUCTIONS, input, responseSchema,
      validate: (output) => validateSelection(source, output) });
    const output = { sourceId: source._id, selection: result.selection, selectionResult: result, fullScript: result.fullScript, modelId: model.model };
    if (!result.selection.answerable) output.version = { sourceId: source._id, selection: result.selection, fullScript: '', plan: null, modelId: model.model, shortRenderVersion: 'not-rendered' };
    return output;
  } };
}
module.exports = { createRecutSelectionStep };
