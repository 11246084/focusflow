const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const adminService = require('../services/admin.service');
const systemStatusService = require('../services/systemStatus.service');
const feedbackService = require('../services/feedback.service');

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

const getSystemStatus = asyncHandler(async (req, res) => {
  const status = systemStatusService.getSystemStatus();
  return sendSuccess(res, { data: status });
});

const listFeedback = asyncHandler(async (req, res) => {
  const { status, category, severity, page, limit } = req.query;
  const result = await feedbackService.listFeedback({ status, category, severity, page, limit });
  return sendSuccess(res, { data: { feedback: result.items }, meta: result.meta });
});

const updateFeedback = asyncHandler(async (req, res) => {
  const { feedbackId } = req.params;
  const { status, adminNote } = req.body || {};
  const feedback = await feedbackService.updateFeedbackStatus({ feedbackId, status, adminNote });
  return sendSuccess(res, { message: 'Feedback updated.', data: feedback });
});

module.exports = {
  getStats,
  listUsers,
  updateUser,
  listVideos,
  getRecentEvents,
  getEventStats,
  deleteVideo,
  getSystemStatus,
  listFeedback,
  updateFeedback,
};
