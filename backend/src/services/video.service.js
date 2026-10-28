const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { closeSync, createReadStream, existsSync, mkdirSync, openSync, unlinkSync } = require('fs');
const Video = require('../models/video.model');
const VideoSegment = require('../models/videoSegment.model');
const VideoSegmentVideo = require('../models/videoSegmentVideo.model');
const Course = require('../models/course.model');
const mongoose = require('mongoose');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const {
  VIDEO_PROCESSING_STATUSES,
  VIDEO_SOURCE_TYPES,
  USER_ROLES,
  YOUTUBE_UPLOAD_STATUSES,
} = require('../constants/enums');
const env = require('../config/env');
const { decodeUploadFilename } = require('../middleware/upload.middleware');
const {
  buildProcessingMetadata,
  createQueuedProcessingState,
  failVideoProcessing,
  queueVideoForProcessing,
} = require('./videoProcessing.service');
const {
  attachSttProcessLifecycle,
  buildSttProcessEnvironment,
} = require('./sttProcessLifecycle.service');
const youtubeUploadService = require('./youtubeUpload.service');
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
const { clearFaqsForVideoCourses } = require('./faqCache.service');
const { enqueueVideoProcessing } = require('./videoProcessingQueue.service');
const { assertMediaIntegrity } = require('./mediaIntegrity.service');
const { removeVideoNotifications } = require('./notification.service');
const { inspectLocalUploadFile, isLocalVideoSourceAvailable, resolveLocalUploadPath } = require('../utils/localVideoSource');
const { discardUnreferencedUpload } = require('./localSourceCleanup.service');
const { NO_CLEANUP_INTENT, fileWorkKeys, observedFields, randomWorkId, sourceWorkKey, tryAcquireWork } = require('./youtubeWorkOwnership.service');

// 依作業系統解析 STT venv 的 Python 執行檔；找不到 venv 時 fallback 到系統 Python。
// Windows venv 在 .venv\Scripts\python.exe，Linux/macOS 在 .venv/bin/python。
function resolveSttPython(sttDir) {
  const isWin = process.platform === 'win32';
  const venvPython = isWin
    ? path.join(sttDir, '.venv', 'Scripts', 'python.exe')
    : path.join(sttDir, '.venv', 'bin', 'python');
  if (existsSync(venvPython)) {
    return venvPython;
  }
  // Rocky/Ubuntu 等 Linux 預設常只有 python3，沒有 python，故 fallback 也要分平台。
  return isWin ? 'python' : 'python3';
}

async function markUnexpectedSttExitFailed(videoId, failure) {
  const video = await Video.findById(videoId);
  const currentStatus = video?.processing?.status;
  if (![
    VIDEO_PROCESSING_STATUSES.QUEUED,
    VIDEO_PROCESSING_STATUSES.PROCESSING,
  ].includes(currentStatus)) {
    return;
  }

  await failVideoProcessing(videoId, failure);
}

// 已清理：YouTube 上傳完成、原片已由清理流程刪除（filePath 清空並記下 localCleanupAt）。
function isLocalSourceCleaned(video) {
  return Boolean(
    video
    && !video.filePath
    && video.youtubeVideoId
    && video.youtubeUpload?.status === YOUTUBE_UPLOAD_STATUSES.UPLOADED
    && video.youtubeUpload?.localCleanupAt,
  );
}

function createRetrySourceUnavailableError() {
  return new AppError(
    'The local source file is unavailable for processing retry.',
    409,
    'VIDEO_PROCESSING_RETRY_SOURCE_UNAVAILABLE',
  );
}

