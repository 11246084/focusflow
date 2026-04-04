const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const courseService = require('../services/course.service');

const createCourse = asyncHandler(async (req, res) => {
  const { title, description, status } = req.body;

  if (!title || !String(title).trim()) {
    throw new AppError('Course title is required.', 400, 'VALIDATION_ERROR');
  }

  const course = await courseService.createCourse({
    title: String(title).trim(),
    description: String(description || '').trim(),
    status: status ? String(status).trim() : undefined,
    teacherId: req.user.id,
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
  const courses = await courseService.listCourses();

  return sendSuccess(res, {
    message: 'Courses fetched successfully.',
    data: {
      courses,
    },
  });
});

const getCourseById = asyncHandler(async (req, res) => {
  const course = await courseService.getCourseById(req.params.courseId);

  return sendSuccess(res, {
    message: 'Course fetched successfully.',
    data: {
      course,
    },
  });
});

module.exports = {
  createCourse,
  listCourses,
  getCourseById,
};
