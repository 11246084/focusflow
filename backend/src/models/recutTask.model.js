const mongoose = require('mongoose');
const { RECUT_TASK_TYPES, RECUT_TASK_STATUSES } = require('../constants/recut');
const { Schema } = mongoose;
const schema = new Schema({
  scriptId: { type: Schema.Types.ObjectId, ref: 'ShortScript', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: Object.values(RECUT_TASK_TYPES), required: true },
  status: { type: String, enum: Object.values(RECUT_TASK_STATUSES), default: RECUT_TASK_STATUSES.QUEUED },
  callLimit: { type: Number, required: true, min: 2, immutable: true }, callsUsed: { type: Number, default: 0, min: 0 },
  stepIds: { type: [String], required: true }, input: { type: Schema.Types.Mixed, default: {} },
  baseSnapshot: { type: Schema.Types.Mixed, required: true },
  resultVersionId: { type: Schema.Types.ObjectId, ref: 'RecutVersion', default: null },
  queuedAt: { type: Date, required: true }, startedAt: { type: Date, default: null }, finishedAt: { type: Date, default: null },
  readyAt: { type: Date, default: null },
  error: { type: Schema.Types.Mixed, default: null }, notifiedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ status: 1, queuedAt: 1, _id: 1 });
schema.index({ scriptId: 1, createdAt: -1 });
module.exports = mongoose.model('RecutTask', schema);
