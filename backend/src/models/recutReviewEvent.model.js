const mongoose = require('mongoose');
const { RECUT_REASON_LABELS, RECUT_EDIT_REASONS, RECUT_TIMING_PHASES } = require('../constants/recut');
const { Schema } = mongoose;
// 一筆建議、一筆修改或一段操作時間各一份文件；不在 ShortScript 內累積陣列。
const schema = new Schema({
  scriptId: { type: Schema.Types.ObjectId, ref: 'ShortScript', required: true },
  versionId: { type: Schema.Types.ObjectId, ref: 'RecutVersion', required: true },
  kind: { type: String, enum: ['suggestion', 'edit', 'timing'], required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  taskId: { type: Schema.Types.ObjectId, ref: 'RecutTask', default: null },
  draftId: { type: Schema.Types.ObjectId, default: null }, revertedAt: { type: Date, default: null },
  suggestionType: { type: String, trim: true }, content: { type: String, trim: true },
  adopted: { type: Boolean, default: null }, adoptedAt: Date,
  sentenceId: { type: String, trim: true }, originalLabel: { type: String, enum: RECUT_REASON_LABELS, trim: true },
  action: { type: String, trim: true }, reasonLabel: { type: String, enum: RECUT_EDIT_REASONS, trim: true },
  occurredAt: { type: Date, default: Date.now },
  phase: { type: String, enum: RECUT_TIMING_PHASES }, startedAt: Date, endedAt: Date, durationMs: Number,
}, { timestamps: true });
schema.index({ scriptId: 1, versionId: 1, kind: 1 });
module.exports = mongoose.model('RecutReviewEvent', schema);
