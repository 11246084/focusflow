const { randomUUID } = require('node:crypto');
const RuntimeSetting = require('../models/runtimeSetting.model');
const AppError = require('../utils/appError');

const PAUSE_KEY = 'youtube_upload_pause';
const GATE_KEY = 'youtube_upload_gate';
const GATE_LEASE_MS = 120_000;
const literal = (value) => ({ $literal: value });

function nextPacificReset(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1));
  // Search the UTC interval containing the next local midnight. This also handles DST transitions.
  for (let hour = 7; hour <= 8; hour += 1) {
    const candidate = new Date(date.getTime() + hour * 3_600_000);
    const localHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(candidate);
    if (localHour === '00') return new Date(candidate.getTime() + 600_000);
  }
  throw new Error('Cannot determine Pacific midnight.');
}

function classifyUploadSessionError(status, body, retryAfter, now = new Date()) {
  let payload;
  try { payload = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { type: 'unknown', retryAt: null }; }
  const reasons = (payload?.error?.errors || []).map((error) => error.reason);
  const message = String(payload?.error?.message || '');
  if ((status === 403 && reasons.includes('quotaExceeded')) || (status === 429 && /Video Uploads per day/i.test(message))) return { type: 'api_daily', retryAt: nextPacificReset(now) };
  if (status === 400 && reasons.includes('uploadLimitExceeded')) return { type: 'channel_limit', retryAt: new Date(now.getTime() + 86_400_000 + 600_000) };
  if (status === 429) {
    const seconds = Number(retryAfter);
    const timestamp = retryAfter && !Number.isFinite(seconds) ? Date.parse(retryAfter) : now.getTime() + (Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 60_000);
    return { type: 'rate_limit', retryAt: new Date(Math.max(timestamp || now.getTime() + 60_000, now.getTime())) };
  }
  return { type: 'unknown', retryAt: null };
}

