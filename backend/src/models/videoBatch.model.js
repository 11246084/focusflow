const mongoose = require('mongoose');
const {
  VIDEO_BATCH_STATUS_VALUES,
  VIDEO_BATCH_STATUSES,
  VIDEO_BATCH_UPLOAD_STATUS_VALUES,
} = require('../constants/enums');

const videoBatchItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', default: null },
    uploadStatus: { type: String, enum: VIDEO_BATCH_UPLOAD_STATUS_VALUES, required: true },
    errorCode: { type: String, default: null, trim: true },
    errorMessage: { type: String, default: null, trim: true },
  },
  { _id: false },
);

// Store both the default adapter and guarded Pipeline mode in one presentation
// model so the frontend can resume tracking without knowing the executor.
const videoBatchSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true, trim: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: VIDEO_BATCH_STATUS_VALUES,
      default: VIDEO_BATCH_STATUSES.CREATING,
    },
    processingMode: {
      type: String,
      enum: ['single_adapter', 'pipeline_batch'],
      default: 'single_adapter',
    },
    items: { type: [videoBatchItemSchema], default: [] },
  },
  { timestamps: true },
);

videoBatchSchema.index({ courseId: 1, createdAt: -1 });
videoBatchSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('VideoBatch', videoBatchSchema);
