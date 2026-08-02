const { createReadStream, existsSync, statSync } = require('fs');
const path = require('path');
const env = require('../config/env');
const Video = require('../models/video.model');
const { YOUTUBE_UPLOAD_STATUSES } = require('../constants/enums');
const AppError = require('../utils/appError');

const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const VALID_PRIVACY_STATUSES = new Set(['private', 'unlisted', 'public']);
// videos.update 會覆寫整個 status part，未帶到的可寫欄位會被重設為預設值，
// 因此改隱私前要先讀回現有 status 並帶回這些欄位。
// 刻意不帶 publishAt：排程公開會讓影片稍後自動脫離 private。
const WRITABLE_STATUS_FIELDS = ['license', 'embeddable', 'publicStatsViewable', 'selfDeclaredMadeForKids'];
// videos.update（轉 private）接受的 scope。youtube.upload 不在其中，帶它只能上傳。
// 必須整段字串精確比對：`youtube.upload` 也包含 `auth/youtube` 子字串。
const PRIVACY_CAPABLE_SCOPES = new Set([
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtubepartner',
]);

// /health 用的觀察狀態。轉 private 是 best-effort、失敗只寫 log，沒有這層就沒有
// 任何集中可觀察的入口。只存最後一次結果，不累積歷史。
const credentialState = {
  lastTokenAttemptAt: null,
  lastTokenSuccessAt: null,
  lastTokenError: null,
  grantedScopes: [],
  lastPrivatizeAttemptAt: null,
  lastPrivatizeSuccessAt: null,
  lastPrivatizeError: null,
  lastPrivatizeVideoId: null,
};

function nowIso() {
  return new Date().toISOString();
}

function shortErrorMessage(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 300);
}

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

// 影片刪除時把自家頻道的影片轉 private。與上傳共用 OAuth 憑證，但獨立於
// YOUTUBE_UPLOAD_ENABLED：關掉自動上傳後，既有影片仍需要能被下架。
function isPrivatizeOnDeleteConfigured() {
  return Boolean(
    env.youtubePrivatizeOnDelete
    && (env.youtubeUploadAccessToken || hasRefreshCredentials()),
  );
}

