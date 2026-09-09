const mongoose = require('mongoose');
const {
  COURSE_STATUS_VALUES,
  SHORT_ASSET_REVIEW_REASON_CODE_VALUES,
  SHORT_ASSET_REVIEW_STATUSES,
  SHORT_ASSET_REVIEW_STATUS_VALUES,
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

const reviewReasonSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      enum: SHORT_ASSET_REVIEW_REASON_CODE_VALUES,
      required: true,
    },
    note: { type: String, default: '', trim: true, maxlength: 500 },
  },
  { _id: false },
);

const reviewHistorySchema = new mongoose.Schema(
  {
    generationVersion: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: SHORT_ASSET_REVIEW_STATUS_VALUES.filter(
        (status) => status !== SHORT_ASSET_REVIEW_STATUSES.PENDING,
      ),
      required: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reviewedAt: { type: Date, required: true },
    reasons: { type: [reviewReasonSchema], default: [] },
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
    // 這支影片是照哪一份腳本、哪一版拍的（規格書 DR-20）。
    // 沒有這兩個欄位，成品被退回時系統不知道要讓哪份腳本重生，
    // 「影片 → 腳本 → 證據 → 逐字稿」的可追溯鏈也在第一步就斷掉。
    // 版本號不能省：腳本會有多版，教師照第 2 版拍完之後腳本可能已生成第 3 版，
    // 只記 scriptId 會把回饋套到教師沒看過的版本上。
    sourceScriptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ShortScript',
      default: null,
      index: true,
    },
    sourceVersionNo: { type: Number, default: null, min: 1 },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: SHORT_ASSET_STATUS_VALUES,
      default: SHORT_ASSET_STATUSES.DRAFT,
    },
    reviewStatus: {
      type: String,
      enum: SHORT_ASSET_REVIEW_STATUS_VALUES,
      default: SHORT_ASSET_REVIEW_STATUSES.PENDING,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    reviewReasons: { type: [reviewReasonSchema], default: [] },
    generationVersion: { type: Number, default: 1, min: 1 },
    reviewedGenerationVersion: { type: Number, default: null, min: 1 },
    // Keep prior decisions when regeneration resets the current review snapshot.
    reviewHistory: { type: [reviewHistorySchema], default: [] },
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
