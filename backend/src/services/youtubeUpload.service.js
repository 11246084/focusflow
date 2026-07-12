const { createReadStream, existsSync, statSync } = require('fs');
const { Readable } = require('stream');
const env = require('../config/env');
const Video = require('../models/video.model');
const { YOUTUBE_UPLOAD_STATUSES } = require('../constants/enums');

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RESUMABLE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const ALLOWED_PRIVACY_STATUSES = new Set(['public', 'unlisted', 'private']);

function isYouTubeUploadConfigured() {
  return Boolean(
    env.youtubeUploadEnabled
    && env.youtubeClientId
    && env.youtubeClientSecret
    && env.youtubeRefreshToken,
  );
}

function resolvePrivacyStatus() {
  return ALLOWED_PRIVACY_STATUSES.has(env.youtubeUploadPrivacy)
    ? env.youtubeUploadPrivacy
    : 'unlisted';
}

async function fetchAccessToken(fetchImpl) {
  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.youtubeClientId,
      client_secret: env.youtubeClientSecret,
      refresh_token: env.youtubeRefreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`YouTube OAuth token refresh failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error('YouTube OAuth token response did not include an access token.');
  }

  return payload.access_token;
}

async function uploadVideoFileToYouTube({ filePath, title, description = '' }, fetchImpl = fetch) {
  const accessToken = await fetchAccessToken(fetchImpl);
  const fileSize = statSync(filePath).size;

  const initResponse = await fetchImpl(RESUMABLE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(fileSize),
      'X-Upload-Content-Type': 'video/*',
    },
    body: JSON.stringify({
      snippet: {
        // YouTube 標題上限 100 字元，超過會被 API 拒絕。
        title: String(title || 'FocusFlow Video').slice(0, 100),
        description,
        categoryId: '27', // Education
      },
      status: {
        privacyStatus: resolvePrivacyStatus(),
        selfDeclaredMadeForKids: false,
      },
    }),
  });

  if (!initResponse.ok) {
    throw new Error(`YouTube resumable session init failed (${initResponse.status}): ${await initResponse.text()}`);
  }

  const uploadUrl = initResponse.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube resumable session did not return an upload URL.');
  }

  const uploadResponse = await fetchImpl(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': 'video/*',
    },
    body: Readable.toWeb(createReadStream(filePath)),
    duplex: 'half',
  });

  if (!uploadResponse.ok) {
    throw new Error(`YouTube video upload failed (${uploadResponse.status}): ${await uploadResponse.text()}`);
  }

  const payload = await uploadResponse.json();
  if (!payload.id) {
    throw new Error('YouTube upload response did not include a video id.');
  }

  return payload.id;
}

async function autoUploadVideoToYouTube(videoId, { fetchImpl = fetch } = {}) {
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
    const youtubeVideoId = await uploadVideoFileToYouTube(
      { filePath, title: video.title, description: `Uploaded by FocusFlow (video ${videoId}).` },
      fetchImpl,
    );

    await Video.findByIdAndUpdate(videoId, {
      $set: {
        youtubeVideoId,
        videoUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
        youtubeUpload: {
          status: YOUTUBE_UPLOAD_STATUSES.UPLOADED,
          error: null,
          uploadedAt: new Date(),
        },
      },
    });

    return youtubeVideoId;
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
  isYouTubeUploadConfigured,
  uploadVideoFileToYouTube,
  autoUploadVideoToYouTube,
  scheduleYouTubeAutoUpload,
};
