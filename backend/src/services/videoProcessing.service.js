const Video = require('../models/video.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { VIDEO_PROCESSING_STATUSES } = require('../constants/enums');
const { assertCanManageCourse, getCourseByIdOrThrow } = require('./courseAccess.service');
const { clearFaqsForVideoCourses } = require('./faqCache.service');
const { fanoutVideoCompletedNotifications } = require('./notification.service');
const { cleanupUploadedLocalVideo } = require('./youtubeUpload.service');

function createQueuedProcessingState(now = new Date()) {
  return {
    status: VIDEO_PROCESSING_STATUSES.QUEUED,
    errorMessage: null,
    errorCode: null,
    queuedAt: now,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    attemptCount: 0,
  };
}

// Keep the detail payload shape consistent between public status reads and write endpoints.
function buildProcessingMetadata(video) {
  return {
    id: String(video._id),
    title: video.title,
    processing: video.processing,
    updatedAt: video.updatedAt,
  };
}

function createTransitionError(currentStatus, targetStatus) {
  return new AppError(
    `Cannot transition video processing from ${currentStatus} to ${targetStatus}.`,
    409,
    'VIDEO_PROCESSING_TRANSITION_INVALID',
  );
}

function normalizeDurationSec(durationSec) {
  if (durationSec === undefined || durationSec === null || durationSec === '') {
    return undefined;
  }

  const normalized = Number(durationSec);

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new AppError('durationSec must be a non-negative number.', 400, 'VALIDATION_ERROR');
  }

  return normalized;
}

async function getVideoByIdOrThrow(videoId) {
  assertObjectId(videoId, 'video');

  const video = await Video.findById(videoId).populate('courseId', 'title status teacherId');

  if (!video) {
    throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
  }

  return video;
}

async function updateVideoProcessing(videoId, update) {
  const video = await Video.findByIdAndUpdate(
    videoId,
    update,
    { new: true },
  );

  if (!video) {
    throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
  }

  return video;
}

async function runCompletionSideEffects(video) {
  // Attempt both repairs even if one fails, then surface every failure so the webhook can be retried safely.
  const results = await Promise.allSettled([
    clearFaqsForVideoCourses(video, { throwOnError: true }),
    fanoutVideoCompletedNotifications(video),
  ]);
  const errors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Video completion side effects failed.');
  }

  // Cleanup is opt-in and best-effort. It has its own safety gates and must not
  // turn a successful processing webhook into a failure.
  await cleanupUploadedLocalVideo(video._id).catch(() => null);
}

async function queueVideoForProcessing(videoId) {
  const video = await getVideoByIdOrThrow(videoId);
  const currentStatus = video.processing?.status;

  if (currentStatus !== VIDEO_PROCESSING_STATUSES.FAILED) {
    throw createTransitionError(currentStatus, VIDEO_PROCESSING_STATUSES.QUEUED);
  }

  // Retrying a failed job clears failure details but preserves how many attempts already ran.
  return updateVideoProcessing(videoId, {
    $set: {
      'processing.status': VIDEO_PROCESSING_STATUSES.QUEUED,
      'processing.errorMessage': null,
      'processing.errorCode': null,
      'processing.queuedAt': new Date(),
      'processing.startedAt': null,
      'processing.completedAt': null,
      'processing.failedAt': null,
    },
  });
}

async function startVideoProcessing(videoId) {
  const video = await getVideoByIdOrThrow(videoId);
  const currentStatus = video.processing?.status;

  // Workers and manifest reconciliation may replay the same notification.
  // A replay must not increment attemptCount or replace the original startedAt.
  if (currentStatus === VIDEO_PROCESSING_STATUSES.PROCESSING) {
    return video;
  }

  if (currentStatus !== VIDEO_PROCESSING_STATUSES.QUEUED) {
    throw createTransitionError(currentStatus, VIDEO_PROCESSING_STATUSES.PROCESSING);
  }

  return updateVideoProcessing(videoId, {
    $set: {
      'processing.status': VIDEO_PROCESSING_STATUSES.PROCESSING,
      'processing.startedAt': new Date(),
    },
    $inc: {
      // Count each worker run when it actually starts processing.
      'processing.attemptCount': 1,
    },
  });
}

