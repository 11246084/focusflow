const mongoose = require('mongoose');
const { NOTIFICATION_SOURCE_VALUES } = require('../constants/enums');

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    source: {
      type: String,
      enum: NOTIFICATION_SOURCE_VALUES,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    urgent: {
      type: Boolean,
      default: false,
      required: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    courseIds: {
      type: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
      }],
      default: [],
      required: true,
    },
    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      default: null,
    },
    // System broadcasts intentionally omit dedupeKey. Normalize null to absence
    // so only actual string keys participate in the partial unique index.
    dedupeKey: {
      type: String,
      trim: true,
      default: undefined,
      set: (value) => (value == null ? undefined : value),
    },
  },
  {
    timestamps: true,
  },
);

notificationSchema.index({ recipientId: 1, createdAt: -1, _id: -1 });
notificationSchema.index({
  recipientId: 1,
  readAt: 1,
  createdAt: -1,
  _id: -1,
});
notificationSchema.index(
  { recipientId: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      dedupeKey: { $type: 'string' },
    },
  },
);

module.exports = mongoose.model('Notification', notificationSchema);
