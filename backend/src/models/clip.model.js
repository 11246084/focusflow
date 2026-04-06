const mongoose = require('mongoose');

const clipSchema = new mongoose.Schema(
  {
    segmentId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      default: null,
    },
    clipUrl: {
      type: String,
      required: true,
      trim: true,
    },
    keyPoints: {
      type: [String],
      default: [],
    },
    jumpUrl: {
      type: String,
      default: null,
      trim: true,
    },
    hitCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    collection: 'clips',
  },
);

module.exports = mongoose.model('Clip', clipSchema);
