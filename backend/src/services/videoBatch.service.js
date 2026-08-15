const crypto = require('crypto');
const { existsSync, unlinkSync } = require('fs');
const VideoBatch = require('../models/videoBatch.model');
const Video = require('../models/video.model');
const AppError = require('../utils/appError');
const {
  VIDEO_BATCH_STATUSES,
  VIDEO_BATCH_UPLOAD_STATUSES,
  VIDEO_PROCESSING_STATUSES,
} = require('../constants/enums');
const { assertCanManageCourse, getCourseByIdOrThrow } = require('./courseAccess.service');
const videoService = require('./video.service');
const videoProcessingService = require('./videoProcessing.service');
const videoBatchProcessingService = require('./videoBatchProcessing.service');
const env = require('../config/env');

const MAX_BATCH_FILES = 10;

// A batch is the durable API aggregate. Individual videos still use the normal
// Video lifecycle so existing status, notification, and retry rules are reused.

function createBatchId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `batch_${stamp}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

function validateBatchId(batchId) {
  const value = String(batchId || '').trim();
  if (!/^batch_[0-9]{14}_[a-f0-9]{8}$/i.test(value)) {
    throw new AppError('Invalid video batch id.', 400, 'INVALID_VIDEO_BATCH_ID');
  }
  return value;
}

function cleanFailedUpload(file) {
  try {
    if (file?.path && existsSync(file.path)) unlinkSync(file.path);
  } catch {
    // The item remains failed and exposes a safe error; cleanup is best-effort.
  }
}

function cleanFailedUploads(files) {
  (files || []).forEach(cleanFailedUpload);
}

function publicError(error) {
  if (!(error instanceof AppError)) {
    return {
      errorCode: 'VIDEO_BATCH_ITEM_FAILED',
      errorMessage: 'Video upload failed.',
    };
  }
  return {
    errorCode: String(error?.code || 'VIDEO_BATCH_ITEM_FAILED').slice(0, 100),
    errorMessage: String(error?.message || 'Video upload failed.').slice(0, 300),
  };
}

async function assertBatchAccess(batch, user) {
  const course = await getCourseByIdOrThrow(batch.courseId?._id || batch.courseId);
  await assertCanManageCourse(user, course);
  return course;
}

function deriveBatchStatus(items) {
  const completed = items.filter((item) => item.processingStatus === VIDEO_PROCESSING_STATUSES.COMPLETED).length;
  const failed = items.filter((item) => item.status === VIDEO_BATCH_STATUSES.FAILED).length;
  const terminal = completed + failed;
  if (terminal < items.length) return VIDEO_BATCH_STATUSES.PROCESSING;
  if (completed && failed) return VIDEO_BATCH_STATUSES.PARTIAL;
  if (completed) return VIDEO_BATCH_STATUSES.COMPLETED;
  return VIDEO_BATCH_STATUSES.FAILED;
}

async function buildBatchPresentation(batch) {
  const raw = typeof batch?.toObject === 'function' ? batch.toObject() : { ...batch };
  const videoIds = (raw.items || []).map((item) => item.videoId).filter(Boolean);
  const videos = videoIds.length ? await Video.find({ _id: { $in: videoIds } }).lean() : [];
  const byId = new Map(videos.map((video) => [String(video._id), video]));
  const items = (raw.items || []).map((item) => {
    const video = item.videoId ? byId.get(String(item.videoId)) : null;
    const processingStatus = video?.processing?.status || null;
    const failed = item.uploadStatus === VIDEO_BATCH_UPLOAD_STATUSES.FAILED
      || !video
      || processingStatus === VIDEO_PROCESSING_STATUSES.FAILED;
    return {
      itemId: item.itemId,
      originalName: item.originalName,
      title: item.title,
      videoId: video ? String(video._id) : null,
      uploadStatus: item.uploadStatus,
      processingStatus,
      status: failed ? VIDEO_BATCH_STATUSES.FAILED
        : processingStatus === VIDEO_PROCESSING_STATUSES.COMPLETED
          ? VIDEO_BATCH_STATUSES.COMPLETED
          : VIDEO_BATCH_STATUSES.PROCESSING,
      errorCode: item.errorCode || video?.processing?.errorCode || null,
      errorMessage: item.errorMessage || video?.processing?.errorMessage || null,
      attemptCount: Number(video?.processing?.attemptCount || 0),
    };
  });
  const status = deriveBatchStatus(items);
  const counts = {
    total: items.length,
    completed: items.filter((item) => item.status === VIDEO_BATCH_STATUSES.COMPLETED).length,
    failed: items.filter((item) => item.status === VIDEO_BATCH_STATUSES.FAILED).length,
    processing: items.filter((item) => item.status === VIDEO_BATCH_STATUSES.PROCESSING).length,
  };
  return {
    batchId: raw.batchId,
    courseId: String(raw.courseId?._id || raw.courseId),
    createdBy: String(raw.createdBy?._id || raw.createdBy),
    status,
    processingMode: raw.processingMode || 'single_adapter',
    counts,
    progressPercent: counts.total ? Math.round(((counts.completed + counts.failed) / counts.total) * 100) : 100,
    items,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

async function syncBatchStatus(batch) {
  const presentation = await buildBatchPresentation(batch);
  if (batch.status !== presentation.status) {
    await VideoBatch.findOneAndUpdate(
      { batchId: batch.batchId },
      { $set: { status: presentation.status } },
    );
  }
  return presentation;
}

async function createVideoBatch({ courseId, files, titles = [], user }) {
  if (!Array.isArray(files) || files.length < 1) {
    throw new AppError('At least one video file is required.', 400, 'VIDEO_BATCH_FILES_REQUIRED');
  }
  if (files.length > MAX_BATCH_FILES) {
    throw new AppError(`A video batch can contain at most ${MAX_BATCH_FILES} files.`, 400, 'VIDEO_BATCH_LIMIT_EXCEEDED');
  }
  let batch;
  let batchId;
  const processingMode = env.videoBatchPipelineEnabled ? 'pipeline_batch' : 'single_adapter';
  try {
    const course = await getCourseByIdOrThrow(courseId);
    await assertCanManageCourse(user, course);
    batchId = createBatchId();
    batch = await VideoBatch.create({
      batchId,
      courseId,
      createdBy: user.id,
      status: VIDEO_BATCH_STATUSES.CREATING,
      processingMode,
      items: [],
    });
  } catch (error) {
    cleanFailedUploads(files);
    throw error;
  }
  const items = [];
  // Persist after every item so a partial upload remains visible and successful
  // items are never rolled back because another file failed validation.
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const originalName = String(file.originalname || file.filename || `video-${index + 1}`);
    const title = String(titles[index] || '').trim() || originalName.replace(/\.[^.]+$/, '');
    try {
      const video = await videoService.createCourseVideo({
        courseId,
        title,
        file,
        uploadedBy: user.id,
        user,
        deferProcessingStart: env.videoBatchPipelineEnabled,
      });
      items.push({
        itemId: `item_${String(index + 1).padStart(4, '0')}`,
        originalName,
        title,
        videoId: video._id || video.id,
        uploadStatus: VIDEO_BATCH_UPLOAD_STATUSES.UPLOADED,
        errorCode: null,
        errorMessage: null,
      });
    } catch (error) {
      cleanFailedUpload(file);
      items.push({
        itemId: `item_${String(index + 1).padStart(4, '0')}`,
        originalName,
        title,
        videoId: null,
        uploadStatus: VIDEO_BATCH_UPLOAD_STATUSES.FAILED,
        ...publicError(error),
      });
    }
    batch = await VideoBatch.findOneAndUpdate(
      { batchId },
      { $set: { items, status: VIDEO_BATCH_STATUSES.PROCESSING } },
      { new: true },
    );
  }
  // The guarded Pipeline handoff is opt-in; otherwise each video retains the
  // existing local single-video processing path.
  if (env.videoBatchPipelineEnabled) {
    const schedulableItems = items
      .map((item, index) => ({
        itemId: item.itemId,
        videoId: item.videoId,
        videoPath: files[index]?.path,
        uploadStatus: item.uploadStatus,
      }))
      .filter((item) => item.uploadStatus === VIDEO_BATCH_UPLOAD_STATUSES.UPLOADED && item.videoId);
    if (schedulableItems.length) {
      try {
        videoBatchProcessingService.scheduleVideoBatchProcessing({ batchId, items: schedulableItems });
      } catch {
        for (const item of schedulableItems) {
          await videoProcessingService.failVideoProcessing(item.videoId, {
            errorCode: 'VIDEO_BATCH_SCHEDULE_FAILED',
            errorMessage: 'Video batch could not be scheduled.',
          });
        }
      }
    }
  }
  return syncBatchStatus(batch);
}

async function getVideoBatch(batchId, user) {
  const normalized = validateBatchId(batchId);
  const batch = await VideoBatch.findOne({ batchId: normalized });
  if (!batch) throw new AppError('Video batch not found.', 404, 'VIDEO_BATCH_NOT_FOUND');
  await assertBatchAccess(batch, user);
  return syncBatchStatus(batch);
}

async function listCourseVideoBatches(courseId, user) {
  const course = await getCourseByIdOrThrow(courseId);
  await assertCanManageCourse(user, course);
  const batches = await VideoBatch.find({ courseId }).sort({ createdAt: -1 }).limit(20).lean();
  return Promise.all(batches.map((batch) => syncBatchStatus(batch)));
}

async function retryVideoBatchItem(batchId, videoId, user) {
  const normalized = validateBatchId(batchId);
  const batch = await VideoBatch.findOne({ batchId: normalized });
  if (!batch) throw new AppError('Video batch not found.', 404, 'VIDEO_BATCH_NOT_FOUND');
  await assertBatchAccess(batch, user);
  const item = batch.items.find((candidate) => String(candidate.videoId || '') === String(videoId));
  if (!item) throw new AppError('Video is not part of this batch.', 404, 'VIDEO_BATCH_ITEM_NOT_FOUND');
  if (
    batch.processingMode === 'pipeline_batch'
    && videoBatchProcessingService.isVideoBatchProcessRunning(normalized)
  ) {
    throw new AppError(
      'The video batch is still running. Retry after the current batch process finishes.',
      409,
      'VIDEO_BATCH_RETRY_IN_PROGRESS',
    );
  }
  await videoProcessingService.retryVideoProcessing(videoId, user);
  try {
    if (batch.processingMode === 'pipeline_batch') {
      videoBatchProcessingService.scheduleVideoBatchResume({
        batchId: normalized,
        videoIds: [String(videoId)],
        retryVideoIds: [String(videoId)],
      });
    } else {
      await videoService.scheduleExistingVideoProcessing(videoId);
    }
  } catch (error) {
    await videoProcessingService.failVideoProcessing(videoId, {
      errorCode: 'VIDEO_BATCH_SCHEDULE_FAILED',
      errorMessage: 'Video retry could not be scheduled.',
    });
    throw error;
  }
  return getVideoBatch(normalized, user);
}

module.exports = {
  MAX_BATCH_FILES,
  buildBatchPresentation,
  createBatchId,
  createVideoBatch,
  getVideoBatch,
  listCourseVideoBatches,
  retryVideoBatchItem,
  syncBatchStatus,
  validateBatchId,
};
