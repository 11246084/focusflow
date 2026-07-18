const mongoose = require('mongoose');
const {
  COURSE_STATUS_VALUES,
  SHORT_ASSET_STATUSES,
  SHORT_ASSET_STATUS_VALUES,
  YOUTUBE_AVAILABILITIES,
  YOUTUBE_AVAILABILITY_VALUES,
  YOUTUBE_PRIVACY_STATUSES,
  YOUTUBE_PRIVACY_STATUS_VALUES,
} = require('../constants/enums');

const courseSnapshotSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, trim: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: String, enum: COURSE_STATUS_VALUES, required: true },
  },
  { _id: false },
);

const shortAssetSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    sourceVideoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      default: null,
    },
    jobId: { type: String, default: null, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: SHORT_ASSET_STATUS_VALUES,
      default: SHORT_ASSET_STATUSES.DRAFT,
    },
    // Keep absent IDs truly missing so the sparse unique index does not index null.
    youtubeVideoId: { type: String, trim: true },
    youtubeUrl: { type: String, default: null, trim: true },
    thumbnail: { type: String, default: null, trim: true },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    archiveReason: { type: String, default: null, trim: true },
    statusBeforeArchive: {
      type: String,
      enum: [...SHORT_ASSET_STATUS_VALUES, null],
      default: null,
    },
    courseSnapshot: { type: courseSnapshotSchema, default: null },
    youtubeAvailability: {
      type: String,
      enum: YOUTUBE_AVAILABILITY_VALUES,
      default: YOUTUBE_AVAILABILITIES.PENDING,
    },
    youtubePrivacyStatus: {
      type: String,
      enum: YOUTUBE_PRIVACY_STATUS_VALUES,
      default: YOUTUBE_PRIVACY_STATUSES.UNKNOWN,
    },
    lastCheckedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

shortAssetSchema.index({
  courseId: 1,
  status: 1,
  youtubeAvailability: 1,
  publishedAt: -1,
  _id: -1,
});
shortAssetSchema.index({ youtubeVideoId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('ShortAsset', shortAssetSchema);
