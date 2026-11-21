const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { assertStepUp } = require('../services/stepUp.service');
const { geminiKeyRotation } = require('../services/geminiKeyRotation.service');

// Responses describe the key source only; the key value is never echoed.
const noStore = (res) => res.set('Cache-Control', 'no-store');

const getGeminiKeyStatus = asyncHandler(async (req, res) => {
  noStore(res);
  return sendSuccess(res, { data: geminiKeyRotation.getStatus(req.user.id) });
});

const testGeminiKey = asyncHandler(async (req, res) => {
  noStore(res);
  assertStepUp(req);
  const result = await geminiKeyRotation.testCandidate({ adminId: req.user.id, apiKey: req.body?.apiKey });
  return sendSuccess(res, { message: 'Gemini key test passed.', data: result });
});

const activateGeminiKey = asyncHandler(async (req, res) => {
  noStore(res);
  assertStepUp(req);
  const result = await geminiKeyRotation.activateCandidate({
    adminId: req.user.id, apiKey: req.body?.apiKey, testId: req.body?.testId,
  });
  return sendSuccess(res, { message: 'Gemini key activated.', data: result });
});

module.exports = { getGeminiKeyStatus, testGeminiKey, activateGeminiKey };
