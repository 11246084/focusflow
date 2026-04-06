const Course = require('../models/course.model');
const Enrollment = require('../models/enrollment.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { USER_ROLES, COURSE_STATUSES } = require('../constants/enums');

function isAdmin(user) {
  return user?.role === USER_ROLES.ADMIN;
}

function isTeacher(user) {
  return user?.role === USER_ROLES.TEACHER;
}

function isStudent(user) {
  return user?.role === USER_ROLES.STUDENT;
}

function isCourseOwner(user, course) {
  return String(course.teacherId?._id || course.teacherId) === String(user.id);
}

async function getStudentEnrollmentCourseIds(userId) {
  const enrollments = await Enrollment.find({ studentId: userId });
  return enrollments.map((item) => String(item.courseId?._id || item.courseId));
}

async function getCourseByIdOrThrow(courseId) {
  assertObjectId(courseId, 'course');
  const course = await Course.findById(courseId).populate('teacherId', 'name email role isActive');

  if (!course) {
    throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  }

  return course;
}

async function canAccessCourse(user, course) {
  if (isAdmin(user)) {
    return true;
  }

  if (isTeacher(user)) {
    return isCourseOwner(user, course);
  }

  if (!isStudent(user)) {
    return false;
  }

  if (course.status === COURSE_STATUSES.PUBLISHED) {
    return true;
  }

  const enrollment = await Enrollment.findOne({
    studentId: user.id,
    courseId: course._id,
  });

  return Boolean(enrollment);
}

async function assertCanAccessCourse(user, course) {
  const allowed = await canAccessCourse(user, course);

  if (!allowed) {
    throw new AppError('You do not have access to this course.', 403, 'COURSE_ACCESS_DENIED');
  }
}

async function assertCanManageCourse(user, course) {
  if (isAdmin(user)) {
    return;
  }

  if (isTeacher(user) && isCourseOwner(user, course)) {
    return;
  }

  throw new AppError('You do not have permission to manage this course.', 403, 'COURSE_MANAGE_DENIED');
}

module.exports = {
  isAdmin,
  isTeacher,
  isStudent,
  getStudentEnrollmentCourseIds,
  getCourseByIdOrThrow,
  canAccessCourse,
  assertCanAccessCourse,
  assertCanManageCourse,
};
