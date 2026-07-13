const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const AppError = require('../utils/appError');
const env = require('../config/env');
const youtubeService = require('../services/youtube.service');

const getShorts = asyncHandler(async (req, res) => {
  if (!env.youtubeApiKey) {
    throw new AppError('YouTube API key not configured on this server.', 503, 'YOUTUBE_NOT_CONFIGURED');
  }

  const { pageToken = '' } = req.query;

  let data;
  try {
    data = await youtubeService.getShorts(pageToken);
  } catch (err) {
    const status = err.youtubeStatus >= 400 && err.youtubeStatus < 600 ? err.youtubeStatus : 502;
    throw new AppError(err.message || 'YouTube API request failed.', status, 'YOUTUBE_API_ERROR');
  }

  return sendSuccess(res, { message: 'OK', data });
});

module.exports = { getShorts };
