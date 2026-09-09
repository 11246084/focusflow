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
  YOUTUBE_UPLOAD_STATUS_VALUES,
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

// AI 揭露標示與教師數位分身書面同意（規格書 R-07 / 附錄 K.5）。
// 系統不檢查也不代為取得這兩項，但上架前必須要求教師明示確認並記錄時間——
// 上傳 YouTube 是不可逆的對外動作，事後無法補證明當時教師確認過。
const disclosureSchema = new mongoose.Schema(
  {
    aiDisclosureConfirmed: { type: Boolean, default: false },
    consentConfirmed: { type: Boolean, default: false },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },
  },
  { _id: false },
);

// 上架到 YouTube 的稽核紀錄（規格書附錄 K.1）。
// 比照 Video 的 youtubeUpload 區塊：上架失敗時 ShortAsset 必須維持 draft 並留下原因，
// 否則教師只看得到「沒上架」而不知道為什麼，也判斷不出能不能重試。
const shortAssetUploadSchema = new mongoose.Schema(
  {
    status: { type: String, enum: [...YOUTUBE_UPLOAD_STATUS_VALUES, null], default: null },
    error: { type: String, default: null, trim: true },
    attemptCount: { type: Number, default: 0, min: 0 },
    lastAttemptAt: { type: Date, default: null },
    uploadedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    // 是否確定沒有送出任何影片 bytes。送出過就不能自動重試，否則會在 YouTube 上留下重複影片。
    retrySafe: { type: Boolean, default: false },
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
    // 教師上傳的本機影片檔。上架是在成品審核通過之後才發生的，
    // 那時 multipart 請求早已結束，所以必須把路徑存下來。
    filePath: { type: String, default: null, trim: true },
    disclosure: { type: disclosureSchema, default: () => ({}) },
    youtubeUpload: { type: shortAssetUploadSchema, default: () => ({}) },
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
