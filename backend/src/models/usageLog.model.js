const mongoose = require('mongoose');
const { USAGE_LOG_EVENT_VALUES } = require('../constants/enums');

const usageLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      default: null,
      index: true,
    },
    event: {
      type: String,
      enum: USAGE_LOG_EVENT_VALUES,
      required: true,
    },
    durationSec: {
      type: Number,
      default: null,
      min: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // 刻意不設 TTL：UsageLog 屬於歷史紀錄，刪影片／刪課程都保留，
    // 後台統計與 backfillQuestionsFromUsageLogs.js 都依賴完整歷史。
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'usage_logs',
  },
);

module.exports = mongoose.model('UsageLog', usageLogSchema);