function spawnLocalVideoPipeline({ videoId, filePath }, { onClose = null } = {}) {
  const normalizedVideoId = String(videoId || '').trim();
  if (!normalizedVideoId || !isLocalVideoSourceAvailable(filePath)) {
    throw createRetrySourceUnavailableError();
  }
  const normalizedPath = resolveLocalUploadPath(filePath);

  const sttDir = path.resolve(env.projectRoot, '../STT_Whisper');
  const logPath = path.join(sttDir, 'data', `pipeline_${normalizedVideoId}.log`);
  mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');
  let sttProcess;
  try {
    sttProcess = spawn(resolveSttPython(sttDir), [
      'src/main.py',
      '--video-path', normalizedPath,
      '--video-id', normalizedVideoId,
      '--overwrite',
    ], {
      cwd: sttDir,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      env: buildSttProcessEnvironment(process.env, {
        MONGODB_URI: env.mongodbUri,
        MONGODB_DATABASE_NAME: 'focusflow',
        BACKEND_URL: `http://localhost:${env.port}`,
        PROCESSING_WEBHOOK_SECRET: env.processingWebhookSecret,
        CLEANUP_AFTER_UPLOAD: 'true',
        CLEANUP_KEEP_CHECKPOINTS: 'false',
      }),
    });
  } catch (error) {
    try { closeSync(logFd); } catch { /* best effort */ }
    throw error;
  }
  attachSttProcessLifecycle({
    sttProcess,
    logFd,
    videoId: normalizedVideoId,
    onUnexpectedExit: (failure) => markUnexpectedSttExitFailed(normalizedVideoId, failure),
    onClose,
  });
  sttProcess.unref();
  return { pid: sttProcess.pid || null };
}

async function scheduleExistingVideoProcessing(videoId) {
  const video = await Video.findById(videoId);
  if (!video) throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
  assertMediaIntegrity(resolveLocalUploadPath(video.filePath), video.fileName);
  const normalizedVideoId = String(video._id);
  return enqueueVideoProcessing({
    videoId: normalizedVideoId,
    start: (done) => spawnLocalVideoPipeline(
      { videoId: normalizedVideoId, filePath: video.filePath },
      { onClose: done },
    ),
    onStartError: (error) => markUnexpectedSttExitFailed(normalizedVideoId, {
      errorCode: 'PIPELINE_SCHEDULE_FAILED',
      errorMessage: `STT Pipeline could not be started (${error.message}).`,
    }),
  });
}

async function retryExistingVideoProcessingOwned(videoId, user) {
  const video = await Video.findById(videoId).lean();
  if (!video) throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
  const course = await getCourseByIdOrThrow(video.courseId?._id || video.courseId);
  await assertCanManageCourse(user, course);
  const skipLocalSourceChecks = process.env.NODE_ENV === 'test'
    || env.processingWebhookSecret === 'processing-secret-for-tests';
  const completed = video.processing?.status === VIDEO_PROCESSING_STATUSES.COMPLETED;
  // 原片已清理（#21）時一律擋下，不改走 YouTube 下載；先檢查來源再排入佇列，
  // 避免影片卡在 queued。
  if (isLocalSourceCleaned(video) || ((completed || !skipLocalSourceChecks) && !isLocalVideoSourceAvailable(video.filePath))) {
    throw createRetrySourceUnavailableError();
  }
  if (completed || !skipLocalSourceChecks) {
    assertMediaIntegrity(resolveLocalUploadPath(video.filePath), video.fileName);
  }
  // Pass the source checked above: a new read alone could accept a source
  // already removed by another backend between validation and queueing.
  const queuedVideo = await queueVideoForProcessing(videoId, { allowCompleted: completed, observed: video });
  if (process.env.NODE_ENV === 'test' || env.processingWebhookSecret === 'processing-secret-for-tests') {
    return queuedVideo;
  }
  await scheduleExistingVideoProcessing(videoId);
  return queuedVideo;
}

async function recoverQueuedVideoProcessing() {
  const queuedVideos = await Video.find({
    sourceType: VIDEO_SOURCE_TYPES.UPLOAD,
    'processing.status': VIDEO_PROCESSING_STATUSES.QUEUED,
  }).sort({ 'processing.queuedAt': 1, createdAt: 1 });
  const results = [];
  for (const video of queuedVideos) {
    if (!video.filePath || !existsSync(resolveLocalUploadPath(video.filePath))) continue;
    try {
      results.push(await scheduleExistingVideoProcessing(video._id));
    } catch (error) {
      await markUnexpectedSttExitFailed(video._id, {
        errorCode: error.code || 'PIPELINE_RECOVERY_SOURCE_INVALID',
        errorMessage: error.message || 'Queued video source is invalid.',
      });
    }
  }
  return results;
}