// 只處理 FocusFlow 自己上傳到自家頻道的影片。教師貼 YouTube URL 建立的影片
// 位於他人頻道，既無權限也不應該去動它。
function isFocusFlowUploadedVideo(video) {
  return Boolean(
    video?.youtubeVideoId
    && video?.youtubeUpload?.status === YOUTUBE_UPLOAD_STATUSES.UPLOADED,
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

  credentialState.lastTokenAttemptAt = nowIso();

  try {
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

    // token response 會帶回實際授權的 scope，用來判斷這顆 token 能不能做轉 private。
    credentialState.grantedScopes = String(payload.scope || '').split(/\s+/).filter(Boolean);
    credentialState.lastTokenSuccessAt = nowIso();
    credentialState.lastTokenError = null;

    return payload.access_token;
  } catch (error) {
    credentialState.lastTokenError = shortErrorMessage(error);
    throw error;
  }
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

// 把頻道上的影片改成指定隱私狀態（預設 private）。需要 `youtube.force-ssl` scope；
// 只帶 upload scope 的 refresh token 會被 YouTube 以 403 拒絕。
async function setVideoPrivacy({
  youtubeVideoId,
  privacyStatus = 'private',
  fetchImpl = global.fetch,
} = {}) {
  if (!youtubeVideoId) {
    throw new AppError('youtubeVideoId is required to change privacy.', 400, 'VALIDATION_ERROR');
  }

  const targetPrivacy = String(privacyStatus || '').trim().toLowerCase();
  if (!VALID_PRIVACY_STATUSES.has(targetPrivacy)) {
    throw new AppError(`Unsupported privacy status: ${privacyStatus}`, 400, 'VALIDATION_ERROR');
  }

  assertFetch(fetchImpl);
  const accessToken = await fetchAccessToken({ fetchImpl });
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  const listUrl = `${YOUTUBE_VIDEOS_URL}?part=status&id=${encodeURIComponent(youtubeVideoId)}`;
  const listResponse = await fetchImpl(listUrl, { headers: authHeaders });
  if (!listResponse.ok) {
    const responseText = await listResponse.text().catch(() => '');
    throw createYouTubeApiError('Failed to read YouTube video status.', responseText);
  }

  const listPayload = await listResponse.json();
  const currentStatus = listPayload?.items?.[0]?.status;
  if (!currentStatus) {
    throw createYouTubeApiError(`YouTube video ${youtubeVideoId} was not found.`);
  }

  const nextStatus = { privacyStatus: targetPrivacy };
  for (const field of WRITABLE_STATUS_FIELDS) {
    if (currentStatus[field] !== undefined) nextStatus[field] = currentStatus[field];
  }

  const updateResponse = await fetchImpl(`${YOUTUBE_VIDEOS_URL}?part=status`, {
    method: 'PUT',
    headers: { ...authHeaders, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ id: youtubeVideoId, status: nextStatus }),
  });

  if (!updateResponse.ok) {
    const responseText = await updateResponse.text().catch(() => '');
    throw createYouTubeApiError('Failed to update YouTube video privacy.', responseText);
  }

  return { youtubeVideoId, privacyStatus: targetPrivacy };
}

// 刪除流程的 best-effort 入口：轉 private 失敗不會中斷刪除，但會把 youtubeVideoId
// 記進 log，方便之後人工到 YouTube Studio 處理。
async function privatizeVideoOnDelete(video, { fetchImpl = global.fetch } = {}) {
  if (!isPrivatizeOnDeleteConfigured() || !isFocusFlowUploadedVideo(video)) {
    return null;
  }

  credentialState.lastPrivatizeAttemptAt = nowIso();
  credentialState.lastPrivatizeVideoId = video.youtubeVideoId;

  try {
    const result = await setVideoPrivacy({ youtubeVideoId: video.youtubeVideoId, fetchImpl });
    credentialState.lastPrivatizeSuccessAt = nowIso();
    credentialState.lastPrivatizeError = null;
    return result;
  } catch (error) {
    credentialState.lastPrivatizeError = shortErrorMessage(error);
    if (process.env.NODE_ENV !== 'test') {
      console.error(
        `YouTube privacy update failed for youtubeVideoId=${video.youtubeVideoId}; `
        + 'the video is still visible to anyone holding the link.',
        error,
      );
    }
    return null;
  }
}

// 課程刪除會一次帶走多支影片；逐支處理避免瞬間打爆 API 配額。
async function privatizeVideosOnDelete(videos = [], { fetchImpl = global.fetch } = {}) {
  const results = [];
  for (const video of videos) {
    const result = await privatizeVideoOnDelete(video, { fetchImpl });
    if (result) results.push(result);
  }
  return results;
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

// 啟動時做一次 token 交換，讓 /health 從開機就有憑證狀態可看（不必等到第一次上傳）。
// 只換 access token，不呼叫 YouTube API，因此不消耗 YouTube 配額。
async function verifyYouTubeCredentials({ fetchImpl = global.fetch } = {}) {
  if (!isYouTubeUploadConfigured() && !isPrivatizeOnDeleteConfigured()) {
    return false;
  }

  try {
    await fetchAccessToken({ fetchImpl });
    return true;
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('YouTube credential check failed at startup.', error);
    }
    return false;
  }
}

function hasPrivacyCapableScope() {
  return credentialState.grantedScopes.some((scope) => PRIVACY_CAPABLE_SCOPES.has(scope));
}

function buildYouTubeUploadSnapshot() {
  const missingConfig = [];
  if (!env.youtubeClientId && !env.youtubeOAuthClientId) missingConfig.push('YOUTUBE_CLIENT_ID');
  if (!env.youtubeClientSecret && !env.youtubeOAuthClientSecret) missingConfig.push('YOUTUBE_CLIENT_SECRET');
  if (!env.youtubeRefreshToken && !env.youtubeOAuthRefreshToken) missingConfig.push('YOUTUBE_REFRESH_TOKEN');

  const usingAccessTokenOverride = Boolean(env.youtubeUploadAccessToken);
  const credentialsConfigured = usingAccessTokenOverride || hasRefreshCredentials();
  const uploadReady = isYouTubeUploadConfigured();
  const privatizeOnDeleteReady = isPrivatizeOnDeleteConfigured();
  const anyFeatureEnabled = Boolean(env.youtubeUploadEnabled || env.youtubePrivatizeOnDelete);

  const hardFailures = [];
  const warnings = [];

  if (anyFeatureEnabled && !credentialsConfigured) {
    hardFailures.push({
      code: 'YOUTUBE_CREDENTIALS_MISSING',
      message: 'YouTube features are enabled but OAuth credentials are incomplete; every call is silently skipped.',
    });
  }

  let credentialCheckStatus = 'unknown';
  if (credentialState.lastTokenError) {
    credentialCheckStatus = 'failed';
  } else if (credentialState.lastTokenSuccessAt) {
    credentialCheckStatus = 'ok';
  }

  if (credentialCheckStatus === 'failed') {
    warnings.push({
      code: 'YOUTUBE_TOKEN_EXCHANGE_FAILED',
      message: `Last OAuth token exchange failed: ${credentialState.lastTokenError}`,
    });
  }

  if (credentialsConfigured && credentialCheckStatus === 'unknown') {
    warnings.push({
      code: 'YOUTUBE_CREDENTIALS_UNVERIFIED',
      message: 'Credentials are configured but no token exchange has run yet in this process.',
    });
  }

  // 轉 private 用 upload-only token 會被 403 拒絕，且失敗只寫 log；先在這裡示警。
  const privatizeScopeSatisfied = credentialCheckStatus === 'ok' ? hasPrivacyCapableScope() : null;
  if (env.youtubePrivatizeOnDelete && privatizeScopeSatisfied === false) {
    warnings.push({
      code: 'YOUTUBE_PRIVACY_SCOPE_MISSING',
      message: 'Granted scope cannot call videos.update; deleting a video will not switch it to private.',
    });
  }

  if (credentialState.lastPrivatizeError) {
    warnings.push({
      code: 'YOUTUBE_PRIVATIZE_FAILED',
      message: `Last privacy update failed (${credentialState.lastPrivatizeVideoId}): ${credentialState.lastPrivatizeError}`,
    });
  }

  let readiness = 'ready';
  if (!anyFeatureEnabled) {
    readiness = 'not_enabled';
  } else if (hardFailures.length) {
    readiness = 'hard_fail';
  } else if (credentialCheckStatus === 'failed' || privatizeScopeSatisfied === false) {
    readiness = 'degraded';
  }

  return {
    uploadEnabled: Boolean(env.youtubeUploadEnabled),
    privatizeOnDeleteEnabled: Boolean(env.youtubePrivatizeOnDelete),
    credentialsConfigured,
    usingAccessTokenOverride,
    uploadReady,
    privatizeOnDeleteReady,
    privatizeScopeSatisfied,
    readiness,
    credentialCheck: {
      status: credentialCheckStatus,
      lastAttemptAt: credentialState.lastTokenAttemptAt,
      lastSuccessAt: credentialState.lastTokenSuccessAt,
      lastError: credentialState.lastTokenError,
      grantedScopes: [...credentialState.grantedScopes],
    },
    lastPrivatize: {
      youtubeVideoId: credentialState.lastPrivatizeVideoId,
      lastAttemptAt: credentialState.lastPrivatizeAttemptAt,
      lastSuccessAt: credentialState.lastPrivatizeSuccessAt,
      lastError: credentialState.lastPrivatizeError,
    },
    missingConfig,
    hardFailures,
    warnings,
  };
}

function resetYouTubeUploadState() {
  credentialState.lastTokenAttemptAt = null;
  credentialState.lastTokenSuccessAt = null;
  credentialState.lastTokenError = null;
  credentialState.grantedScopes = [];
  credentialState.lastPrivatizeAttemptAt = null;
  credentialState.lastPrivatizeSuccessAt = null;
  credentialState.lastPrivatizeError = null;
  credentialState.lastPrivatizeVideoId = null;
}

module.exports = {
  YOUTUBE_TOKEN_URL,
  YOUTUBE_UPLOAD_URL,
  YOUTUBE_VIDEOS_URL,
  autoUploadVideoToYouTube,
  buildYouTubeUploadSnapshot,
  buildYouTubeWatchUrl,
  fetchAccessToken,
  guessMimeType,
  isAutoUploadEnabled,
  isFocusFlowUploadedVideo,
  isPrivatizeOnDeleteConfigured,
  isYouTubeUploadConfigured,
  normalizePrivacyStatus,
  privatizeVideoOnDelete,
  privatizeVideosOnDelete,
  resetYouTubeUploadState,
  scheduleYouTubeAutoUpload,
  setVideoPrivacy,
  uploadLocalVideo,
  uploadVideoFileToYouTube,
  verifyYouTubeCredentials,
};
