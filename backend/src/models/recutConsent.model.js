const mongoose = require('mongoose');
const { KINDS } = require('../constants/recutConsent');

const recordSchema = new mongoose.Schema({
  id: { type: String, required: true },
  requestId: { type: String, required: true },
  fingerprint: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', default: null },
  sourceId: { type: String, default: null },
  kind: { type: String, enum: KINDS, required: true },
  choice: { type: String, enum: ['granted', 'declined', 'original', 'synthetic', 'withdrawn'], required: true },
  termsVersion: { type: String, required: true },
  recordedAt: { type: Date, required: true },
  evidenceRef: { type: String, default: null },
}, { _id: false });

// One teacher document is the atomic boundary for decisions + withdrawal intent.
// Repository writes only append records ($push); no history rewrite/delete API.
const schema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  revision: { type: Number, required: true, default: 0 },
  records: { type: [recordSchema], default: [] },
  withdrawals: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('RecutConsent', schema);
