const mongoose = require('mongoose');

// Transactional outbox: one idempotent remote privacy action per deleted video.
// No automatic index/collection changes on a shared database.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, required: true },
  youtubeVideoId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'running', 'completed'], default: 'pending' },
  attemptId: { type: String, default: null },
  attemptCount: { type: Number, default: 0 },
  claimedAt: { type: Date, default: null },
  nextAttemptAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  lastError: { type: String, default: null },
}, { timestamps: true, autoIndex: false, autoCreate: false });

module.exports = mongoose.model('CourseDeletionJob', schema);
