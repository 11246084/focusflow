const mongoose = require('mongoose');
const env = require('../config/env');

const videoSegmentSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      default: null,
      index: true,
    },
    segmentId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    chunkId: {
      type: String,
      default: null,
      trim: true,
    },
    videoId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    startSec: {
      type: Number,
      default: null,
      min: 0,
    },
    endSec: {
      type: Number,
      default: null,
      min: 0,
    },
    text: {
      type: String,
      default: null,
      trim: true,
    },
    corrections: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    embedding: {
      type: [Number],
      default: [],
    },
    // Leaf 保存產生向量時的完整契約，供 health 判斷資料能否由目前的 query 安全查詢。
    embeddingProvider: { type: String, default: null, trim: true },
    embeddingModel: { type: String, default: null, trim: true },
    embeddingDimension: { type: Number, default: null },
    // Legacy pipeline metadata is retained for audit only; stable gemini-embedding-2 uses null.
    embeddingTaskType: { type: String, default: null, trim: true },
    embeddingInstructionVersion: { type: String, default: null, trim: true },
    generationVersion: { type: String, default: null, trim: true },
    normalizationVersion: { type: String, default: null, trim: true },
    embeddingContractVersion: { type: String, default: null, trim: true },
  },
  {
    timestamps: true,
    collection: env.videoSegmentCollection,
  },
);

module.exports = mongoose.model('VideoSegment', videoSegmentSchema);
