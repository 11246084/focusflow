const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const AppError = require('../utils/appError');
const service = require('../services/recutReview.service');
const base = ['versionId', 'expectedRevision'];
function mutation(name, keys, statusCode = 200) {
  return asyncHandler(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !keys.includes(k))) {
      throw new AppError('Unexpected recut review fields.', 400, 'VALIDATION_ERROR');
    }
    return sendSuccess(res, { statusCode, data: await service[name]({ ...body, user: req.user, scriptId: req.params.scriptId }) });
  });
}
module.exports = {
  getReview: asyncHandler(async (req, res) => sendSuccess(res, { data: await service.getReview({ user: req.user, scriptId: req.params.scriptId }) })),
  editSelection: mutation('editSelection', [...base, 'changes']), restoreSelection: mutation('restoreSelection', base),
  applySelection: mutation('applySelection', base, 202),
  applySuggestions: mutation('applySuggestions', [...base, 'suggestionIds', 'confirmedSelectionChangeIds', 'reasonLabel'], 202),
  approveScript: mutation('approveScript', base), queueRender: mutation('queueRender', base),
  approveAsset: mutation('approveAsset', [...base, 'assetId', 'generationVersion']),
  recordTime: mutation('recordTime', [...base, 'action', 'phase', 'timingId']),
};
