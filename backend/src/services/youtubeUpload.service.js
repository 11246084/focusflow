const { createReadStream, existsSync, statSync } = require('fs');
const path = require('path');
const env = require('../config/env');
const Video = require('../models/video.model');
const { YOUTUBE_UPLOAD_STATUSES } = require('../constants/enums');
const AppError = require('../utils/appError');

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

function getOAuthCredentials() {
  return {
    clientId: env.youtubeClientId || env.youtubeOAuthClientId || '',
    clientSecret: env.youtubeClientSecret || env.youtubeOAuthClientSecret || '',
    refreshToken: env.youtubeRefreshToken || env.youtubeOAuthRefreshToken || '',
  };
}

function hasRefreshCredentials() {
  const credentials = getOAuthCredentials();
  return Boolean(credentials.clientId && credentials.clientSecret && credentials.refreshToken);
}

function isYouTubeUploadConfigured() {
  return Boolean(
    env.youtubeUploadEnabled
    && (env.youtubeUploadAccessToken || hasRefreshCredentials()),
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
  const credentials = getOAuthCredentials();
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetchImpl(YOUTUBE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw createYouTubeApiError('YouTube OAuth token refresh failed.', responseText);
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw createYouTubeApiError('YouTube OAuth token response did not include an access token.');
  }

  return payload.access_token;
}

async function uploadLocalVideo({
  filePath,
  title,
  description,
  mimeType,
  privacyStatus = env.youtubeUploadPrivacy || env.youtubeUploadPrivacyStatus,
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
      title: String(title || path.basename(filePath)).trim().slice(0, 100),
      description: String(description || '').trim(),
      categoryId: env.youtubeUploadCategoryId || '27',
    },
    status: {
      privacyStatus: normalizedPrivacyStatus,
      selfDeclaredMadeForKids: false,
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

async function uploadVideoFileToYouTube({ filePath, title, description = '' }, fetchImpl = global.fetch) {
  const result = await uploadLocalVideo({ filePath, title, description, fetchImpl });
  return result.youtubeVideoId;
}

async function autoUploadVideoToYouTube(videoId, { fetchImpl = global.fetch } = {}) {
  const video = await Video.findById(videoId);

  if (!video || video.youtubeVideoId) {
    return null;
  }

  const filePath = video.filePath;
  if (!filePath || !existsSync(filePath)) {
    await Video.findByIdAndUpdate(videoId, {
      $set: {
        youtubeUpload: {
          status: YOUTUBE_UPLOAD_STATUSES.FAILED,
          error: 'Local video file is missing; cannot upload to YouTube.',
          uploadedAt: null,
        },
      },
    });
    return null;
  }

  await Video.findByIdAndUpdate(videoId, {
    $set: {
      youtubeUpload: { status: YOUTUBE_UPLOAD_STATUSES.UPLOADING, error: null, uploadedAt: null },
    },
  });

  try {
    const uploadResult = await uploadLocalVideo({
      filePath,
      title: video.title,
      description: `Uploaded by FocusFlow (video ${videoId}).`,
      fetchImpl,
    });

    await Video.findByIdAndUpdate(videoId, {
      $set: {
        youtubeVideoId: uploadResult.youtubeVideoId,
        videoUrl: uploadResult.videoUrl,
        youtubeUpload: {
          status: YOUTUBE_UPLOAD_STATUSES.UPLOADED,
          error: null,
          uploadedAt: new Date(),
        },
      },
    });

    return uploadResult.youtubeVideoId;
  } catch (error) {
    await Video.findByIdAndUpdate(videoId, {
      $set: {
        youtubeUpload: {
          status: YOUTUBE_UPLOAD_STATUSES.FAILED,
          error: String(error.message || error).slice(0, 500),
          uploadedAt: null,
        },
      },
    });

    if (process.env.NODE_ENV !== 'test') {
      console.error(`YouTube auto upload failed for video ${videoId}.`, error);
    }

    return null;
  }
}

// 上傳流程的 fire-and-forget 入口：未設定憑證時靜默略過，不影響本地上傳與 STT pipeline。
function scheduleYouTubeAutoUpload(video) {
  if (!isYouTubeUploadConfigured()) {
    return null;
  }

  return autoUploadVideoToYouTube(String(video._id)).catch((error) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`YouTube auto upload scheduling failed for video ${video._id}.`, error);
    }
    return null;
  });
}

module.exports = {
  YOUTUBE_TOKEN_URL,
  YOUTUBE_UPLOAD_URL,
  autoUploadVideoToYouTube,
  buildYouTubeWatchUrl,
  fetchAccessToken,
  guessMimeType,
  isAutoUploadEnabled,
  isYouTubeUploadConfigured,
  normalizePrivacyStatus,
  scheduleYouTubeAutoUpload,
  uploadLocalVideo,
  uploadVideoFileToYouTube,
};
