const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const youtubeAdminService = require('../services/youtubeAdmin.service');
const youtubeQuarantineService = require('../services/youtubeQuarantine.service');
const uploadAdminService = require('../services/youtubeUploadAdmin.service');

const { QUARANTINE_KINDS } = youtubeQuarantineService;

const getLifecycleSettings = asyncHandler(async (req, res) => {
  const settings = await youtubeAdminService.getLifecycleSettings();
  return sendSuccess(res, { data: settings });
});

const getUploadOverview = asyncHandler(async (req, res) => sendSuccess(res, { data: await uploadAdminService.getUploadOverview() }));
const probeUploads = asyncHandler(async (req, res) => sendSuccess(res, { data: await uploadAdminService.probeUploads({ user: req.user }) }));
const listPrivacyIncidents = asyncHandler(async (req, res) => sendSuccess(res, { data: await uploadAdminService.listPrivacyIncidents() }));
const restorePrivacy = asyncHandler(async (req, res) => sendSuccess(res, { data: await uploadAdminService.restorePrivacy({
  kind: req.params.kind, id: req.params.id, user: req.user,
}) }));
const getStorageOverview = asyncHandler(async (req, res) => sendSuccess(res, { data: await uploadAdminService.getStorageOverview() }));

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

function applyQuarantined(kind, paramName) {
  return asyncHandler(async (req, res) => {
    const result = await youtubeQuarantineService.applyQuarantinedItem({
      kind,
      id: req.params[paramName],
      youtubeVideoId: req.body?.youtubeVideoId,
    });
    return sendSuccess(res, { message: 'YouTube upload marked as completed.', data: result });
  });
}

function resetQuarantined(kind, paramName) {
  return asyncHandler(async (req, res) => {
    const result = await youtubeQuarantineService.resetQuarantinedItem({ kind, id: req.params[paramName] });
    return sendSuccess(res, { message: 'YouTube upload reset for retry.', data: result });
  });
}

const lookupQuarantinedVideo = lookupQuarantined(QUARANTINE_KINDS.VIDEO, 'videoId');
const lookupQuarantinedShortAsset = lookupQuarantined(QUARANTINE_KINDS.SHORT_ASSET, 'assetId');
const applyQuarantinedVideo = applyQuarantined(QUARANTINE_KINDS.VIDEO, 'videoId');
const applyQuarantinedShortAsset = applyQuarantined(QUARANTINE_KINDS.SHORT_ASSET, 'assetId');
const resetQuarantinedVideo = resetQuarantined(QUARANTINE_KINDS.VIDEO, 'videoId');
const resetQuarantinedShortAsset = resetQuarantined(QUARANTINE_KINDS.SHORT_ASSET, 'assetId');

module.exports = {
  getUploadOverview,
  probeUploads,
  listPrivacyIncidents,
  restorePrivacy,
  getStorageOverview,
  applyQuarantinedShortAsset,
  applyQuarantinedVideo,
  getCleanupPreview,
  getLifecycleSettings,
  listQuarantine,
  lookupQuarantinedShortAsset,
  lookupQuarantinedVideo,
  resetQuarantinedShortAsset,
  resetQuarantinedVideo,
  runRecoveryNow,
  updateLifecycleSwitch,
};
