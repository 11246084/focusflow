const mongoose = require('mongoose');
const env = require('../config/env');

const videoSegmentVideoSchema = new mongoose.Schema(
  {
    video_id: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    clip_id: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    clip_path: {
      type: String,
      default: null,
      trim: true,
    },
    start_sec: {
      type: Number,
      default: null,
      min: 0,
    },
    end_sec: {
      type: Number,
      default: null,
      min: 0,
    },
    embedding: {
      type: [Number],
      default: [],
    },
  },
  {
    timestamps: false,
    collection: env.videoSegmentVideoCollection,
  },
);

module.exports = mongoose.model('VideoSegmentVideo', videoSegmentVideoSchema);