async function completeVideoProcessing(videoId, { durationSec, externalVideoId } = {}) {
  const video = await getVideoByIdOrThrow(videoId);
  const currentStatus = video.processing?.status;

  // The completion webhook is idempotent so a worker can retry after a
  // notification fanout failure. Dedupe indexes make partial fanout repair safe.
  if (currentStatus === VIDEO_PROCESSING_STATUSES.COMPLETED) {
    await runCompletionSideEffects(video);
    return video;
  }

  if (currentStatus !== VIDEO_PROCESSING_STATUSES.PROCESSING) {
    throw createTransitionError(currentStatus, VIDEO_PROCESSING_STATUSES.COMPLETED);
  }

  const normalizedDurationSec = normalizeDurationSec(durationSec);
  const $set = {
    'processing.status': VIDEO_PROCESSING_STATUSES.COMPLETED,
    'processing.errorMessage': null,
    'processing.errorCode': null,
    'processing.completedAt': new Date(),
    'processing.failedAt': null,
  };

  if (normalizedDurationSec !== undefined) {
    $set.durationSec = normalizedDurationSec;
  }

  if (externalVideoId && String(externalVideoId).trim()) {
    const cleanExternalId = String(externalVideoId).trim();
    // A pipeline external ID may identify only one video; clear stale ownership before assigning it.
    await Video.updateMany(
      { videoId: cleanExternalId, _id: { $ne: video._id } },
      { $unset: { videoId: '' } },
    );
    $set.videoId = cleanExternalId;
  }

  const updated = await updateVideoProcessing(videoId, { $set });

  // 影片重新處理完成代表片段內容更新，相關課程的 FAQ 快取答案可能過期，清掉重建。
  await runCompletionSideEffects(updated);

  return updated;
}

async function failVideoProcessing(videoId, { errorMessage, errorCode } = {}) {
  const trimmedErrorMessage = String(errorMessage || '').trim();

  if (!trimmedErrorMessage) {
    throw new AppError('errorMessage is required.', 400, 'VALIDATION_ERROR');
  }

  const video = await getVideoByIdOrThrow(videoId);
  const currentStatus = video.processing?.status;

  // Preserve the first terminal failure. Duplicate worker/reconciliation calls
  // acknowledge the same state without rewriting its reason or timestamp.
  if (currentStatus === VIDEO_PROCESSING_STATUSES.FAILED) {
    return video;
  }

  if (![VIDEO_PROCESSING_STATUSES.QUEUED, VIDEO_PROCESSING_STATUSES.PROCESSING].includes(currentStatus)) {
    throw createTransitionError(currentStatus, VIDEO_PROCESSING_STATUSES.FAILED);
  }

  return updateVideoProcessing(videoId, {
    $set: {
      'processing.status': VIDEO_PROCESSING_STATUSES.FAILED,
      'processing.errorMessage': trimmedErrorMessage,
      'processing.errorCode': errorCode ? String(errorCode).trim() : null,
      'processing.failedAt': new Date(),
      'processing.completedAt': null,
    },
  });
}

async function retryVideoProcessing(videoId, user) {
  const video = await getVideoByIdOrThrow(videoId);
  const course = await getCourseByIdOrThrow(video.courseId?._id || video.courseId);

  // Manual retry stays behind the same owner/admin guard as other video management actions.
  await assertCanManageCourse(user, course);

  return queueVideoForProcessing(videoId);
}

module.exports = {
  buildProcessingMetadata,
  createQueuedProcessingState,
  queueVideoForProcessing,
  startVideoProcessing,
  completeVideoProcessing,
  failVideoProcessing,
  retryVideoProcessing,
};
