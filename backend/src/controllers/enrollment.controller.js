const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const enrollmentService = require('../services/enrollment.service');

// Controllers only translate HTTP input/output; authorization and enrollment
// lifecycle rules stay in enrollment.service for reuse and focused testing.

const listCourseEnrollments = asyncHandler(async (req, res) => {
  const enrollments = await enrollmentService.listCourseEnrollments({
    user: req.user,
    courseId: req.params.courseId,
  });
  return sendSuccess(res, { data: { enrollments } });
});

const assignStudent = asyncHandler(async (req, res) => {
  const enrollment = await enrollmentService.assignStudent({
    user: req.user,
    courseId: req.params.courseId,
    studentEmail: req.body.studentEmail,
  });
  return sendSuccess(res, { message: 'Student enrollment activated.', data: { enrollment } });
});

const revokeStudent = asyncHandler(async (req, res) => {
  const enrollment = await enrollmentService.revokeStudent({
    user: req.user,
    courseId: req.params.courseId,
    studentId: req.params.studentId,
  });
  return sendSuccess(res, { message: 'Student enrollment revoked.', data: { enrollment } });
});

module.exports = {
  listCourseEnrollments,
  assignStudent,
  revokeStudent,
};
