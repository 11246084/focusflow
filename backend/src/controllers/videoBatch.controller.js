const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const videoBatchService = require('../services/videoBatch.service');

// The durable batch record is the API contract returned to the upload UI; the
// controller deliberately does not expose Pipeline process details.

const createVideoBatch = asyncHandler(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const batch = await videoBatchService.createVideoBatch({
    courseId: req.params.courseId,
    files,
    titles: req.videoBatchTitles || [],
    user: req.user,
  });
  return sendSuccess(res, { statusCode: 201, message: 'Video batch created.', data: { batch } });
});

const getVideoBatch = asyncHandler(async (req, res) => {
  const batch = await videoBatchService.getVideoBatch(req.params.batchId, req.user);
  return sendSuccess(res, { message: 'Video batch fetched.', data: { batch } });
});

const listCourseVideoBatches = asyncHandler(async (req, res) => {
  const batches = await videoBatchService.listCourseVideoBatches(req.params.courseId, req.user);
  return sendSuccess(res, { message: 'Video batches fetched.', data: { batches } });
});

const retryVideoBatchItem = asyncHandler(async (req, res) => {
  const videoId = String(req.body?.videoId || '').trim();
  if (!videoId) throw new AppError('videoId is required.', 400, 'VALIDATION_ERROR');
  const batch = await videoBatchService.retryVideoBatchItem(req.params.batchId, videoId, req.user);
  return sendSuccess(res, { message: 'Video batch item retried.', data: { batch } });
});

module.exports = { createVideoBatch, getVideoBatch, listCourseVideoBatches, retryVideoBatchItem };
