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
    segment_id: {
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
    video_id: {
      type: String,
      default: null,
      trim: true,
    },
    startSec: {
      type: Number,
      default: null,
      min: 0,
    },
    start_sec: {
      type: Number,
      default: null,
      min: 0,
    },
    endSec: {
      type: Number,
      default: null,
      min: 0,
    },
    end_sec: {
      type: Number,
      default: null,
      min: 0,
    },
    transcript: {
      type: String,
      default: null,
      trim: true,
    },
    text: {
      type: String,
      default: null,
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
    collection: env.videoSegmentCollection,
  },
);

module.exports = mongoose.model('VideoSegment', videoSegmentSchema);
