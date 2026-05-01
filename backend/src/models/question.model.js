const mongoose = require('mongoose');
const {
  QUESTION_STATUS_VALUES,
  QUESTION_STATUSES,
  QUESTION_SOURCE_VALUES,
  QUESTION_SOURCES,
} = require('../constants/enums');

const questionMatchSchema = new mongoose.Schema(
  {
    segmentId: {
      type: String,
      default: null,
      trim: true,
    },
    videoId: {
      type: String,
      default: null,
      trim: true,
    },
    videoTitle: {
      type: String,
      default: null,
      trim: true,
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
    score: {
      type: Number,
      default: null,
    },
  },
  {
    _id: false,
  },
);

const questionSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    question: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: QUESTION_STATUS_VALUES,
      default: QUESTION_STATUSES.ANSWERED,
      index: true,
    },
    source: {
      type: String,
      enum: QUESTION_SOURCE_VALUES,
      default: QUESTION_SOURCES.API,
      index: true,
    },
    matchCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    topSegmentId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    matches: {
      type: [questionMatchSchema],
      default: [],
    },
    runtime: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sourceUsageLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UsageLog',
      default: null,
      index: true,
      unique: true,
      sparse: true,
    },
    askedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'questions',
  },
);

questionSchema.index({ courseId: 1, askedAt: -1 });
questionSchema.index({ studentId: 1, askedAt: -1 });
questionSchema.index({ courseId: 1, status: 1, askedAt: -1 });
questionSchema.index({ courseId: 1, topSegmentId: 1 });
questionSchema.index({ question: 'text', answer: 'text' });

module.exports = mongoose.model('Question', questionSchema);
