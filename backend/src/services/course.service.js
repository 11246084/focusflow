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

async function createCourse({ title, description, teacherId, status, creator }) {
  const ownerId = isAdmin(creator) && teacherId ? teacherId : creator.id;
  const course = await Course.create({
    title,
    description,
    teacherId: ownerId,
    ...(status ? { status } : {}),
  });

  return Course.findById(course._id).populate('teacherId', 'name email role isActive');
}

async function listCourses(user) {
  if (isAdmin(user)) {
    return Course.find().populate('teacherId', 'name email role isActive').sort({ createdAt: -1 });
  }

  if (isTeacher(user)) {
    return Course.find({ teacherId: user.id })
      .populate('teacherId', 'name email role isActive')
      .sort({ createdAt: -1 });
  }

  if (isStudent(user)) {
    const enrolledCourseIds = await getStudentEnrollmentCourseIds(user.id);

    return Course.find({
      $or: [
        { status: COURSE_STATUSES.PUBLISHED },
        { _id: { $in: enrolledCourseIds } },
      ],
    })
      .populate('teacherId', 'name email role isActive')
      .sort({ createdAt: -1 });
  }

  return [];
}

async function getCourseById(courseId, user) {
  assertObjectId(courseId, 'course');

  const course = await Course.findById(courseId).populate('teacherId', 'name email role isActive');

  if (!course) {
    throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  }

  await assertCanAccessCourse(user, course);

  return course;
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
