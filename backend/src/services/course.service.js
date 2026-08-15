const Course = require('../models/course.model');
const Video = require('../models/video.model');
const VideoSegment = require('../models/videoSegment.model');
const Enrollment = require('../models/enrollment.model');
const User = require('../models/user.model');
const Faq = require('../models/faq.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const {
  isAdmin,
  isTeacher,
  isStudent,
  getStudentEnrollmentCourseIds,
  findActiveEnrollment,
  assertCanAccessCourse,
} = require('./courseAccess.service');
const { COURSE_STATUS_VALUES, USAGE_LOG_EVENTS } = require('../constants/enums');
const { recordUsage } = require('./usageLog.service');
const {
  buildCourseBridgePresentation,
  collectScopedVideos,
} = require('./bridgeScope.service');
const {
  archiveForCourseDeletion,
  rollbackCourseDeletionArchive,
} = require('./shortAsset.service');
const { privatizeVideosOnDelete } = require('./youtubeUpload.service');

async function buildCoursePresentation(course) {
  const scopedVideos = await collectScopedVideos(course);
  return buildCourseBridgePresentation(course, scopedVideos);
}

async function resolveCourseTeacherId({ teacherId, creator, requiredForAdmin = false }) {
  if (!isAdmin(creator)) {
    return creator.id;
  }

  const normalizedTeacherId = String(teacherId || '').trim();
  if (!normalizedTeacherId) {
    if (requiredForAdmin) {
      throw new AppError('Teacher is required for admin-created courses.', 400, 'VALIDATION_ERROR');
    }

    return null;
  }

  assertObjectId(normalizedTeacherId, 'teacher');
  const teacher = await User.findById(normalizedTeacherId);
  if (!teacher || teacher.role !== 'teacher' || teacher.isActive === false) {
    throw new AppError('Assigned teacher not found.', 400, 'VALIDATION_ERROR');
  }

  return normalizedTeacherId;
}

async function createCourse({ title, description, teacherId, status, creator }) {
  const ownerId = await resolveCourseTeacherId({
    teacherId,
    creator,
    requiredForAdmin: true,
  });
  const course = await Course.create({
    title,
    description,
    teacherId: ownerId,
    ...(status ? { status } : {}),
  });

  const createdCourse = await Course.findById(course._id).populate('teacherId', 'name email role isActive');
  return buildCoursePresentation(createdCourse);
}

async function listCourses(user) {
  let courses = [];

  if (isAdmin(user)) {
    courses = await Course.find().populate('teacherId', 'name email role isActive').sort({ createdAt: -1 });
  } else if (isTeacher(user)) {
    courses = await Course.find({
      $or: [{ teacherId: user.id }, { status: 'published' }],
    })
      .populate('teacherId', 'name email role isActive')
      .sort({ createdAt: -1 });
  } else if (isStudent(user)) {
    const enrolledCourseIds = await getStudentEnrollmentCourseIds(user.id);
    courses = await Course.find({
      _id: { $in: enrolledCourseIds },
      status: 'published',
    })
      .populate('teacherId', 'name email role isActive')
      .sort({ createdAt: -1 });
  }

  return Promise.all(courses.map((course) => buildCoursePresentation(course)));
}

async function getCourseById(courseId, user) {
  assertObjectId(courseId, 'course');

  const course = await Course.findById(courseId).populate('teacherId', 'name email role isActive');

  if (!course) {
    throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  }

  await assertCanAccessCourse(user, course);

  return buildCoursePresentation(course);
}

async function updateCourse(courseId, { title, description, status, teacherId }, user) {
  assertObjectId(courseId, 'course');

  const course = await Course.findById(courseId);
  if (!course) throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');

  if (!isAdmin(user) && String(course.teacherId) !== String(user.id)) {
    throw new AppError('You do not have permission to update this course.', 403, 'FORBIDDEN');
  }

  if (title !== undefined) {
    const trimmed = String(title).trim();
    if (!trimmed) throw new AppError('Course title is required.', 400, 'VALIDATION_ERROR');
    course.title = trimmed;
  }
  if (description !== undefined) course.description = String(description).trim();
  if (status !== undefined) {
    if (!COURSE_STATUS_VALUES.includes(status)) throw new AppError('Invalid status.', 400, 'VALIDATION_ERROR');
    course.status = status;
  }
  if (teacherId !== undefined) {
    if (!isAdmin(user)) {
      throw new AppError('Only admins can reassign courses.', 403, 'FORBIDDEN');
    }
    course.teacherId = await resolveCourseTeacherId({ teacherId, creator: user, requiredForAdmin: true });
  }

  if (typeof course.save === 'function') {
    await course.save();
  } else {
    await Course.findByIdAndUpdate(courseId, {
      title: course.title,
      description: course.description,
      status: course.status,
      teacherId: course.teacherId,
    });
  }
  const updated = await Course.findById(courseId).populate('teacherId', 'name email role isActive');
  return buildCoursePresentation(updated);
}

