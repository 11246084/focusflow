const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const adminService = require('../services/admin.service');

const getStats = asyncHandler(async (req, res) => {
  const stats = await adminService.getStats();
  return sendSuccess(res, { data: stats });
});

const listUsers = asyncHandler(async (req, res) => {
  const users = await adminService.listUsers();
  return sendSuccess(res, { data: { users } });
});

const updateUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { name, role, isActive } = req.body;
  const user = await adminService.updateUser(userId, { name, role, isActive });
  return sendSuccess(res, { message: 'User updated.', data: user });
});

const listVideos = asyncHandler(async (req, res) => {
  const videos = await adminService.listVideos();
  return sendSuccess(res, { data: { videos } });
});

const getRecentEvents = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const events = await adminService.getRecentEvents(limit);
  return sendSuccess(res, { data: { events } });
});

const getEventStats = asyncHandler(async (req, res) => {
  const stats = await adminService.getEventStats();
  return sendSuccess(res, { data: stats });
});

const deleteVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const result = await adminService.deleteVideo(videoId);
  return sendSuccess(res, { message: 'Video deleted.', data: result });
});

module.exports = { getStats, listUsers, updateUser, listVideos, getRecentEvents, getEventStats, deleteVideo };
