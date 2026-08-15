const mongoose = require('mongoose');
const env = require('../config/env');

// Phase 2-2 Parent Chunk storage（契約：docs/Phase2-2_Hierarchy_Data_Contract_v1.md §10）。
// Parent 與 Leaf（VideoSegment）使用不同 ID namespace，不共用 collection。
const videoSegmentParentSchema = new mongoose.Schema(
  {
    parentId: {
      type: String,
      required: true,
      trim: true,
    },
    videoId: {
      // canonical string = String(Video._id)，與 video_segments_text.videoId 同 namespace
      type: String,
      required: true,
      trim: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      // Parent retrieval always filters by course scope; an unresolved courseId is not publishable.
      required: true,
    },
    hierarchyLevel: {
      type: Number,
      required: true,
      default: 1,
    },
    documentType: {
      type: String,
      required: true,
      default: 'parent_chunk',
      trim: true,
    },
    startSec: {
      type: Number,
      required: true,
      min: 0,
    },
    endSec: {
      type: Number,
      required: true,
      min: 0,
    },
    text: {
      type: String,
      required: true,
    },
    childChunkIds: {
      // 有序 Leaf chunkId 清單；順序是 retrieval 契約的一部分，不可排序或去重
      type: [String],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'childChunkIds must be a non-empty array.',
      },
    },
    childCount: {
      type: Number,
      required: true,
      min: 1,
    },
    order: {
      type: Number,
      required: true,
      min: 0,
    },
    embedding: {
      type: [Number],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value)
          && value.length === 3072
          && value.every((item) => typeof item === 'number' && Number.isFinite(item)),
        message: 'embedding must contain exactly 3072 finite numbers.',
      },
    },
    // Parent 也必須保存完整向量契約；僅有相同維度不足以證明兩邊可以互相查詢。
    embeddingProvider: {
      type: String,
      default: null,
      trim: true,
    },
    embeddingModel: {
      type: String,
      default: null,
      trim: true,
    },
    embeddingDimension: {
      type: Number,
      required: true,
      enum: [3072],
    },
    embeddingTaskType: {
      // Legacy taskType is retained for audit; stable gemini-embedding-2 must store null.
      type: String,
      default: null,
      trim: true,
    },
    embeddingSchemaVersion: {
      type: String,
      default: null,
      trim: true,
    },
    embeddingInstructionVersion: {
      type: String,
      default: null,
      trim: true,
    },
    embeddingContractVersion: {
      type: String,
      default: null,
      trim: true,
    },
    preprocessingVersion: {
      type: String,
      default: null,
      trim: true,
    },
    normalizationVersion: {
      type: String,
      default: null,
      trim: true,
    },
    hierarchyFingerprint: {
      type: String,
      default: null,
      trim: true,
    },
    sourceLeafFingerprint: {
      type: String,
      default: null,
      trim: true,
    },
    parentEmbeddingFingerprint: {
      type: String,
      default: null,
      trim: true,
    },
    documentSchemaVersion: {
      type: String,
      default: 'parent_document_v1',
      trim: true,
    },
    // Active generation is part of the retrieval filter; stale generations must never be served.
    generationVersion: {
      type: String,
      default: null,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: env.videoSegmentParentCollection,
  },
);

// MVP unique 策略：單 generation，重跑同影片以 parentId idempotent upsert 覆蓋
videoSegmentParentSchema.index({ parentId: 1 }, { unique: true });
// Course + Video scope 檢索
videoSegmentParentSchema.index({ courseId: 1, videoId: 1 });
// Generation audit / stale cleanup（契約 §11）
videoSegmentParentSchema.index({ videoId: 1, hierarchyFingerprint: 1 });
videoSegmentParentSchema.index({ videoId: 1, generationVersion: 1, isActive: 1 });

module.exports = mongoose.model('VideoSegmentParent', videoSegmentParentSchema);