async function deleteCourse(courseId, user) {
  assertObjectId(courseId, 'course');

  const course = await Course.findById(courseId).lean();
  if (!course) throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');

  // Admin 可刪任何課程；教師只能刪自己擁有的課程。
  const isOwnerTeacher = isTeacher(user) && String(course.teacherId) === String(user.id);
  if (!isAdmin(user) && !isOwnerTeacher) {
    throw new AppError('You do not have permission to delete this course.', 403, 'FORBIDDEN');
  }

  // 設計決策：UsageLog / Question 屬於歷史紀錄，不隨課程刪除一起清。
  // 顯示層會自行處理「歷史記錄指向不存在課程」的情境。
  const videos = await Video.find({ courseId }).lean();
  for (const v of videos) {
    const segKey = v.videoId || String(v._id);
    await VideoSegment.deleteMany({ videoId: segKey });
  }
  await Video.deleteMany({ courseId });
  // 主課程刪除連同影片刪除後，清掉其他課程對這些影片的掛載引用。
  const deletedVideoIds = videos.map((v) => v._id);
  if (deletedVideoIds.length) {
    await Course.updateMany({}, { $pull: { videoIds: { $in: deletedVideoIds } } });
  }
  // 影片已從 DB 移除，YouTube 上的副本一併轉 private，避免舊連結仍可播放。
  // 放在 Course.deleteOne 之前：影片刪除本身不可逆，course delete 失敗也不該讓影片繼續公開。
  await privatizeVideosOnDelete(videos);
  await Enrollment.deleteMany({ courseId });
  await Faq.deleteMany({ courseId });

  // 仍保留：清空 LINE 對話狀態（這是 runtime state，不是歷史紀錄）。
  await User.updateMany({ activeCourseId: courseId }, { $unset: { activeCourseId: 1 } });

  // ShortAsset 不隨課程 hard delete 消失。此步驟 retry-safe，但整段 cascade
  // 沒有 transaction/atomicity 保證；只有最後 Course delete 失敗時做 best-effort 還原。
  const archivedShortAssets = await archiveForCourseDeletion(course);
  try {
    const result = await Course.deleteOne({ _id: courseId });
    if (result?.deletedCount !== 1) {
      throw new AppError('Course could not be deleted.', 500, 'COURSE_DELETE_FAILED');
    }
  } catch (error) {
    try {
      await rollbackCourseDeletionArchive(archivedShortAssets);
    } catch (rollbackError) {
      console.error('Failed to roll back ShortAsset course deletion archive.', rollbackError);
    }
    throw error;
  }
}

async function markVideoWatched({ user, courseId, videoId }) {
  assertObjectId(courseId, 'course');
  assertObjectId(videoId, 'video');

  if (!isStudent(user)) {
    throw new AppError('Only students can record watched videos.', 403, 'FORBIDDEN');
  }

  const course = await Course.findById(courseId);
  if (!course) throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  await assertCanAccessCourse(user, course);

  // 影片可能屬於主課程（video.courseId）或被此課程掛載（course.videoIds）。
  const video = await Video.findById(videoId);
  const isPrimaryCourseVideo = video && String(video.courseId) === String(courseId);
  const isAttachedVideo = (course.videoIds || []).some((id) => String(id) === String(videoId));
  if (!video || (!isPrimaryCourseVideo && !isAttachedVideo)) {
    throw new AppError('Video not found in this course.', 404, 'VIDEO_NOT_FOUND');
  }

  const enrollment = await findActiveEnrollment(user.id, courseId);
  if (!enrollment) {
    // Defense in depth: assertCanAccessCourse already rejects this path, but a
    // second explicit guard prevents watched tracking from ever granting access.
    throw new AppError('You do not have access to this course.', 403, 'COURSE_ACCESS_DENIED');
  }
  const previousWatched = new Set((enrollment.watchedVideoIds || []).map(String));
  const isFirstWatch = !previousWatched.has(String(videoId));
  const watched = new Set(previousWatched);
  watched.add(String(videoId));

  // 進度分母 = 主課程影片（video.courseId）∪ 掛載影片（course.videoIds）。
  // 只算 course.videoIds 會漏掉未掛載的主課程影片，看完仍顯示 0%。
  const primaryVideos = await Video.find({ courseId }).select('_id').lean();
  const courseVideoIdSet = new Set([
    ...primaryVideos.map((item) => String(item._id)),
    ...(course.videoIds || []).map(String),
  ]);
  const totalVideos = courseVideoIdSet.size || 1;
  const watchedInCourse = [...watched].filter((id) => courseVideoIdSet.has(id));
  const progress = Math.min(100, Math.round((watchedInCourse.length / totalVideos) * 100));

  await Enrollment.findOneAndUpdate(
    { studentId: user.id, courseId },
    { $set: { watchedVideoIds: [...watched], progress } },
  );

  if (isFirstWatch) {
    await recordUsage({
      userId: user.id,
      courseId,
      event: USAGE_LOG_EVENTS.WATCH,
      metadata: { videoId: String(videoId) },
    });
  }

  return {
    courseId: String(courseId),
    videoId: String(videoId),
    watchedCount: watchedInCourse.length,
    totalVideos,
    progress,
  };
}

module.exports = {
  createCourse,
  listCourses,
  getCourseById,
  updateCourse,
  deleteCourse,
  resolveCourseTeacherId,
  markVideoWatched,
};
