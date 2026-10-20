const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const youtubeAdminService = require('../services/youtubeAdmin.service');
const youtubeQuarantineService = require('../services/youtubeQuarantine.service');

const { QUARANTINE_KINDS } = youtubeQuarantineService;

const getLifecycleSettings = asyncHandler(async (req, res) => {
  const settings = await youtubeAdminService.getLifecycleSettings();
  return sendSuccess(res, { data: settings });
});

const updateLifecycleSwitch = asyncHandler(async (req, res) => {
  const { key, enabled } = req.body || {};
  const settings = await youtubeAdminService.updateLifecycleSwitch({ key, enabled, user: req.user });
  return sendSuccess(res, { message: 'YouTube lifecycle switch updated.', data: settings });
});

const getCleanupPreview = asyncHandler(async (req, res) => {
  const preview = await youtubeAdminService.getCleanupPreview({ scope: req.query.scope });
  return sendSuccess(res, { data: preview });
});

const runRecoveryNow = asyncHandler(async (req, res) => {
  const result = await youtubeAdminService.runRecoveryNow();
  return sendSuccess(res, { message: 'YouTube upload recovery finished.', data: result });
});

const listQuarantine = asyncHandler(async (req, res) => {
  const result = await youtubeQuarantineService.listQuarantinedItems();
  return sendSuccess(res, { data: result });
});

function lookupQuarantined(kind, paramName) {
  return asyncHandler(async (req, res) => {
    const result = await youtubeQuarantineService.lookupQuarantinedItem({ kind, id: req.params[paramName] });
    return sendSuccess(res, { data: result });
  });
}

const lookupQuarantinedVideo = lookupQuarantined(QUARANTINE_KINDS.VIDEO, 'videoId');
const lookupQuarantinedShortAsset = lookupQuarantined(QUARANTINE_KINDS.SHORT_ASSET, 'assetId');

module.exports = {
  getCleanupPreview,
  getLifecycleSettings,
  listQuarantine,
  lookupQuarantinedShortAsset,
  lookupQuarantinedVideo,
  runRecoveryNow,
  updateLifecycleSwitch,
};
