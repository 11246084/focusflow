const Course = require('../models/course.model');
const Video = require('../models/video.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { VIDEO_SOURCE_TYPES, VIDEO_PROCESSING_STATUSES } = require('../constants/enums');
const { queueVideoForProcessing } = require('./videoProcessing.service');

async function ensureCourseExists(courseId) {
  assertObjectId(courseId, 'course');

  const course = await Course.findById(courseId);

  if (!course) {
    throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  }

  return course;
}

async function createCourseVideo({ courseId, title, file, uploadedBy }) {
  if (!file) {
    throw new AppError('Video file is required.', 400, 'VIDEO_FILE_REQUIRED');
  }

  await ensureCourseExists(courseId);

  const video = await Video.create({
    courseId,
    title: String(title || '').trim() || file.originalname,
    sourceType: VIDEO_SOURCE_TYPES.UPLOAD,
    sourceUrl: `/uploads/${file.filename}`,
    storagePath: file.path,
    durationSec: null,
    uploadedBy,
    processing: {
      status: VIDEO_PROCESSING_STATUSES.UPLOADED,
      errorMessage: null,
    },
  });

  return queueVideoForProcessing(video._id);
}

async function listCourseVideos(courseId) {
  await ensureCourseExists(courseId);

  return Video.find({ courseId })
    .populate('uploadedBy', 'name email role')
    .sort({ createdAt: -1 });
}

async function getVideoById(videoId) {
  assertObjectId(videoId, 'video');

  const video = await Video.findById(videoId)
    .populate('courseId', 'title status teacherId')
    .populate('uploadedBy', 'name email role');

  if (!video) {
    throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
  }

  return video;
}

async function getVideoProcessingStatus(videoId) {
  const video = await getVideoById(videoId);

  return {
    id: String(video._id),
    title: video.title,
    processing: video.processing,
    updatedAt: video.updatedAt,
  };
}

module.exports = {
  createCourseVideo,
  listCourseVideos,
  getVideoById,
  getVideoProcessingStatus,
};
