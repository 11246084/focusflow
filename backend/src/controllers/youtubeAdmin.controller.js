const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const youtubeAdminService = require('../services/youtubeAdmin.service');

const getLifecycleSettings = asyncHandler(async (req, res) => {
  const settings = await youtubeAdminService.getLifecycleSettings();
  return sendSuccess(res, { data: settings });
});

const updateLifecycleSwitch = asyncHandler(async (req, res) => {
  const { key, enabled } = req.body || {};
  const settings = await youtubeAdminService.updateLifecycleSwitch({ key, enabled, user: req.user });
  return sendSuccess(res, { message: 'YouTube lifecycle switch updated.', data: settings });
});

module.exports = {
  getLifecycleSettings,
  updateLifecycleSwitch,
};
