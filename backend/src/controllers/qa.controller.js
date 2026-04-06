const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const qaService = require('../services/qa.service');

const askQuestion = asyncHandler(async (req, res) => {
  const { courseId, question } = req.body;

  if (!courseId || !question || !String(question).trim()) {
    throw new AppError('courseId and question are required.', 400, 'VALIDATION_ERROR');
  }

  const result = await qaService.askQuestion({
    user: req.user,
    courseId: String(courseId).trim(),
    question: String(question).trim(),
    source: 'api',
  });

  return sendSuccess(res, {
    message: 'Question answered successfully.',
    data: result,
  });
});

module.exports = {
  askQuestion,
};
