const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const videoService = require('../services/video.service');
const videoProcessingService = require('../services/videoProcessing.service');
const youtubeUploadService = require('../services/youtubeUpload.service');
const playback = require('../services/localPlayback.service');
const uploadStorage = require('../services/uploadStorage.service');
const getUploadStatus = asyncHandler(async (req, res) => {
  const { paused, apiQuota, channelLimit, earliestRetryAt } = await require('../services/youtubeUploadGate.service').getUploadPauseSnapshot();
  return sendSuccess(res, { data: { pause: { paused, apiQuota, channelLimit, earliestRetryAt } } });
});
const { assertCanManageCourse } = require('../services/courseAccess.service');

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
    data: { video: playback.presentVideo(video) },
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
      video: playback.presentVideo(video),
    },
  });
});

const listCourseVideos = asyncHandler(async (req, res) => {
  const result = await videoService.listCourseVideos(req.params.courseId, req.user);

  return sendSuccess(res, {
    message: 'Videos fetched successfully.',
    data: {
      videos: result.videos.map(playback.presentVideo),
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
      video: playback.presentVideo(video),
    },
  });
});

const getUploadStorage = asyncHandler(async (req, res) => sendSuccess(res, { message: 'Upload storage fetched successfully.', data: await uploadStorage.status() }));

const getVideoSource = asyncHandler(async (req, res) => {
  const context = await videoService.resolveAccessibleVideoContext(req.params.videoId, req.user);
  if ((context.video.videoSource || context.video.video_source) === 'youtube' && req.user.role === 'teacher') {
    await assertCanManageCourse(req.user, context.course);
  }
  const file = playback.authorizeSource(context, req.user);
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', 'inline');
  if (playback.accelEnabled()) {
    res.set('X-Accel-Redirect', playback.accelPath(file));
    return res.status(200).end();
  }
  return res.sendFile(file);
});

const getVideoProcessing = asyncHandler(async (req, res) => {
  const processing = await videoService.getVideoProcessingStatus(req.params.videoId, req.user);

  return sendSuccess(res, {
    message: 'Video processing status fetched successfully.',
    data: processing,
  });
});

const retryVideoProcessing = asyncHandler(async (req, res) => {
  const video = await videoService.retryExistingVideoProcessing(req.params.videoId, req.user);

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

const restoreVideoSource = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('Video file is required.', 400, 'VIDEO_FILE_REQUIRED');
  }

  const video = await videoService.restoreVideoSource({
    videoId: req.params.videoId,
    file: req.file,
    user: req.user,
  });

  return sendSuccess(res, {
    message: 'Video source restored.',
    data: { video: playback.presentVideo(video) },
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
    data: { video: playback.presentVideo(video) },
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
  getUploadStatus,
  createYouTubeVideo,
  createVideo,
  listCourseVideos,
  getVideoById,
  getVideoSource,
  getUploadStorage,
  getVideoProcessing,
  retryVideoProcessing,
  retryYouTubeUpload,
  restoreVideoSource,
  deleteVideo,
  attachVideo,
  detachVideo,
  startInternalVideoProcessing,
  completeInternalVideoProcessing,
  failInternalVideoProcessing,
};
