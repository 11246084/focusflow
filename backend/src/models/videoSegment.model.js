const mongoose = require('mongoose');

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
    chunk_id: {
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
    video_id: {
      type: String,
      default: null,
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
    transcript: {
      type: String,
      required: true,
      trim: true,
    },
    original_text: {
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
  },
  {
    timestamps: true,
    collection: 'video_segments',
  },
);

module.exports = mongoose.model('VideoSegment', videoSegmentSchema);