async function ensureSetting(key, value) {
  try { await RuntimeSetting.findOneAndUpdate({ key }, { $setOnInsert: { value } }, { upsert: true, new: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
}

async function getUploadPauseSnapshot({ now = new Date() } = {}) {
  const document = await RuntimeSetting.findOne({ key: PAUSE_KEY }).lean();
  const value = document?.value || {};
  const active = [value.apiQuota, value.channelLimit].filter((pause) => pause?.until && new Date(pause.until) > now);
  return { apiQuota: value.apiQuota || null, channelLimit: value.channelLimit || null,
    paused: active.length > 0, earliestRetryAt: active.length ? new Date(Math.max(...active.map((pause) => new Date(pause.until).getTime()))) : null,
    consecutiveBlockedRounds: Number(value.consecutiveBlockedRounds || 0), lastPauseSuccessCount: Number(value.lastPauseSuccessCount || 0),
    probe: value.probe || null, log: value.log || [] };
}

async function getUploadGateSnapshot() {
  const doc = await RuntimeSetting.findOne({ key: GATE_KEY }).lean();
  return { held: Boolean(doc?.value?.ownerToken && new Date(doc.value.leaseUntil) > new Date()), leaseUntil: doc?.value?.leaseUntil || null };
}

async function acquireUploadGate() {
  await ensureSetting(GATE_KEY, { ownerToken: null, leaseUntil: null });
  const ownerToken = randomUUID();
  const owner = { key: GATE_KEY, 'value.ownerToken': ownerToken };
  const acquired = await RuntimeSetting.findOneAndUpdate({ key: GATE_KEY,
    $or: [{ 'value.ownerToken': null }, { $expr: { $lte: ['$value.leaseUntil', '$$NOW'] } }] },
  [{ $set: { 'value.ownerToken': literal(ownerToken), 'value.leaseUntil': { $add: ['$$NOW', GATE_LEASE_MS] } } }], { new: true });
  if (!acquired) return null;
  return { ownerToken,
    async renew() {
      const doc = await RuntimeSetting.findOneAndUpdate({ ...owner, $expr: { $gt: ['$value.leaseUntil', '$$NOW'] } },
        [{ $set: { 'value.leaseUntil': { $add: ['$$NOW', GATE_LEASE_MS] } } }], { new: true });
      if (!doc) throw new Error('YouTube upload gate lease lost.');
      return true;
    },
    async release() { return RuntimeSetting.findOneAndUpdate(owner, { $set: { 'value.ownerToken': null, 'value.leaseUntil': null } }); },
  };
}

async function waitForUploadGate({ signal, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxWaitMs = 30_000 } = {}) {
  const startedAt = performance.now();
  let waitedMs = 0;
  while (true) {
    signal?.throwIfAborted();
    const lease = await acquireUploadGate();
    if (lease) return lease;
    if (Math.max(waitedMs, performance.now() - startedAt) >= maxWaitMs) return null;
    const delay = Math.min(500, maxWaitMs - waitedMs);
    await sleep(delay); waitedMs += delay;
  }
}

function quotaWaitingError(snapshot) {
  const error = new AppError('YouTube upload is waiting for capacity.', 409, 'YOUTUBE_UPLOAD_QUOTA_WAITING');
  error.publicDetails = { earliestRetryAt: snapshot.earliestRetryAt || snapshot.nextRetryAt || (snapshot.probe ? new Date(Date.now() + 60_000) : null) };
  error.youtubeWaitReason = snapshot.waitReason || (snapshot.probe ? 'gate_busy' : snapshot.channelLimit && new Date(snapshot.channelLimit.until) > new Date() ? 'channel_limit' : 'api_quota');
  error.youtubeNextRetryAt = error.publicDetails.earliestRetryAt;
  error.youtubeRetrySafe = true;
  return error;
}

async function assertUploadNotPaused({ now = new Date(), probe = false } = {}) {
  let snapshot;
  try { snapshot = await getUploadPauseSnapshot({ now }); }
  catch (error) { error.youtubeInfrastructure = true; throw error; }
  if (probe && typeof probe === 'object' && (String(snapshot.probe?.startedAt) !== String(probe.startedAt)
    || String(snapshot.probe?.by) !== String(probe.by))) {
    throw new AppError('Upload probe ownership changed.', 409, 'YOUTUBE_UPLOAD_PROBE_RUNNING');
  }
  if (!probe && snapshot.probe) throw quotaWaitingError({ waitReason: 'gate_busy', nextRetryAt: new Date(now.getTime() + 30_000) });
  if (!probe && snapshot.paused) throw quotaWaitingError(snapshot);
  return snapshot;
}

async function recordUploadPause(classification, { now = new Date() } = {}) {
  const field = classification.type === 'api_daily' ? 'apiQuota' : 'channelLimit';
  const previous = await getUploadPauseSnapshot({ now });
  const since = previous[field]?.until && new Date(previous[field].until) > now ? new Date(previous[field].since) : now;
  const Video = require('../models/video.model');
  const ShortAsset = require('../models/shortAsset.model');
  const query = { 'youtubeUpload.status': 'uploaded', 'youtubeUpload.uploadedAt': { $gte: new Date(now.getTime() - 86_400_000) } };
  const lastPauseSuccessCount = await Video.countDocuments(query) + await ShortAsset.countDocuments(query);
  await ensureSetting(PAUSE_KEY, {});
  const doc = await RuntimeSetting.findOneAndUpdate({ key: PAUSE_KEY }, {
    $set: { [`value.${field}`]: { since, until: classification.retryAt }, 'value.lastPauseSuccessCount': lastPauseSuccessCount },
    $inc: { 'value.consecutiveBlockedRounds': 1 },
    $push: { 'value.log': { $each: [{ type: classification.type, since, until: classification.retryAt }], $slice: -50 } },
  }, { new: true });
  const { notifyYouTubeUploadPaused, notifyYouTubeUploadBlockedRounds } = require('./notification.service');
  await notifyYouTubeUploadPaused({ type: classification.type, since, until: classification.retryAt });
  if (doc.value.consecutiveBlockedRounds === 3) {
    const first = doc.value.log?.[Math.max(0, doc.value.log.length - doc.value.consecutiveBlockedRounds)]?.since || since;
    await notifyYouTubeUploadBlockedRounds({ since: first });
  }
  return getUploadPauseSnapshot({ now });
}

async function recordUploadSuccess({ probe = false } = {}) {
  await RuntimeSetting.findOneAndUpdate({ key: PAUSE_KEY }, { $set: {
    'value.consecutiveBlockedRounds': 0, ...(probe ? { 'value.apiQuota': null, 'value.channelLimit': null } : {}),
  } });
}

async function runUploadProbe({ actor, fetchImpl = global.fetch, now = new Date() } = {}) {
  await ensureSetting(PAUSE_KEY, {});
  const prior = await getUploadPauseSnapshot({ now });
  if (prior.probe && new Date(prior.probe.startedAt) < new Date(now.getTime() - 900_000)) {
    const Video = require('../models/video.model');
    const ShortAsset = require('../models/shortAsset.model');
    const activeQuery = { 'youtubeUpload.status': 'uploading', $expr: { $gt: ['$youtubeUpload.heartbeatAt', { $subtract: ['$$NOW', 120_000] }] } };
    const active = await Video.countDocuments(activeQuery) + await ShortAsset.countDocuments(activeQuery);
    const gate = await getUploadGateSnapshot();
    if (!active && !gate.held) await RuntimeSetting.findOneAndUpdate({ key: PAUSE_KEY, 'value.probe.startedAt': prior.probe.startedAt }, { $set: { 'value.probe': null } });
  }
  const marker = { startedAt: now, by: actor?.id || actor?._id || actor || null };
  const claimed = await RuntimeSetting.findOneAndUpdate({ key: PAUSE_KEY, 'value.probe': null }, { $set: { 'value.probe': marker } }, { new: true });
  if (!claimed) throw new AppError('An upload probe is already running.', 409, 'YOUTUBE_UPLOAD_PROBE_RUNNING');
  let outcome = { attempted: false, result: 'failure', reason: 'probe_failed' };
  try {
    const Video = require('../models/video.model');
    const ShortAsset = require('../models/shortAsset.model');
    const videos = await Video.find({ 'youtubeUpload.status': 'waiting' }).sort({ 'youtubeUpload.queuedAt': 1, _id: 1 }).limit(1).lean();
    const assets = await ShortAsset.find({ 'youtubeUpload.status': 'waiting' }).sort({ 'youtubeUpload.queuedAt': 1, _id: 1 }).limit(1).lean();
    const candidates = [...videos.map((item) => ({ item, kind: 'video' })), ...assets.map((item) => ({ item, kind: 'short_asset' }))]
      .sort((a, b) => new Date(a.item.youtubeUpload?.queuedAt || 0) - new Date(b.item.youtubeUpload?.queuedAt || 0) || String(a.item._id).localeCompare(String(b.item._id)));
    if (!candidates.length) { outcome = { attempted: false, result: 'no_waiting_upload' }; return { attempted: false, reason: 'no_waiting_upload' }; }
    const { item, kind } = candidates[0];
    outcome = { attempted: true, result: 'failure', kind, id: String(item._id) };
    const result = kind === 'video'
      ? await require('./youtubeUpload.service').autoUploadVideoToYouTube(item._id, { fetchImpl, now, probe: marker })
      : await require('./shortAssetPublish.service').runTrackedShortAssetUpload({ assetId: item._id, fetchImpl, now, probe: marker });
    outcome = { attempted: true, result: result ? 'success' : 'failure', kind, id: String(item._id) };
    return { attempted: true, succeeded: Boolean(result), kind, id: String(item._id) };
  } finally {
    await RuntimeSetting.findOneAndUpdate({ key: PAUSE_KEY, 'value.probe.startedAt': now, 'value.probe.by': marker.by }, {
      $set: { 'value.probe': null },
      $push: { 'value.log': { $each: [{ type: 'probe', startedAt: now, finishedAt: new Date(), by: marker.by, ...outcome }], $slice: -50 } },
    });
  }
}

module.exports = { PAUSE_KEY, GATE_KEY, GATE_LEASE_MS, nextPacificReset, classifyUploadSessionError, acquireUploadGate, waitForUploadGate,
  getUploadPauseSnapshot, getUploadGateSnapshot, quotaWaitingError, assertUploadNotPaused, recordUploadPause, recordUploadSuccess, runUploadProbe };
