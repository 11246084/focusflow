const mongoose = require('mongoose');
const {
  VIDEO_SOURCE_TYPE_VALUES,
  VIDEO_SOURCE_TYPES,
  VIDEO_PROCESSING_STATUS_VALUES,
} = require('../constants/enums');

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
    video_id: {
      type: String,
      default: null,
      trim: true,
      unique: true,
      sparse: true,
    },
    file_name: {
      type: String,
      default: null,
      trim: true,
    },
    file_path: {
      type: String,
      default: null,
      trim: true,
    },
    audio_path: {
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
    duration_sec: {
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
    video_source: {
      type: String,
      default: null,
      trim: true,
    },
    video_url: {
      type: String,
      default: null,
      trim: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // `completed` means the current processing pipeline finished and is ready
    // for later indexing / QA integration. We intentionally do not mix in `indexed`.
    processing: {
      type: processingSchema,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Video', videoSchema);
