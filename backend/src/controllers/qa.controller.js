const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const qaService = require('../services/qa.service');
const { isLikelyEncodingDamaged } = require('../utils/textEncoding');

const askQuestion = asyncHandler(async (req, res) => {
  const { courseId, question } = req.body;

  if (!courseId || !question || !String(question).trim()) {
    throw new AppError('courseId and question are required.', 400, 'VALIDATION_ERROR');
  }

  const trimmedQuestion = String(question).trim();
  if (isLikelyEncodingDamaged(trimmedQuestion)) {
    throw new AppError(
      'Question appears to be encoded incorrectly (possible ASCII fallback for UTF-8). Send the request body as UTF-8.',
      400,
      'INVALID_ENCODING',
    );
  }

  const result = await qaService.askQuestion({
    user: req.user,
    courseId: String(courseId).trim(),
    question: trimmedQuestion,
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
