const Course = require('../models/course.model');
const Enrollment = require('../models/enrollment.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const {
  isAdmin,
  isTeacher,
  isStudent,
  getStudentEnrollmentCourseIds,
  assertCanAccessCourse,
} = require('./courseAccess.service');
const { COURSE_STATUSES } = require('../constants/enums');
const {
  buildCourseBridgePresentation,
  collectScopedVideos,
} = require('./bridgeScope.service');

async function buildCoursePresentation(course) {
  const scopedVideos = await collectScopedVideos(course);
  return buildCourseBridgePresentation(course, scopedVideos);
}

async function createCourse({ title, description, teacherId, status, creator }) {
  const ownerId = isAdmin(creator) && teacherId ? teacherId : creator.id;
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
    courses = await Course.find({ teacherId: user.id })
      .populate('teacherId', 'name email role isActive')
      .sort({ createdAt: -1 });
  } else if (isStudent(user)) {
    const enrolledCourseIds = await getStudentEnrollmentCourseIds(user.id);

    courses = await Course.find({
      $or: [
        { status: COURSE_STATUSES.PUBLISHED },
        { _id: { $in: enrolledCourseIds } },
      ],
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

module.exports = {
  createCourse,
  listCourses,
  getCourseById,
  ensureStudentEnrollment,
};
