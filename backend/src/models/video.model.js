const mongoose = require('mongoose');
const {
  VIDEO_SOURCE_TYPE_VALUES,
  VIDEO_SOURCE_TYPES,
  VIDEO_PROCESSING_STATUS_VALUES,
} = require('../constants/enums');

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function pickField(video, camelCaseName, snakeCaseName) {
  return video?.[camelCaseName] ?? video?.[snakeCaseName];
}

function isAppOwnedVideoRecord(video) {
  return Boolean(
    video
    && hasValue(video.courseId)
    && hasValue(video.uploadedBy)
    && hasValue(video.title)
    && hasValue(video.processing?.status),
  );
}

function isPipelineMetadataRecord(video) {
  return Boolean(hasValue(pickField(video, 'videoId', 'video_id')) && !isAppOwnedVideoRecord(video));
}

const processingSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: VIDEO_PROCESSING_STATUS_VALUES,
      required: true,
    },
    errorMessage: {
      type: String,
      default: null,
      trim: true,
    },
    errorCode: {
      type: String,
      default: null,
      trim: true,
    },
    queuedAt: {
      type: Date,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    _id: false,
  },
);

const videoSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    sourceType: {
      type: String,
      enum: VIDEO_SOURCE_TYPE_VALUES,
      default: VIDEO_SOURCE_TYPES.UPLOAD,
    },
    sourceUrl: {
      type: String,
      default: null,
      trim: true,
    },
    videoId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    fileName: {
      type: String,
      default: null,
      trim: true,
    },
    filePath: {
      type: String,
      default: null,
      trim: true,
    },
    audioPath: {
      type: String,
      default: null,
      trim: true,
    },
    storagePath: {
      type: String,
      default: null,
      trim: true,
    },
    durationSec: {
      type: Number,
      default: null,
      min: 0,
    },
    week: {
      type: Number,
      default: null,
      min: 0,
    },
    lesson: {
      type: Number,
      default: null,
      min: 0,
    },
    videoSource: {
      type: String,
      default: null,
      trim: true,
    },
    videoUrl: {
      type: String,
      default: null,
      trim: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // `videos` is temporarily shared with pipeline metadata docs. Backend app-layer
    // ownership is defined by course/upload/processing fields, not by `video_id` alone.
    // `completed` means the current processing pipeline finished and is ready
    // for later indexing / QA integration. We intentionally do not mix in `indexed`.
    processing: {
      type: processingSchema,
      required: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

videoSchema.index({ courseId: 1 });

videoSchema.statics.isAppOwnedRecord = isAppOwnedVideoRecord;
videoSchema.statics.isPipelineMetadataRecord = isPipelineMetadataRecord;

module.exports = mongoose.model('Video', videoSchema);
