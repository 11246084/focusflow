const { createReadStream, statSync } = require('fs');
const path = require('path');
const AppError = require('../utils/appError');
const env = require('../config/env');

const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable';
const VALID_PRIVACY_STATUSES = new Set(['private', 'unlisted', 'public']);

function normalizePrivacyStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_PRIVACY_STATUSES.has(normalized) ? normalized : 'unlisted';
}

function buildYouTubeWatchUrl(youtubeVideoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}`;
}

function guessMimeType(filePath) {
  const extension = path.extname(filePath || '').toLowerCase();
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mkv') return 'video/x-matroska';
  return 'video/mp4';
}

function isAutoUploadEnabled() {
  return Boolean(env.youtubeAutoUploadEnabled);
}

function hasRefreshCredentials() {
  return Boolean(
    env.youtubeOAuthClientId
    && env.youtubeOAuthClientSecret
    && env.youtubeOAuthRefreshToken,
  );
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new AppError('Fetch is required for YouTube upload.', 500, 'YOUTUBE_UPLOAD_FAILED');
  }
}

function createYouTubeApiError(message, responseText) {
  const suffix = responseText ? ` ${responseText.slice(0, 300)}` : '';
  return new AppError(`${message}${suffix}`.trim(), 502, 'YOUTUBE_UPLOAD_FAILED');
}

async function fetchAccessToken({ fetchImpl = global.fetch } = {}) {
  if (env.youtubeUploadAccessToken) {
    return env.youtubeUploadAccessToken;
  }

  if (!hasRefreshCredentials()) {
    throw new AppError(
      'YouTube OAuth credentials are not configured.',
      503,
      'YOUTUBE_UPLOAD_NOT_CONFIGURED',
    );
  }

  assertFetch(fetchImpl);

  const body = new URLSearchParams({
    client_id: env.youtubeOAuthClientId,
    client_secret: env.youtubeOAuthClientSecret,
    refresh_token: env.youtubeOAuthRefreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetchImpl(YOUTUBE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw createYouTubeApiError('Failed to refresh YouTube OAuth token.', responseText);
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw createYouTubeApiError('YouTube OAuth token response did not include access_token.');
  }

  return payload.access_token;
}

async function uploadLocalVideo({
  filePath,
  title,
  description,
  mimeType,
  privacyStatus = env.youtubeUploadPrivacyStatus,
  fetchImpl = global.fetch,
} = {}) {
  if (!filePath) {
    throw new AppError('filePath is required for YouTube upload.', 400, 'VALIDATION_ERROR');
  }

  assertFetch(fetchImpl);

  const accessToken = await fetchAccessToken({ fetchImpl });
  const fileStats = statSync(filePath);
  const normalizedMimeType = mimeType || guessMimeType(filePath);
  const normalizedPrivacyStatus = normalizePrivacyStatus(privacyStatus);
  const metadata = {
    snippet: {
      title: String(title || path.basename(filePath)).trim(),
      description: String(description || '').trim(),
      categoryId: env.youtubeUploadCategoryId,
    },
    status: {
      privacyStatus: normalizedPrivacyStatus,
    },
  };

  const sessionResponse = await fetchImpl(YOUTUBE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': normalizedMimeType,
      'X-Upload-Content-Length': String(fileStats.size),
    },
    body: JSON.stringify(metadata),
  });

  if (!sessionResponse.ok) {
    const responseText = await sessionResponse.text().catch(() => '');
    throw createYouTubeApiError('Failed to create YouTube upload session.', responseText);
  }

  const uploadUrl = sessionResponse.headers?.get?.('location');
  if (!uploadUrl) {
    throw createYouTubeApiError('YouTube upload session did not return a Location header.');
  }

  const uploadResponse = await fetchImpl(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': normalizedMimeType,
      'Content-Length': String(fileStats.size),
    },
    body: createReadStream(filePath),
    duplex: 'half',
  });

  if (!uploadResponse.ok) {
    const responseText = await uploadResponse.text().catch(() => '');
    throw createYouTubeApiError('Failed to upload video to YouTube.', responseText);
  }

  const uploadPayload = await uploadResponse.json();
  if (!uploadPayload.id) {
    throw createYouTubeApiError('YouTube upload response did not include a video id.');
  }

  return {
    youtubeVideoId: uploadPayload.id,
    videoUrl: buildYouTubeWatchUrl(uploadPayload.id),
    privacyStatus: normalizedPrivacyStatus,
  };
}

module.exports = {
  YOUTUBE_TOKEN_URL,
  YOUTUBE_UPLOAD_URL,
  buildYouTubeWatchUrl,
  fetchAccessToken,
  guessMimeType,
  isAutoUploadEnabled,
  normalizePrivacyStatus,
  uploadLocalVideo,
};
