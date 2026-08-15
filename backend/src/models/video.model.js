const mongoose = require('mongoose');
const {
  VIDEO_SOURCE_TYPE_VALUES,
  VIDEO_SOURCE_TYPES,
  VIDEO_PROCESSING_STATUS_VALUES,
  YOUTUBE_UPLOAD_STATUS_VALUES,
} = require('../constants/enums');

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function pickField(video, camelCaseName, snakeCaseName) {
  return video?.[camelCaseName] ?? video?.[snakeCaseName];
}

function isAppOwnedVideoRecord(video) {
  return Boolean(
    video
    && hasValue(video.courseId)
    && hasValue(video.uploadedBy)
    && hasValue(video.title)
    && hasValue(video.processing?.status),
  );
}

function isPipelineMetadataRecord(video) {
  return Boolean(hasValue(pickField(video, 'videoId', 'video_id')) && !isAppOwnedVideoRecord(video));
}

const processingSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: VIDEO_PROCESSING_STATUS_VALUES,
      required: true,
    },
    errorMessage: {
      type: String,
      default: null,
      trim: true,
    },
    errorCode: {
      type: String,
      default: null,
      trim: true,
    },
    queuedAt: {
      type: Date,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    _id: false,
  },
);

const videoSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    sourceType: {
      type: String,
      enum: VIDEO_SOURCE_TYPE_VALUES,
      default: VIDEO_SOURCE_TYPES.UPLOAD,
    },
    sourceUrl: {
      type: String,
      default: null,
      trim: true,
    },
    videoId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    fileName: {
      type: String,
      default: null,
      trim: true,
    },
    filePath: {
      type: String,
      default: null,
      trim: true,
    },
    audioPath: {
      type: String,
      default: null,
      trim: true,
    },
    durationSec: {
      type: Number,
      default: null,
      min: 0,
    },
    week: {
      type: Number,
      default: null,
      min: 0,
    },
    lesson: {
      type: Number,
      default: null,
      min: 0,
    },
    videoSource: {
      type: String,
      default: null,
      trim: true,
    },
    videoUrl: {
      type: String,
      default: null,
      trim: true,
    },
    youtubeVideoId: {
      type: String,
      default: null,
      trim: true,
    },
    fileHash: {
      type: String,
      default: null,
      trim: true,
    },
    // 本地上傳影片自動上傳 YouTube 的狀態；未啟用或 YouTube URL 影片為 null。
    youtubeUpload: {
      type: new mongoose.Schema(
        {
          status: {
            type: String,
            enum: YOUTUBE_UPLOAD_STATUS_VALUES,
            required: true,
          },
          error: {
            type: String,
            default: null,
            trim: true,
          },
          uploadedAt: {
            type: Date,
            default: null,
          },
          // Recovery metadata distinguishes failures that are safe to replay
          // from uncertain uploads that require a YouTube Studio review.
          attemptCount: {
            type: Number,
            default: 0,
            min: 0,
          },
          lastAttemptAt: {
            type: Date,
            default: null,
          },
          failedAt: {
            type: Date,
            default: null,
          },
          retrySafe: {
            type: Boolean,
            default: false,
          },
          nextRetryAt: {
            type: Date,
            default: null,
          },
          localCleanupAt: {
            type: Date,
            default: null,
          },
          localCleanupError: {
            type: String,
            default: null,
            trim: true,
          },
        },
        { _id: false },
      ),
      default: null,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // `videos` is temporarily shared with pipeline metadata docs. Backend app-layer
    // ownership is defined by course/upload/processing fields, not by `video_id` alone.
    // `completed` means the current processing pipeline finished and is ready
    // for later indexing / QA integration. We intentionally do not mix in `indexed`.
    processing: {
      type: processingSchema,
      required: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

videoSchema.index({ courseId: 1 });
videoSchema.index({ courseId: 1, fileHash: 1 });

videoSchema.statics.isAppOwnedRecord = isAppOwnedVideoRecord;
videoSchema.statics.isPipelineMetadataRecord = isPipelineMetadataRecord;

module.exports = mongoose.model('Video', videoSchema);
