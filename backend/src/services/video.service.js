const Video = require('../models/video.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { VIDEO_SOURCE_TYPES, VIDEO_PROCESSING_STATUSES } = require('../constants/enums');
const { queueVideoForProcessing } = require('./videoProcessing.service');
const { assertCanAccessCourse, assertCanManageCourse, getCourseByIdOrThrow } = require('./courseAccess.service');

async function ensureCourseExists(courseId) {
  return getCourseByIdOrThrow(courseId);
}

async function createCourseVideo({ courseId, title, file, uploadedBy, user }) {
  if (!file) {
    throw new AppError('Video file is required.', 400, 'VIDEO_FILE_REQUIRED');
  }

  const course = await ensureCourseExists(courseId);
  await assertCanManageCourse(user, course);

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

async function listCourseVideos(courseId, user) {
  const course = await ensureCourseExists(courseId);
  await assertCanAccessCourse(user, course);

  return Video.find({ courseId })
    .populate('uploadedBy', 'name email role')
    .sort({ createdAt: -1 });
}

async function getVideoById(videoId, user) {
  assertObjectId(videoId, 'video');

  const video = await Video.findById(videoId)
    .populate('courseId', 'title status teacherId')
    .populate('uploadedBy', 'name email role');

  if (!video) {
    throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
  }

  const course = await ensureCourseExists(video.courseId?._id || video.courseId);
  await assertCanAccessCourse(user, course);

  return video;
}

async function getVideoProcessingStatus(videoId, user) {
  const video = await getVideoById(videoId, user);
  const course = await ensureCourseExists(video.courseId?._id || video.courseId);
  await assertCanManageCourse(user, course);

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
