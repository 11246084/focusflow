const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const courseService = require('../services/course.service');

const createCourse = asyncHandler(async (req, res) => {
  const { title, description, status, teacherId } = req.body;

  if (!title || !String(title).trim()) {
    throw new AppError('Course title is required.', 400, 'VALIDATION_ERROR');
  }

  const course = await courseService.createCourse({
    title: String(title).trim(),
    description: String(description || '').trim(),
    status: status ? String(status).trim() : undefined,
    teacherId: teacherId ? String(teacherId).trim() : undefined,
    creator: req.user,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Course created successfully.',
    data: {
      course,
    },
  });
});

const listCourses = asyncHandler(async (req, res) => {
  const courses = await courseService.listCourses(req.user);

  return sendSuccess(res, {
    message: 'Courses fetched successfully.',
    data: {
      courses,
    },
  });
});

const getCourseById = asyncHandler(async (req, res) => {
  const course = await courseService.getCourseById(req.params.courseId, req.user);

  return sendSuccess(res, {
    message: 'Course fetched successfully.',
    data: {
      course,
    },
  });
});

const updateCourse = asyncHandler(async (req, res) => {
  const { title, description, status } = req.body;
  const course = await courseService.updateCourse(req.params.courseId, { title, description, status }, req.user);
  return sendSuccess(res, { message: 'Course updated.', data: { course } });
});

const deleteCourse = asyncHandler(async (req, res) => {
  await courseService.deleteCourse(req.params.courseId, req.user);
  return sendSuccess(res, { message: 'Course deleted.' });
});

module.exports = {
  createCourse,
  listCourses,
  getCourseById,
  updateCourse,
  deleteCourse,
};
