const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  scriptId: { type: Schema.Types.ObjectId, ref: 'ShortScript', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  versionId: { type: Schema.Types.ObjectId, ref: 'RecutVersion', required: true },
  status: { type: String, enum: ['queued', 'leased', 'completing', 'succeeded', 'failed', 'cancelled'], default: 'queued' },
  planHash: { type: String, required: true },
  planVersion: { type: String, default: null }, renderDurationMs: { type: Number, min: 0, default: null },
  workerId: { type: Schema.Types.ObjectId, ref: 'RecutWorker', default: null },
  leaseHash: { type: String, default: null, select: false }, leaseExpiresAt: { type: Date, default: null },
  attemptCount: { type: Number, default: 0 },
  excludedWorkerIds: { type: [Schema.Types.ObjectId], default: [] },
  attempts: { type: [Schema.Types.Mixed], default: [] },
  checks: { type: Schema.Types.Mixed, default: null }, error: { type: Schema.Types.Mixed, default: null },
  filePath: { type: String, default: null },
  resultAssetId: { type: Schema.Types.ObjectId, ref: 'ShortAsset', default: null },
  notifiedAt: { type: Date, default: null }, queuedAt: { type: Date, required: true }, finishedAt: Date,
}, { timestamps: true });
schema.index({ scriptId: 1, versionId: 1 }, { unique: true });
schema.index({ status: 1, queuedAt: 1 });
module.exports = mongoose.model('RecutRenderJob', schema);
