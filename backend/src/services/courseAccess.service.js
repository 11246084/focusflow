const Course = require('../models/course.model');
const Enrollment = require('../models/enrollment.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const {
  USER_ROLES,
  COURSE_STATUSES,
  ENROLLMENT_STATUSES,
} = require('../constants/enums');

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

function buildActiveEnrollmentFilter(filter = {}) {
  return {
    ...filter,
    // Legacy Enrollment rows predate the status field. Treat missing as active
    // until an explicit backfill is approved; revoked rows are always denied.
    $or: [
      { status: ENROLLMENT_STATUSES.ACTIVE },
      { status: { $exists: false } },
    ],
  };
}

async function findActiveEnrollment(studentId, courseId) {
  return Enrollment.findOne(buildActiveEnrollmentFilter({ studentId, courseId }));
}

async function getStudentEnrollmentCourseIds(userId) {
  const enrollments = await Enrollment.find(buildActiveEnrollmentFilter({ studentId: userId }));
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

  if (course.status !== COURSE_STATUSES.PUBLISHED) {
    return false;
  }

  return Boolean(await findActiveEnrollment(user.id, course._id));
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
  buildActiveEnrollmentFilter,
  findActiveEnrollment,
  getStudentEnrollmentCourseIds,
  getCourseByIdOrThrow,
  canAccessCourse,
  assertCanAccessCourse,
  assertCanManageCourse,
};
