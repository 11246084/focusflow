const Course = require('../models/course.model');
const Video = require('../models/video.model');
const VideoSegment = require('../models/videoSegment.model');
const Enrollment = require('../models/enrollment.model');
const User = require('../models/user.model');
const UsageLog = require('../models/usageLog.model');
const Question = require('../models/question.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const {
  isAdmin,
  isTeacher,
  isStudent,
  getStudentEnrollmentCourseIds,
  assertCanAccessCourse,
} = require('./courseAccess.service');
const { COURSE_STATUS_VALUES } = require('../constants/enums');
const {
  buildCourseBridgePresentation,
  collectScopedVideos,
} = require('./bridgeScope.service');

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
    courses = await Course.find({ status: 'published' })
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

async function ensureStudentEnrollment(studentId, courseId) {
  return Enrollment.findOneAndUpdate(
    { studentId, courseId },
    {
      $setOnInsert: {
        studentId,
        courseId,
        enrolledAt: new Date(),
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );
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

  if (!isAdmin(user)) {
    throw new AppError('Only admins can delete courses.', 403, 'FORBIDDEN');
  }

  const course = await Course.findById(courseId).lean();
  if (!course) throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');

  // Cascade: collect segmentIds before deletion so we can clean orphan references.
  const videos = await Video.find({ courseId }).lean();
  const allSegmentIds = [];
  for (const v of videos) {
    const segKey = v.videoId || String(v._id);
    const segments = await VideoSegment.find({ videoId: segKey });
    allSegmentIds.push(...segments.map((s) => s.segmentId).filter(Boolean));
    await VideoSegment.deleteMany({ videoId: segKey });
  }
  await Video.deleteMany({ courseId });
  await Enrollment.deleteMany({ courseId });

  // Cascade: clean usage logs / questions tied to this course or its segments.
  await UsageLog.deleteMany({ courseId });
  await Question.deleteMany({ courseId });
  if (allSegmentIds.length) {
    // catch any logs/questions referenced by segmentId but with a different courseId
    await UsageLog.deleteMany({
      $or: [
        { 'metadata.topSegmentId': { $in: allSegmentIds } },
        { 'metadata.segmentId': { $in: allSegmentIds } },
      ],
    });
    await Question.deleteMany({ topSegmentId: { $in: allSegmentIds } });
  }

  // Cascade: clear any user whose activeCourseId points to this course (LINE bot state).
  await User.updateMany({ activeCourseId: courseId }, { $unset: { activeCourseId: 1 } });

  await Course.deleteOne({ _id: courseId });
}

module.exports = {
  createCourse,
  listCourses,
  getCourseById,
  updateCourse,
  deleteCourse,
  ensureStudentEnrollment,
  resolveCourseTeacherId,
};
