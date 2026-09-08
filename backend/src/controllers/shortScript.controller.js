const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const shortScriptService = require('../services/shortScript.service');
const { listTopicCandidates } = require('../services/shortScriptTopic.service');

const createScript = asyncHandler(async (req, res) => {
  const script = await shortScriptService.createScriptWithFrozenEvidence({
    user: req.user,
    courseId: req.params.courseId,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Short script created.',
    data: script,
  });
});

const generateVersion = asyncHandler(async (req, res) => {
  const script = await shortScriptService.generateScriptVersion({
    user: req.user,
    scriptId: req.params.scriptId,
  });

  return sendSuccess(res, { message: 'Short script generated.', data: script });
});

const reviewScript = asyncHandler(async (req, res) => {
  const decision = String(req.body.decision || '').trim();
  if (!decision) {
    throw new AppError('decision is required.', 400, 'VALIDATION_ERROR');
  }

  const script = await shortScriptService.submitReview({
    user: req.user,
    scriptId: req.params.scriptId,
    decision,
    feedback: req.body.feedback,
    feedbackType: req.body.feedbackType,
  });

  return sendSuccess(res, { message: 'Short script reviewed.', data: script });
});

const getScript = asyncHandler(async (req, res) => {
  const script = await shortScriptService.getScriptById({
    user: req.user,
    scriptId: req.params.scriptId,
  });

  return sendSuccess(res, { data: script });
});

const listScripts = asyncHandler(async (req, res) => {
  const scripts = await shortScriptService.listCourseScripts({
    user: req.user,
    courseId: req.params.courseId,
  });

  return sendSuccess(res, { data: scripts, meta: { total: scripts.length } });
});

// 唯讀的候選預覽。自動選題不需要它，但教師想知道「系統下一支會做什麼」時，
// 這條路徑可以在不建立腳本、不消耗 LLM 的情況下先看。
const listCandidates = asyncHandler(async (req, res) => {
  const result = await listTopicCandidates({
    user: req.user,
    courseId: req.params.courseId,
  });

  return sendSuccess(res, {
    data: result.candidates,
    meta: {
      totalClusters: result.totalClusters,
      similarityThreshold: result.similarityThreshold,
      usableQuestionCount: result.usableQuestionCount,
    },
  });
});

module.exports = {
  createScript,
  generateVersion,
  reviewScript,
  getScript,
  listScripts,
  listCandidates,
};
