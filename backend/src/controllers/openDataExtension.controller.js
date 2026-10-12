const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const openDataExtensionService = require('../services/openDataExtension.service');

const getExtendedResources = asyncHandler(async (req, res) => {
  const { courseId, question } = req.body;
  const trimmedQuestion = String(question || '').trim();

  if (!courseId || !trimmedQuestion) {
    throw new AppError('courseId and question are required.', 400, 'VALIDATION_ERROR');
  }

  const result = await openDataExtensionService.getExtendedResources({
    user: req.user,
    courseId: String(courseId).trim(),
    question: trimmedQuestion,
  });

  return sendSuccess(res, {
    message: 'Extended resources loaded.',
    data: result,
  });
});

module.exports = {
  getExtendedResources,
};
