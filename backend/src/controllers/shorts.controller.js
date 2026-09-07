const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const shortAssetService = require('../services/shortAsset.service');

const listReviewShortAssets = asyncHandler(async (req, res) => {
  const data = await shortAssetService.listReviewShortAssets({
    user: req.user,
    reviewStatus: req.query.reviewStatus,
    limit: req.query.limit,
  });

  return sendSuccess(res, { message: 'OK', data });
});

const getReviewShortAsset = asyncHandler(async (req, res) => {
  const data = await shortAssetService.getReviewShortAsset({
    assetId: req.params.shortAssetId,
    user: req.user,
  });

  return sendSuccess(res, { message: 'OK', data });
});

const reviewShortAsset = asyncHandler(async (req, res) => {
  const data = await shortAssetService.reviewShortAsset({
    assetId: req.params.shortAssetId,
    user: req.user,
    status: req.body?.status,
    expectedGenerationVersion: req.body?.expectedGenerationVersion,
    reasons: req.body?.reasons,
  });

  return sendSuccess(res, { message: 'Short asset review saved.', data });
});

module.exports = {
  getReviewShortAsset,
  listReviewShortAssets,
  reviewShortAsset,
};
