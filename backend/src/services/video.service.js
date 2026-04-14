const Video = require('../models/video.model');
const Course = require('../models/course.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { VIDEO_SOURCE_TYPES } = require('../constants/enums');
const { buildProcessingMetadata, createQueuedProcessingState } = require('./videoProcessing.service');
const {
  assertCanAccessCourse,
  assertCanManageCourse,
  canAccessCourse,
  getCourseByIdOrThrow,
} = require('./courseAccess.service');
const {
  COURSE_BRIDGE_MODES,
  normalizeIdentifier,
  collectScopedVideos,
  buildCourseBridgeSummary,
  buildVideoBridgePresentation,
} = require('./bridgeScope.service');

async function ensureCourseExists(courseId) {
  return getCourseByIdOrThrow(courseId);
}

function buildStandardCourseSummary() {
  return {
    qaScopeOnly: false,
    bridgeMode: COURSE_BRIDGE_MODES.STANDARD,
  };
}

async function buildCourseVideoListing(course) {
  const scopedVideos = await collectScopedVideos(course);
  const presentation = buildCourseBridgeSummary(course, scopedVideos);

  return {
    videos: scopedVideos.videos.map((video) => buildVideoBridgePresentation(video, presentation, {
      courseId: course._id,
    })),
    presentation,
  };
}

async function findAccessibleCourseReferencingVideo(videoId, user) {
  const normalizedVideoId = normalizeIdentifier(videoId);
  const courses = await Course.find({});

  for (const course of courses) {
    const courseVideoIds = (course.videoIds || [])
      .map((candidateId) => normalizeIdentifier(candidateId))
      .filter(Boolean);

    if (!courseVideoIds.includes(normalizedVideoId)) {
      continue;
    }

    if (await canAccessCourse(user, course)) {
      return course;
    }
  }

  return null;
}

async function resolveAccessibleVideoContext(videoId, user) {
  assertObjectId(videoId, 'video');

  const video = await Video.findById(videoId)
    .populate('courseId', 'title status teacherId')
    .populate('uploadedBy', 'name email role');

  if (!video) {
    throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
  }

  if (Video.isAppOwnedRecord(video)) {
    const course = await ensureCourseExists(video.courseId?._id || video.courseId);
    await assertCanAccessCourse(user, course);

    return {
      video,
      course,
      metadataOnly: false,
      presentation: buildVideoBridgePresentation(video, buildStandardCourseSummary(), {
        courseId: course._id,
      }),
    };
  }

  const course = await findAccessibleCourseReferencingVideo(video._id, user);

  if (!course) {
    throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
  }

  const scopedVideos = await collectScopedVideos(course);
  const presentation = buildCourseBridgeSummary(course, scopedVideos);

  return {
    video,
    course,
    metadataOnly: true,
    presentation: buildVideoBridgePresentation(video, presentation, {
      courseId: course._id,
    }),
  };
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
    file_name: file.originalname,
    file_path: file.path,
    storagePath: file.path,
    durationSec: null,
    duration_sec: null,
    video_source: VIDEO_SOURCE_TYPES.UPLOAD,
    video_url: `/uploads/${file.filename}`,
    uploadedBy,
    processing: createQueuedProcessingState(),
  });

  await Course.findByIdAndUpdate(courseId, {
    $addToSet: {
      videoIds: video._id,
    },
  });

  return buildVideoBridgePresentation(video, buildStandardCourseSummary(), {
    courseId,
  });
}

async function listCourseVideos(courseId, user) {
  const course = await ensureCourseExists(courseId);
  await assertCanAccessCourse(user, course);

  return buildCourseVideoListing(course);
}

async function getVideoById(videoId, user) {
  const { presentation } = await resolveAccessibleVideoContext(videoId, user);
  return presentation;
}

async function getVideoProcessingStatus(videoId, user) {
  const { video, course, metadataOnly } = await resolveAccessibleVideoContext(videoId, user);

  if (metadataOnly) {
    throw new AppError(
      'This video is metadata-only for QA scope and does not expose processing status.',
      409,
      'VIDEO_METADATA_ONLY',
    );
  }

  await assertCanManageCourse(user, course);

  return buildProcessingMetadata(video);
}

module.exports = {
  createCourseVideo,
  listCourseVideos,
  getVideoById,
  getVideoProcessingStatus,
};
