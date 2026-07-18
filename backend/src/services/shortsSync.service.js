const env = require('../config/env');
const ShortAsset = require('../models/shortAsset.model');
const logger = require('../utils/logger');
const {
  SHORT_ASSET_STATUSES,
  YOUTUBE_AVAILABILITIES,
  YOUTUBE_PRIVACY_STATUSES,
} = require('../constants/enums');

const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAYS_MS = [1000, 2000, 4000];
const JITTER_MAX_MS = 250;

const state = {
  enabled: env.shortsSyncIntervalMs > 0,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  degraded: false,
};

let intervalHandle = null;
let clearIntervalHandle = clearInterval;
let inFlightPromise = null;

function sleepMs(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getHeader(response, name) {
  if (response?.headers?.get) return response.headers.get(name);
  const headers = response?.headers || {};
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function parseRetryAfterMs(value, nowMs) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

function extractYouTubeReason(body) {
  return body?.error?.errors?.[0]?.reason || body?.error?.status || null;
}

function createYouTubeSyncError(response, body) {
  const error = new Error(body?.error?.message || `YouTube API responded with ${response.status}.`);
  error.status = response.status;
  error.reason = extractYouTubeReason(body);
  error.retryAfter = getHeader(response, 'Retry-After');
  error.quotaExceeded = response.status === 403 && error.reason === 'quotaExceeded';
  return error;
}

function isRetryable(error) {
  return error?.status == null || error.status === 429 || error.status >= 500;
}

async function fetchVideoBatch(
  youtubeVideoIds,
  {
    fetchImpl = global.fetch,
    sleep = sleepMs,
    random = Math.random,
    now = () => new Date(),
  } = {},
) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable for Shorts sync.');

  const params = new URLSearchParams({
    part: 'status',
    id: youtubeVideoIds.join(','),
    key: env.youtubeApiKey,
  });
  const url = `${YOUTUBE_VIDEOS_URL}?${params.toString()}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      let body;
      try {
        body = await response.json();
      } catch (parseError) {
        if (response.ok) throw parseError;
        body = {};
      }
      if (response.ok) return body;

      const error = createYouTubeSyncError(response, body);
      if (!isRetryable(error) || attempt === MAX_RETRIES) throw error;

      const retryAfterMs = parseRetryAfterMs(error.retryAfter, now().getTime());
      const delayMs = retryAfterMs ?? (
        BASE_RETRY_DELAYS_MS[attempt] + Math.floor(random() * JITTER_MAX_MS)
      );
      await sleep(delayMs);
    } catch (error) {
      if (error?.status != null || !isRetryable(error) || attempt === MAX_RETRIES) throw error;
      const delayMs = BASE_RETRY_DELAYS_MS[attempt] + Math.floor(random() * JITTER_MAX_MS);
      await sleep(delayMs);
    }
  }

  throw new Error('YouTube Shorts sync retry limit exceeded.');
}

function splitIntoBatches(items, batchSize = BATCH_SIZE) {
  const batches = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

async function markBatchChecked(assets, checkedAt) {
  if (!assets.length) return;
  await ShortAsset.bulkWrite(assets.map((asset) => ({
    updateOne: {
      filter: { _id: asset._id },
      update: { $set: { lastCheckedAt: checkedAt } },
    },
  })), { ordered: false });
}

async function applySuccessfulBatch(assets, responseBody, checkedAt) {
  const returnedById = new Map((responseBody.items || []).map((item) => [item.id, item]));
  const operations = [];

  for (const asset of assets) {
    const returned = returnedById.get(asset.youtubeVideoId);
    const previousAvailability = asset.youtubeAvailability;
    let newAvailability;
    let privacyStatus;
    let reason = null;

    if (!returned) {
      newAvailability = YOUTUBE_AVAILABILITIES.UNAVAILABLE;
      privacyStatus = YOUTUBE_PRIVACY_STATUSES.UNKNOWN;
      reason = 'youtube_video_not_returned';
    } else {
      const rawPrivacyStatus = returned.status?.privacyStatus;
      if (rawPrivacyStatus === YOUTUBE_PRIVACY_STATUSES.PRIVATE) {
        newAvailability = YOUTUBE_AVAILABILITIES.UNAVAILABLE;
        privacyStatus = YOUTUBE_PRIVACY_STATUSES.PRIVATE;
        reason = 'private';
      } else if (
        rawPrivacyStatus === YOUTUBE_PRIVACY_STATUSES.PUBLIC
        || rawPrivacyStatus === YOUTUBE_PRIVACY_STATUSES.UNLISTED
      ) {
        newAvailability = YOUTUBE_AVAILABILITIES.PLAYABLE;
        privacyStatus = rawPrivacyStatus;
      } else {
        newAvailability = YOUTUBE_AVAILABILITIES.UNKNOWN;
        privacyStatus = YOUTUBE_PRIVACY_STATUSES.UNKNOWN;
      }
    }

    if (reason) {
      logger.warn('shorts_sync.unavailable', {
        assetId: String(asset._id),
        youtubeVideoId: asset.youtubeVideoId,
        reason,
        previousAvailability,
        newAvailability,
        timestamp: checkedAt.toISOString(),
      });
    }

    operations.push({
      updateOne: {
        filter: { _id: asset._id },
        update: {
          $set: {
            youtubeAvailability: newAvailability,
            youtubePrivacyStatus: privacyStatus,
            lastCheckedAt: checkedAt,
          },
        },
      },
    });
  }

  if (operations.length) await ShortAsset.bulkWrite(operations, { ordered: false });
}

function errorMessage(error) {
  if (!error) return 'Unknown Shorts sync error.';
  if (error.quotaExceeded) return 'YouTube quotaExceeded.';
  return error.message || String(error);
}

async function executeShortsSync({
  fetchImpl = global.fetch,
  sleep = sleepMs,
  random = Math.random,
  now = () => new Date(),
} = {}) {
  const attemptAt = now();
  state.enabled = env.shortsSyncIntervalMs > 0;
  state.lastAttemptAt = attemptAt.toISOString();
  state.lastError = null;
  state.degraded = false;

  const assets = await ShortAsset.find({
    status: { $ne: SHORT_ASSET_STATUSES.ARCHIVED },
    youtubeVideoId: { $exists: true, $nin: [null, ''] },
  }).select('_id youtubeVideoId youtubeAvailability').lean();

  if (!assets.length) {
    state.lastSuccessAt = now().toISOString();
    return { checked: 0, failedBatches: 0 };
  }

  if (!env.youtubeApiKey) {
    const checkedAt = now();
    await markBatchChecked(assets, checkedAt);
    state.lastError = 'YOUTUBE_API_KEY is not configured.';
    return { checked: assets.length, failedBatches: 1 };
  }

  let checked = 0;
  let failedBatches = 0;
  for (const batch of splitIntoBatches(assets)) {
    const checkedAt = now();
    try {
      const body = await fetchVideoBatch(
        batch.map((asset) => asset.youtubeVideoId),
        { fetchImpl, sleep, random, now },
      );
      await applySuccessfulBatch(batch, body, checkedAt);
    } catch (error) {
      await markBatchChecked(batch, checkedAt);
      failedBatches += 1;
      state.lastError = errorMessage(error);
      if (error.quotaExceeded) {
        state.degraded = true;
        checked += batch.length;
        break;
      }
    }
    checked += batch.length;
  }

  if (failedBatches === 0) {
    state.lastSuccessAt = now().toISOString();
    state.lastError = null;
  }

  return { checked, failedBatches };
}

function runShortsSync(options = {}) {
  if (inFlightPromise) return inFlightPromise;

  const execution = executeShortsSync(options);
  inFlightPromise = execution;
  const release = () => {
    if (inFlightPromise === execution) inFlightPromise = null;
  };
  execution.then(release, release);
  return execution;
}

function buildShortsSyncSnapshot() {
  return { ...state, enabled: env.shortsSyncIntervalMs > 0 };
}

function startShortsSyncScheduler(options = {}) {
  stopShortsSyncScheduler();
  const {
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    ...runOptions
  } = options;
  state.enabled = env.shortsSyncIntervalMs > 0;
  if (!state.enabled) return null;

  queueMicrotask(() => {
    runShortsSync(runOptions).catch((error) => {
      state.lastError = errorMessage(error);
    });
  });
  clearIntervalHandle = clearIntervalImpl;
  intervalHandle = setIntervalImpl(() => {
    runShortsSync(runOptions).catch((error) => {
      state.lastError = errorMessage(error);
    });
  }, env.shortsSyncIntervalMs);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
  return intervalHandle;
}

function stopShortsSyncScheduler() {
  if (intervalHandle) clearIntervalHandle(intervalHandle);
  intervalHandle = null;
  clearIntervalHandle = clearInterval;
}

function resetShortsSyncState() {
  state.enabled = env.shortsSyncIntervalMs > 0;
  state.lastAttemptAt = null;
  state.lastSuccessAt = null;
  state.lastError = null;
  state.degraded = false;
}

module.exports = {
  BASE_RETRY_DELAYS_MS,
  BATCH_SIZE,
  MAX_RETRIES,
  YOUTUBE_VIDEOS_URL,
  buildShortsSyncSnapshot,
  fetchVideoBatch,
  parseRetryAfterMs,
  resetShortsSyncState,
  runShortsSync,
  startShortsSyncScheduler,
  stopShortsSyncScheduler,
};