async function ensureCourseExists(courseId) {
  return getCourseByIdOrThrow(courseId);
}

function buildStandardCourseSummary() {
  return {
    qaScopeOnly: false,
    bridgeMode: COURSE_BRIDGE_MODES.STANDARD,
  };
}

async function clearVideoFaqsBeforeMutation(video) {
  try {
    await clearFaqsForVideoCourses(video, { throwOnError: true });
  } catch (error) {
    const operationalError = new AppError(
      'FAQ cache cleanup failed. No video changes were applied; please retry.',
      503,
      'FAQ_INVALIDATION_FAILED',
    );
    operationalError.cause = error;
    throw operationalError;
  }
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

async function findAccessibleCourseReferencingVideo(video, user) {
  const normalizedVideoIds = [
    normalizeIdentifier(video?._id, video?.id),
    normalizeIdentifier(video?.videoId, video?.video_id),
  ].filter(Boolean);
  const courses = await Course.find({});

  for (const course of courses) {
    const courseVideoIds = (course.videoIds || [])
      .map((candidateId) => normalizeIdentifier(candidateId))
      .filter(Boolean);

    if (!normalizedVideoIds.some((videoId) => courseVideoIds.includes(videoId))) {
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
    // 影片可掛載到多個課程：主課程無權限時，改找任一有權限且引用此影片的課程。
    let course = null;
    try {
      const primaryCourse = await ensureCourseExists(video.courseId?._id || video.courseId);
      await assertCanAccessCourse(user, primaryCourse);
      course = primaryCourse;
    } catch (primaryAccessError) {
      course = await findAccessibleCourseReferencingVideo(video, user);
      if (!course) {
        throw primaryAccessError;
      }
    }

    return {
      video,
      course,
      metadataOnly: false,
      presentation: buildVideoBridgePresentation(video, buildStandardCourseSummary(), {
        courseId: course._id,
      }),
    };
  }

  const course = await findAccessibleCourseReferencingVideo(video, user);

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

function parseYouTubeVideoId(url) {
  const patterns = [
    /[?&]v=([^&#]+)/,
    /youtu\.be\/([^?&#]+)/,
    /\/shorts\/([^?&#]+)/,
    /\/embed\/([^?&#]+)/,
  ];
  for (const pattern of patterns) {
    const match = String(url).match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function createCourseVideoFromYouTube({ courseId, youtubeUrl, title, week, lesson, uploadedBy, user }) {
  const youtubeVideoId = parseYouTubeVideoId(youtubeUrl);
  if (!youtubeVideoId) {
    throw new AppError('Invalid YouTube URL.', 400, 'VALIDATION_ERROR');
  }

  const course = await ensureCourseExists(courseId);
  await assertCanManageCourse(user, course);

  const existing = await Video.findOne({ courseId, youtubeVideoId });
  if (existing) {
    throw new AppError(
      'This YouTube video has already been added to this course.',
      409,
      'DUPLICATE_VIDEO',
    );
  }

  const video = await Video.create({
    courseId,
    title: String(title || '').trim() || `YouTube: ${youtubeVideoId}`,
    sourceType: VIDEO_SOURCE_TYPES.YOUTUBE,
    sourceUrl: null,
    youtubeVideoId,
    videoSource: 'youtube',
    videoUrl: youtubeUrl,
    week: week || null,
    lesson: lesson || null,
    uploadedBy,
    processing: createQueuedProcessingState(),
  });

  await Course.findByIdAndUpdate(courseId, { $addToSet: { videoIds: video._id } });

  if (process.env.NODE_ENV === 'test' || env.processingWebhookSecret === 'processing-secret-for-tests') {
    return buildVideoBridgePresentation(video, buildStandardCourseSummary(), { courseId });
  }

  const sttDir = path.resolve(env.projectRoot, '../STT_Whisper');
  const pythonBin = resolveSttPython(sttDir);
  const logPath = path.join(sttDir, 'data', `pipeline_${video._id}.log`);
  mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');
  const sttProcess = spawn(pythonBin, [
    'src/main.py',
    '--youtube-url', youtubeUrl,
    '--video-id', String(video._id),
    '--overwrite',
  ], {
    cwd: sttDir,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env: buildSttProcessEnvironment(process.env, {
      MONGODB_URI: env.mongodbUri,
      MONGODB_DATABASE_NAME: 'focusflow',
      BACKEND_URL: `http://localhost:${env.port}`,
      PROCESSING_WEBHOOK_SECRET: env.processingWebhookSecret,
      CLEANUP_AFTER_UPLOAD: 'true',
      CLEANUP_KEEP_CHECKPOINTS: 'false',
    }),
  });
  attachSttProcessLifecycle({
    sttProcess,
    logFd,
    videoId: String(video._id),
    onUnexpectedExit: (failure) => markUnexpectedSttExitFailed(String(video._id), failure),
  });
  sttProcess.unref();

  return buildVideoBridgePresentation(video, buildStandardCourseSummary(), { courseId });
}

async function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function createCourseVideo({
  courseId,
  title,
  file,
  uploadedBy,
  user,
  deferProcessingStart = false,
}) {
  if (!file) {
    throw new AppError('Video file is required.', 400, 'VIDEO_FILE_REQUIRED');
  }

  const course = await ensureCourseExists(courseId);
  await assertCanManageCourse(user, course);
  const originalName = decodeUploadFilename(file.originalname);

  if (process.env.NODE_ENV !== 'test') {
    try {
      assertMediaIntegrity(file.path, originalName);
    } catch (error) {
      try { unlinkSync(file.path); } catch { /* best effort */ }
      throw error;
    }
  }

  const fileHash = await computeFileHash(file.path);
  const existing = await Video.findOne({ courseId, fileHash });
  if (existing) {
    try { unlinkSync(file.path); } catch { /* ignore */ }
    throw new AppError(
      'This video file has already been uploaded to this course.',
      409,
      'DUPLICATE_VIDEO',
      { existingVideoId: String(existing._id) },
    );
  }

  const normalizedTitle = String(title || '').trim() || originalName;
  const playbackUrl = `/uploads/${file.filename}`;

  const video = await Video.create({
    courseId,
    title: normalizedTitle,
    sourceType: VIDEO_SOURCE_TYPES.UPLOAD,
    sourceUrl: playbackUrl,
    fileName: originalName,
    filePath: file.path,
    fileHash,
    durationSec: null,
    videoSource: VIDEO_SOURCE_TYPES.UPLOAD,
    videoUrl: playbackUrl,
    youtubeVideoId: null,
    uploadedBy,
    processing: createQueuedProcessingState(),
  });

  await Course.findByIdAndUpdate(courseId, {
    $addToSet: {
      videoIds: video._id,
    },
  });

  if (
    deferProcessingStart
    || process.env.NODE_ENV === 'test'
    || env.processingWebhookSecret === 'processing-secret-for-tests'
  ) {
    return buildVideoBridgePresentation(video, buildStandardCourseSummary(), {
      courseId,
    });
  }

  // 在背景啟動 STT pipeline，不等待完成（不阻擋 HTTP 回應）
  // pipeline 會自行呼叫 /api/v1/internal/videos/:videoId/processing/start|complete|fail 回報狀態
  await scheduleExistingVideoProcessing(video._id);

  return buildVideoBridgePresentation(video, buildStandardCourseSummary(), {
    courseId,
  });
}

// 補回原片（#23）：只接受已清理的影片，存回同一支影片讓之後可以重新處理。
// 播放欄位與 youtubeVideoId 不動，學生照常看 YouTube 版本；自動上傳遇到
// 已有 youtubeVideoId 會略過，所以重新處理完成不會再傳一次 YouTube（#25）。
async function restoreVideoSourceOwned({ videoId, file, user }) {
  if (!file) {
    throw new AppError('Video file is required.', 400, 'VIDEO_FILE_REQUIRED');
  }

  try {
    assertObjectId(videoId, 'video');
    const video = await Video.findById(videoId).lean();
    if (!video || !Video.isAppOwnedRecord(video)) {
      throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
    }
    const course = await getCourseByIdOrThrow(video.courseId?._id || video.courseId);
    await assertCanManageCourse(user, course);

    if (!isLocalSourceCleaned(video)) {
      throw new AppError(
        'Only videos whose local source was cleaned after YouTube upload can be restored.',
        409,
        'VIDEO_SOURCE_RESTORE_NOT_ALLOWED',
      );
    }

    // 補回的檔案之後要給 STT 重新處理，容器檢查在所有環境都執行。
    const originalName = decodeUploadFilename(file.originalname);
    assertMediaIntegrity(file.path, originalName);

    const fileHash = await computeFileHash(file.path);
    const otherVideo = await Video.findOne({
      courseId: video.courseId?._id || video.courseId,
      fileHash,
      _id: { $ne: video._id },
    });
    if (otherVideo) {
      throw new AppError(
        'This file belongs to another video in this course.',
        409,
        'DUPLICATE_VIDEO',
        { existingVideoId: String(otherVideo._id) },
      );
    }

    // 條件更新：同時送出兩次補回時只有一次成功，另一次回 409。
    const restoredVideo = await Video.findOneAndUpdate(
      {
        _id: video._id,
        filePath: null,
        ...NO_CLEANUP_INTENT,
        'youtubeUpload.localCleanupAt': { $ne: null },
        $and: observedFields(video, ['youtubeUpload.localCleanupAt', 'youtubeUpload.localSourceVersion', 'processing.status']),
      },
      {
        $set: {
          filePath: file.path,
          fileName: originalName,
          'youtubeUpload.localSourceVersion': randomWorkId(),
          'youtubeUpload.localSourceRestoredAt': new Date(),
          'youtubeUpload.localCleanupAt': null,
          'youtubeUpload.localCleanupError': null,
        },
      },
      { new: true },
    );
    if (!restoredVideo) {
      throw new AppError(
        'The video source was restored by another request.',
        409,
        'VIDEO_SOURCE_RESTORE_NOT_ALLOWED',
      );
    }
  } catch (error) {
    throw error;
  }

  return getVideoById(videoId, user);
}

async function restoreVideoSource(options) {
  const release = tryAcquireWork([sourceWorkKey('video', options.videoId)]);
  let releaseFile;
  try {
    if (!release) throw new AppError('The video source is in use.', 409, 'VIDEO_SOURCE_RESTORE_NOT_ALLOWED');
    if (options.file?.path) {
      const source = inspectLocalUploadFile(options.file.path);
      if (!source.safe) throw new AppError('Invalid local restore source.', 409, 'VIDEO_SOURCE_RESTORE_NOT_ALLOWED');
      releaseFile = tryAcquireWork(fileWorkKeys(source));
      if (!releaseFile) throw new AppError('The restore source is in use.', 409, 'VIDEO_SOURCE_RESTORE_NOT_ALLOWED');
    }
    return await restoreVideoSourceOwned(options);
  } catch (error) {
    releaseFile?.(); releaseFile = null;
    await discardUnreferencedUpload(options.file);
    throw error;
  } finally { releaseFile?.(); release?.(); }
}

async function retryExistingVideoProcessing(videoId, user) {
  const release = tryAcquireWork([sourceWorkKey('video', videoId)]);
  let releaseFile;
  try {
    if (!release) throw new AppError('The video source is in use.', 409, 'VIDEO_PROCESSING_TRANSITION_INVALID');
    const video = await Video.findById(videoId).lean();
    if (video?.filePath) {
      const source = inspectLocalUploadFile(video.filePath);
      releaseFile = tryAcquireWork(fileWorkKeys(source));
      if (!releaseFile) throw createRetrySourceUnavailableError();
    }
    return await retryExistingVideoProcessingOwned(videoId, user);
  } finally { releaseFile?.(); release?.(); }
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

  // 設計決策：UsageLog / Question 屬於歷史紀錄，不隨影片刪除一起清。
  // 顯示層（teacherStats / admin recent events）會自行 filter / 標示已刪除。
  // FAQ 必須先清除成功；失敗時不可開始任何不可逆的影片／片段／關聯 mutation。
  await clearVideoFaqsBeforeMutation(video);

  const segmentKey = normalizeIdentifier(video.videoId, video.video_id, video._id);
  await VideoSegment.deleteMany({ videoId: segmentKey });
  // 影像片段綁定鍵是 String(videos._id)；pipeline metadata 影片則沿用 segmentKey。
  await VideoSegmentVideo.deleteMany({ video_id: { $in: [...new Set([segmentKey, String(video._id)])] } });
  await mongoose.connection.db.collection('transcripts_normalized').deleteMany({ video_id: segmentKey });
  await Video.deleteOne({ _id: videoId });
  await removeVideoNotifications([video._id]);
  // 影片可能掛載到多個課程，從所有課程的 videoIds 清掉引用（含主課程）。
  await Course.updateMany({}, { $pull: { videoIds: video._id } });
  // 系統刪除不會刪 YouTube 上的影片，否則舊連結仍可播放；改轉 private（可還原）。
  await youtubeUploadService.privatizeVideoOnDelete(video);

  return { deletedVideoId: videoId, segmentKey };
}

async function attachVideoToCourse({ courseId, videoId, user }) {
  assertObjectId(courseId, 'course');
  assertObjectId(videoId, 'video');

  const course = await ensureCourseExists(courseId);
  await assertCanManageCourse(user, course);

  const video = await Video.findById(videoId);
  if (!video || !Video.isAppOwnedRecord(video)) {
    throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
  }

  // 只能掛載自己管得動的影片：需同時具備影片主課程的管理權限（或 admin）。
  const primaryCourse = await ensureCourseExists(video.courseId?._id || video.courseId);
  await assertCanManageCourse(user, primaryCourse);

  if (String(primaryCourse._id) === String(course._id)) {
    throw new AppError('Video already belongs to this course.', 409, 'DUPLICATE_VIDEO');
  }

  const alreadyAttached = (course.videoIds || [])
    .some((existingId) => String(existingId) === String(video._id));
  if (alreadyAttached) {
    throw new AppError('Video is already attached to this course.', 409, 'DUPLICATE_VIDEO');
  }

  await Course.findByIdAndUpdate(courseId, { $addToSet: { videoIds: video._id } });
  // 課程的 QA scope 多了一支影片，既有快取答案是舊範圍算出來的，清掉讓下次提問重建。
  // 必須在 $addToSet 之後呼叫，clearFaqsForVideoCourses 是靠 Course.videoIds 反查課程的。
  await clearFaqsForVideoCourses(video);

  return buildVideoBridgePresentation(video, buildStandardCourseSummary(), { courseId });
}

async function detachVideoFromCourse({ courseId, videoId, user }) {
  assertObjectId(courseId, 'course');
  assertObjectId(videoId, 'video');

  const course = await ensureCourseExists(courseId);
  await assertCanManageCourse(user, course);

  const video = await Video.findById(videoId);
  if (!video) {
    throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');
  }

  if (String(video.courseId?._id || video.courseId) === String(course._id)) {
    throw new AppError(
      'Cannot detach a video from its primary course. Delete the video instead.',
      400,
      'VALIDATION_ERROR',
    );
  }

  const isAttached = (course.videoIds || [])
    .some((existingId) => String(existingId) === String(video._id));
  if (!isAttached) {
    throw new AppError('Video is not attached to this course.', 404, 'VIDEO_NOT_FOUND');
  }

  // 快取答案可能引用這支影片的片段，移除後那些跳轉對本課程學生已不成立。
  // 必須在 $pull 之前呼叫，否則引用一被移除就反查不到這門課（與 deleteVideo 同一個順序理由）。
  await clearVideoFaqsBeforeMutation(video);
  await Course.findByIdAndUpdate(courseId, { $pull: { videoIds: video._id } });
}

module.exports = {
  createCourseVideo,
  createCourseVideoFromYouTube,
  listCourseVideos,
  getVideoById,
  getVideoProcessingStatus,
  deleteVideo,
  attachVideoToCourse,
  detachVideoFromCourse,
  scheduleExistingVideoProcessing,
  recoverQueuedVideoProcessing,
  retryExistingVideoProcessing,
  restoreVideoSource,
  spawnLocalVideoPipeline,
};
