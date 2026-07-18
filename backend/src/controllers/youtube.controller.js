const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const shortAssetService = require('../services/shortAsset.service');

const getShorts = asyncHandler(async (req, res) => {
  const data = await shortAssetService.listStudentShorts({
    studentId: req.user.id,
    pageToken: req.query.pageToken,
    limit: req.query.limit,
  });

  return sendSuccess(res, { message: 'OK', data });
});

module.exports = { getShorts };
