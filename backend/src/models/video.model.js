const mongoose = require('mongoose');
const {
  VIDEO_SOURCE_TYPE_VALUES,
  VIDEO_SOURCE_TYPES,
  VIDEO_PROCESSING_STATUS_VALUES,
  VIDEO_PROCESSING_STATUSES,
} = require('../constants/enums');

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
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    processing: {
      status: {
        type: String,
        enum: VIDEO_PROCESSING_STATUS_VALUES,
        default: VIDEO_PROCESSING_STATUSES.UPLOADED,
      },
      errorMessage: {
        type: String,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Video', videoSchema);
