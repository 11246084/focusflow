const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const videoService = require('../services/video.service');
const videoProcessingService = require('../services/videoProcessing.service');
const youtubeUploadService = require('../services/youtubeUpload.service');

// Retry authorization and replay-safety checks stay in the service; this
// controller only exposes the accepted request as an asynchronous 202 action.

const createYouTubeVideo = asyncHandler(async (req, res) => {
  const { youtubeUrl, title, week, lesson } = req.body;
  if (!youtubeUrl) {
    throw new AppError('youtubeUrl is required.', 400, 'VALIDATION_ERROR');
  }
  const video = await videoService.createCourseVideoFromYouTube({
    courseId: req.params.courseId,
    youtubeUrl,
    title,
    week: week != null ? Number(week) : undefined,
    lesson: lesson != null ? Number(lesson) : undefined,
    uploadedBy: req.user.id,
    user: req.user,
  });
  return sendSuccess(res, {
    statusCode: 201,
    message: 'YouTube video registered successfully.',
    data: { video },
  });
});

const createVideo = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('Video file is required.', 400, 'VIDEO_FILE_REQUIRED');
  }

  const video = await videoService.createCourseVideo({
    courseId: req.params.courseId,
    title: req.body.title,
    file: req.file,
    uploadedBy: req.user.id,
    user: req.user,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Video uploaded successfully.',
    data: {
      video,
    },
  });
});

const listCourseVideos = asyncHandler(async (req, res) => {
  const result = await videoService.listCourseVideos(req.params.courseId, req.user);

  return sendSuccess(res, {
    message: 'Videos fetched successfully.',
    data: {
      videos: result.videos,
    },
    meta: {
      isBridgeCourse: result.presentation.isBridgeCourse,
      qaScopeOnly: result.presentation.qaScopeOnly,
      bridgeMode: result.presentation.bridgeMode,
      videoCount: result.presentation.videoCount,
      appVideoCount: result.presentation.appVideoCount,
      bridgeVideoCount: result.presentation.bridgeVideoCount,
      appOwnedVideoCount: result.presentation.appOwnedVideoCount,
      metadataOnlyVideoCount: result.presentation.metadataOnlyVideoCount,
      bridgeContract: result.presentation.bridgeContract,
      bridgeContractPath: result.presentation.bridgeContractPath,
    },
  });
});

const getVideoById = asyncHandler(async (req, res) => {
  const video = await videoService.getVideoById(req.params.videoId, req.user);

  return sendSuccess(res, {
    message: 'Video fetched successfully.',
    data: {
      video,
    },
  });
});

const getVideoProcessing = asyncHandler(async (req, res) => {
  const processing = await videoService.getVideoProcessingStatus(req.params.videoId, req.user);

  return sendSuccess(res, {
    message: 'Video processing status fetched successfully.',
    data: processing,
  });
});

const retryVideoProcessing = asyncHandler(async (req, res) => {
  const video = await videoProcessingService.retryVideoProcessing(req.params.videoId, req.user);

  return sendSuccess(res, {
    message: 'Video processing retried successfully.',
    data: videoProcessingService.buildProcessingMetadata(video),
  });
});

const retryYouTubeUpload = asyncHandler(async (req, res) => {
  const result = await youtubeUploadService.scheduleYouTubeUploadRetry(
    req.params.videoId,
    req.user,
  );
  return sendSuccess(res, {
    statusCode: 202,
    message: 'YouTube upload retry scheduled.',
    data: result,
  });
});

const startInternalVideoProcessing = asyncHandler(async (req, res) => {
  const video = await videoProcessingService.startVideoProcessing(req.params.videoId);

  return sendSuccess(res, {
    message: 'Video processing started successfully.',
    data: videoProcessingService.buildProcessingMetadata(video),
  });
});

const completeInternalVideoProcessing = asyncHandler(async (req, res) => {
  const video = await videoProcessingService.completeVideoProcessing(req.params.videoId, {
    durationSec: req.body.durationSec,
    externalVideoId: req.body.externalVideoId,
  });

  return sendSuccess(res, {
    message: 'Video processing completed successfully.',
    data: videoProcessingService.buildProcessingMetadata(video),
  });
});

const failInternalVideoProcessing = asyncHandler(async (req, res) => {
  const video = await videoProcessingService.failVideoProcessing(req.params.videoId, {
    errorMessage: req.body.errorMessage,
    errorCode: req.body.errorCode,
  });

  return sendSuccess(res, {
    message: 'Video processing failed successfully.',
    data: videoProcessingService.buildProcessingMetadata(video),
  });
});

const deleteVideo = asyncHandler(async (req, res) => {
  await videoService.deleteVideo(req.params.videoId, req.user);
  return sendSuccess(res, { message: 'Video deleted.' });
});

const attachVideo = asyncHandler(async (req, res) => {
  const video = await videoService.attachVideoToCourse({
    courseId: req.params.courseId,
    videoId: req.params.videoId,
    user: req.user,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Video attached to course.',
    data: { video },
  });
});

const detachVideo = asyncHandler(async (req, res) => {
  await videoService.detachVideoFromCourse({
    courseId: req.params.courseId,
    videoId: req.params.videoId,
    user: req.user,
  });

  return sendSuccess(res, { message: 'Video detached from course.' });
});

module.exports = {
  createYouTubeVideo,
  createVideo,
  listCourseVideos,
  getVideoById,
  getVideoProcessing,
  retryVideoProcessing,
  retryYouTubeUpload,
  deleteVideo,
  attachVideo,
  detachVideo,
  startInternalVideoProcessing,
  completeInternalVideoProcessing,
  failInternalVideoProcessing,
};
