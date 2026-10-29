const mongoose = require('mongoose');
const { RECUT_APPROVAL_TYPES } = require('../constants/recut');
const { Schema } = mongoose;
const schema = new Schema({
  scriptId: { type: Schema.Types.ObjectId, ref: 'ShortScript', required: true },
  versionId: { type: Schema.Types.ObjectId, ref: 'RecutVersion', required: true },
  type: { type: String, enum: RECUT_APPROVAL_TYPES, required: true },
  assetId: { type: Schema.Types.ObjectId, ref: 'ShortAsset', default: null }, generationVersion: { type: Number, default: null },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, approvedAt: { type: Date, required: true },
  inheritedFromApprovalId: { type: Schema.Types.ObjectId, ref: 'RecutApproval', default: null },
}, { timestamps: true });
schema.index({ scriptId: 1, versionId: 1, type: 1 });
module.exports = mongoose.model('RecutApproval', schema);
