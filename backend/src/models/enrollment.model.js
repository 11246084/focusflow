const mongoose = require('mongoose');
const {
  ENROLLMENT_STATUSES,
  ENROLLMENT_STATUS_VALUES,
} = require('../constants/enums');

const enrollmentSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    enrolledAt: {
      type: Date,
      default: Date.now,
    },
    // Keep one durable relationship per student/course. Revoked rows can be
    // reactivated without losing progress or enrollment audit metadata.
    status: {
      type: String,
      enum: ENROLLMENT_STATUS_VALUES,
      default: ENROLLMENT_STATUSES.ACTIVE,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    watchedVideoIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
    lineNotify: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// This index also makes assignStudent's upsert idempotent under retries.
enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', enrollmentSchema);
