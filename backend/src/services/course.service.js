const Course = require('../models/course.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');

async function createCourse({ title, description, teacherId, status }) {
  const course = await Course.create({
    title,
    description,
    teacherId,
    ...(status ? { status } : {}),
  });

  return Course.findById(course._id).populate('teacherId', 'name email role isActive');
}

async function listCourses() {
  return Course.find().populate('teacherId', 'name email role isActive').sort({ createdAt: -1 });
}

async function getCourseById(courseId) {
  assertObjectId(courseId, 'course');

  const course = await Course.findById(courseId).populate('teacherId', 'name email role isActive');

  if (!course) {
    throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  }

  return course;
}

module.exports = {
  createCourse,
  listCourses,
  getCourseById,
};
