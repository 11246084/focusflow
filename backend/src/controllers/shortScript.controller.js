const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const shortScriptService = require('../services/shortScript.service');
const shortAssetPublishService = require('../services/shortAssetPublish.service');
const { listTopicCandidates } = require('../services/shortScriptTopic.service');

const createScript = asyncHandler(async (req, res) => {
  const script = await shortScriptService.createScriptWithFrozenEvidence({
    user: req.user,
    courseId: req.params.courseId,
    // 教師可指定主題；不給就照 DR-12 的排序自動選。
    topicKey: String(req.body?.topicKey || '').trim() || null,
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

// 教師依腳本產出影片後上傳（施工單 WO-08）。
// 只建立 draft，**不上架**——上架的閘門是成品審核（規格書 R-08）。
const uploadAsset = asyncHandler(async (req, res) => {
  const asset = await shortAssetPublishService.createAssetFromScript({
    user: req.user,
    scriptId: req.params.scriptId,
    file: req.file,
    title: req.body?.title,
    description: req.body?.description,
    versionNo: req.body?.versionNo,
    aiDisclosureConfirmed: req.body?.aiDisclosureConfirmed,
    consentConfirmed: req.body?.consentConfirmed,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Short asset created. It will be published after review approval.',
    data: shortAssetPublishService.toTeacherAsset(asset),
  });
});

const retryAssetUpload = asyncHandler(async (req, res) => {
  const asset = await shortAssetPublishService.retryShortAssetUpload({
    user: req.user,
    assetId: req.params.assetId,
  });

  return sendSuccess(res, {
    message: 'Short asset published.',
    data: shortAssetPublishService.toTeacherAsset(asset),
  });
});

const listAssets = asyncHandler(async (req, res) => {
  const assets = await shortAssetPublishService.listCourseShortAssets({
    user: req.user,
    courseId: req.params.courseId,
  });

  return sendSuccess(res, { data: assets, meta: { total: assets.length } });
});

module.exports = {
  listAssets,
  retryAssetUpload,
  uploadAsset,
  createScript,
  generateVersion,
  reviewScript,
  getScript,
  listScripts,
  listCandidates,
};
