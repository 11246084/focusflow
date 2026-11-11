const mongoose = require('mongoose');
const { RECUT_REASON_LABELS, RECUT_THEMES } = require('../constants/recut');
const { Schema } = mongoose;
const rangeSchema = new Schema({
  from: { type: String, required: true, trim: true }, to: { type: String, required: true, trim: true },
  startAt: { type: String, trim: true }, endAt: { type: String, trim: true },
}, { _id: false });
const labelSchema = new Schema({
  sentenceId: { type: String, required: true, trim: true },
  label: { type: String, required: true, enum: RECUT_REASON_LABELS, trim: true },
}, { _id: false });
const schema = new Schema({
  scriptId: { type: Schema.Types.ObjectId, ref: 'ShortScript', required: true },
  taskId: { type: Schema.Types.ObjectId, ref: 'RecutTask', default: null },
  sourceId: { type: Schema.Types.ObjectId, ref: 'RecutSource', required: true },
  parentVersionId: { type: Schema.Types.ObjectId, ref: 'RecutVersion', default: null },
  selection: {
    ranges: { type: [rangeSchema], default: [] }, sentenceLabels: { type: [labelSchema], default: [] },
    openingSentenceId: { type: String, default: null, trim: true },
    answerable: { type: Boolean, required: true }, unanswerableReason: { type: String, default: null, trim: true },
    lockedSentenceIds: { type: [String], default: [] },
  },
  fullScript: { type: String, default: '', trim: true },
  plan: { type: Schema.Types.Mixed, default: null },
  modelId: { type: String, required: true, trim: true },
  assetVersions: { type: Map, of: String, default: {} },
  shortRenderVersion: { type: String, required: true, trim: true },
  theme: { type: String, enum: RECUT_THEMES, default: 'N2' },
}, { timestamps: true });
schema.index({ scriptId: 1, createdAt: -1 });
// 版本只 create；目前版參照由狀態機原子切換，不用覆寫舊文件。
module.exports = mongoose.model('RecutVersion', schema);
