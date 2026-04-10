const mongoose = require('mongoose');
const { COURSE_STATUS_VALUES, COURSE_STATUSES } = require('../constants/enums');

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    videoIds: {
      type: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Video',
      }],
      default: [],
    },
    status: {
      type: String,
      enum: COURSE_STATUS_VALUES,
      default: COURSE_STATUSES.DRAFT,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Course', courseSchema);
