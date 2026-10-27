const mongoose = require('mongoose');
const { RECUT_STAGES, RECUT_ATTEMPT_STATUSES } = require('../constants/recut');
const { Schema } = mongoose;
const schema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: 'RecutTask', required: true, index: true },
  stepId: { type: String, required: true, trim: true }, stage: { type: String, enum: Object.keys(RECUT_STAGES), required: true },
  status: { type: String, enum: RECUT_ATTEMPT_STATUSES, required: true },
  input: { type: Schema.Types.Mixed, default: null }, output: { type: Schema.Types.Mixed, default: null },
  validation: { type: Schema.Types.Mixed, default: null }, modelId: { type: String, default: null, trim: true },
  usageMetadata: { type: Schema.Types.Mixed, default: null }, consumesCall: { type: Boolean, default: false },
  startedAt: { type: Date, required: true }, finishedAt: { type: Date, default: null }, durationMs: { type: Number, default: null },
  error: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true });
module.exports = mongoose.model('RecutAttempt', schema);
