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
