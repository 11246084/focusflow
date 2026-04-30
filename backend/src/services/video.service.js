const path = require('path');
const { spawn } = require('child_process');
const Video = require('../models/video.model');
const VideoSegment = require('../models/videoSegment.model');
const Course = require('../models/course.model');
const mongoose = require('mongoose');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { VIDEO_SOURCE_TYPES, USER_ROLES } = require('../constants/enums');
const env = require('../config/env');
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
    fileName: file.originalname,
    filePath: file.path,
    storagePath: file.path,
    durationSec: null,
    videoSource: VIDEO_SOURCE_TYPES.UPLOAD,
    videoUrl: `/uploads/${file.filename}`,
    uploadedBy,
    processing: createQueuedProcessingState(),
  });

  await Course.findByIdAndUpdate(courseId, {
    $addToSet: {
      videoIds: video._id,
    },
  });

  // 在背景啟動 STT pipeline，不等待完成（不阻擋 HTTP 回應）
  // pipeline 會自行呼叫 /api/v1/internal/videos/:videoId/processing/start|complete|fail 回報狀態
  const sttDir = path.resolve(env.projectRoot, '../STT_Whisper');
  // 優先使用 venv 內的 Python（已安裝 faster-whisper 等依賴），找不到則 fallback 到系統 python
  const { existsSync, openSync } = require('fs');
  const venvPython = path.join(sttDir, '.venv', 'Scripts', 'python.exe');
  const pythonBin = existsSync(venvPython) ? venvPython : 'python';
  const logPath = path.join(sttDir, 'data', `pipeline_${video._id}.log`);
  const logFd = openSync(logPath, 'a');
  const sttProcess = spawn(pythonBin, [
    'src/main.py',
    '--video-path', path.resolve(file.path),
    '--video-id', String(video._id),
    '--overwrite',
  ], {
    cwd: sttDir,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env: {
      ...process.env,
      MONGODB_URI: env.mongodbUri,
      MONGODB_DATABASE_NAME: 'focusflow',
      BACKEND_URL: `http://localhost:${env.port}`,
      PROCESSING_WEBHOOK_SECRET: env.processingWebhookSecret,
    },
  });
  sttProcess.unref();

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

async function deleteVideo(videoId, user) {
  assertObjectId(videoId, 'video');

  const video = await Video.findById(videoId).lean();
  if (!video) throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');

  const isAdmin = user.role === USER_ROLES.ADMIN;
  const isOwner = String(video.uploadedBy) === String(user.id);

  if (!isAdmin && !isOwner) {
    throw new AppError('You do not have permission to delete this video.', 403, 'FORBIDDEN');
  }

  const segmentKey = video.videoId || String(video._id);
  await VideoSegment.deleteMany({ videoId: segmentKey });
  await mongoose.connection.db.collection('transcripts_normalized').deleteMany({ video_id: segmentKey });
  await Video.deleteOne({ _id: videoId });
}

module.exports = {
  createCourseVideo,
  listCourseVideos,
  getVideoById,
  getVideoProcessingStatus,
  deleteVideo,
};
