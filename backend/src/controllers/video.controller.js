const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const videoService = require('../services/video.service');

const createVideo = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('Video file is required.', 400, 'VIDEO_FILE_REQUIRED');
  }

  const video = await videoService.createCourseVideo({
    courseId: req.params.courseId,
    title: req.body.title,
    file: req.file,
    uploadedBy: req.user.id,
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
  const videos = await videoService.listCourseVideos(req.params.courseId);

  return sendSuccess(res, {
    message: 'Videos fetched successfully.',
    data: {
      videos,
    },
  });
});

const getVideoById = asyncHandler(async (req, res) => {
  const video = await videoService.getVideoById(req.params.videoId);

  return sendSuccess(res, {
    message: 'Video fetched successfully.',
    data: {
      video,
    },
  });
});

const getVideoProcessing = asyncHandler(async (req, res) => {
  const processing = await videoService.getVideoProcessingStatus(req.params.videoId);

  return sendSuccess(res, {
    message: 'Video processing status fetched successfully.',
    data: processing,
  });
});

module.exports = {
  createVideo,
  listCourseVideos,
  getVideoById,
  getVideoProcessing,
};
