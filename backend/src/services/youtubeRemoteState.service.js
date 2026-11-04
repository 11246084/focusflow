const { randomUUID } = require('node:crypto');
const Video = require('../models/video.model');
const ShortAsset = require('../models/shortAsset.model');
const RuntimeSetting = require('../models/runtimeSetting.model');
const AppError = require('../utils/appError');
const { inspectLocalUploadFile } = require('../utils/localVideoSource');
const { observedField, observedFields } = require('./youtubeWorkOwnership.service');
const { isYouTubeLifecycleSwitchEnabled } = require('./youtubeLifecycleSettings.service');

const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const HOUR = 3600000;
const DAY = 24 * HOUR;
const RETRY_DELAYS = [5 * 60000, 15 * 60000, HOUR, 6 * HOUR];
const remoteScheduler = { timer: null, clearTimer: null, generation: null, inFlight: null };
const OBSERVED = ['youtubeVideoId', 'youtubeUpload.status', 'youtubeUpload.attemptId',
  'generationVersion', 'status', 'reviewStatus', 'deletedAt', 'filePath',
  'youtubeUpload.remoteState', 'youtubeUpload.readyAt', 'youtubeUpload.lastCheckAt'];

function modelFor(kind) {
  if (kind === 'video') return Video;
  if (kind === 'short_asset') return ShortAsset;
  throw new AppError('Invalid YouTube content kind.', 400, 'VALIDATION_ERROR');
}

function plain(value) { return value?.toObject ? value.toObject() : value; }
async function updateItem(kind, filter, update) {
  const query = modelFor(kind).findOneAndUpdate(filter, update, { new: true });
  // Lean preserves missing versus explicit-null fields for subsequent CAS.
  // The in-memory harness returns a Promise instead of a Mongoose Query.
  return plain(await (typeof query.lean === 'function' ? query.lean() : query));
}

function getExpectedPrivacyStatuses(kind, item = {}) {
  modelFor(kind);
  if (kind === 'video') return item.deletedAt ? [] : ['unlisted'];
  if (item.status === 'archived') return ['unlisted', 'private'];
  if (item.reviewStatus === 'rejected') return ['private'];
  return ['unlisted'];
}

function evaluateRemoteState(kind, item, remote, now = new Date()) {
  const expected = getExpectedPrivacyStatuses(kind, item);
  if (!expected.length) return { remoteState: null, blockedReason: null, privacyStatus: null };
  const status = remote?.status;
  const privacyStatus = status?.privacyStatus || null;
  const result = (remoteState, blockedReason = null) => ({ remoteState, blockedReason, privacyStatus });
  if (!remote) return result('blocked', 'deleted');
  if (['failed', 'rejected', 'deleted'].includes(status?.uploadStatus)) {
    return result('blocked', `${status.uploadStatus}${status.rejectionReason || status.failureReason ? `:${status.rejectionReason || status.failureReason}` : ''}`);
  }
  if (!expected.includes(privacyStatus)) return result('blocked', `privacy_not_${expected.join('_or_')}`);
  if (status?.embeddable === false) return result('blocked', 'embedding_disabled');
  if (status?.uploadStatus === 'processed') return result('ready');
  if (status?.uploadStatus === 'uploaded' && item.youtubeUpload?.uploadedAt
    && now.getTime() - new Date(item.youtubeUpload.uploadedAt).getTime() >= DAY) return result('blocked', 'processing_timeout');
  return result('processing');
}

// A finite operation deadline also covers token acquisition and response bodies.
async function withDeadline(fetchImpl, work, timeoutMs = 30000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('YouTube state request timed out.')); }, timeoutMs);
    timer.unref?.();
  });
  const boundedFetch = (url, options = {}) => {
    if (controller.signal.aborted) throw new Error('YouTube state request timed out.');
    return fetchImpl(url, { ...options, signal: controller.signal });
  };
  try { return await Promise.race([work(boundedFetch), timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}

async function youtubeJson(url, accessToken, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error('YouTube state query failed.');
    error.status = response.status;
    error.reason = body?.error?.errors?.[0]?.reason;
    error.quotaExceeded = error.status === 403 && error.reason === 'quotaExceeded';
    throw error;
  }
  return body;
}

async function fetchRemoteBatch(ids, { fetchImpl = global.fetch } = {}) {
  if (ids.length > 50) throw new Error('At most 50 YouTube videos per state request.');
  return withDeadline(fetchImpl, async (boundedFetch) => {
    const { fetchAccessToken } = require('./youtubeUpload.service');
    const token = await fetchAccessToken({ fetchImpl: boundedFetch });
    return youtubeJson(`${VIDEOS_URL}?${new URLSearchParams({ part: 'status,snippet', id: ids.join(',') })}`, token, boundedFetch);
  });
}

async function readUploadPrivacy({ youtubeVideoId, response, fetchImpl = global.fetch } = {}) {
  if (['public', 'private', 'unlisted'].includes(response?.status?.privacyStatus)) return response.status.privacyStatus;
  try {
    const body = await fetchRemoteBatch([youtubeVideoId], { fetchImpl });
    const privacy = body?.items?.find((item) => item.id === youtubeVideoId)?.status?.privacyStatus;
    return ['public', 'private', 'unlisted'].includes(privacy) ? privacy : null;
  } catch { return null; }
}

function stateFilter(kind, item) {
  return { _id: item._id, $and: observedFields(item, OBSERVED) };
}

async function notify(options) {
  return require('./notification.service').notifyYouTubeRemoteEvent(options);
}

function latestIncident(item, action) {
  return [...(item.youtubeUpload?.privacyIncidents || [])].reverse().find((entry) => entry.action === action);
}

async function appendIncident(kind, item, incident) {
  // ID/generation/attempt ownership prevents a late observation reaching a new upload.
  return updateItem(kind, { _id: item._id,
    $and: observedFields(item, ['youtubeVideoId', 'generationVersion', 'youtubeUpload.attemptId']) },
  { $push: { 'youtubeUpload.privacyIncidents': incident } });
}

async function markQueryFailure(kind, item, now) {
  const start = latestIncident(item, 'query_failure');
  const recovered = latestIncident(item, 'query_recovered');
  const active = start && (!recovered || new Date(start.detectedAt) > new Date(recovered.detectedAt));
  const incident = active ? start : { detectedAt: now, observed: null, action: 'query_failure', result: 'query_failed', actor: 'system' };
  const update = { $set: { 'youtubeUpload.lastCheckAt': now, 'youtubeUpload.lastCheckError': 'YouTube state query failed.' },
    ...(!active ? { $push: { 'youtubeUpload.privacyIncidents': incident } } : {}) };
  const saved = await updateItem(kind, stateFilter(kind, item), update);
  if (saved && now - new Date(incident.detectedAt) >= HOUR) {
    await notify({ kind, item: saved, reason: 'query_failed', detectedAt: incident.detectedAt });
  }
  return saved;
}

async function applyRemoteObservation({ kind, item, remote, now = new Date(), fetchImpl = global.fetch, publish = true } = {}) {
  if (!item?.youtubeVideoId || item.youtubeUpload?.status !== 'uploaded' || !getExpectedPrivacyStatuses(kind, item).length) return null;
  const evaluation = evaluateRemoteState(kind, item, remote, now);
  const fields = {
    'youtubeUpload.remoteState': evaluation.remoteState,
    'youtubeUpload.blockedReason': evaluation.blockedReason,
    'youtubeUpload.lastCheckAt': now, 'youtubeUpload.lastCheckError': null,
    [kind === 'video' ? 'youtubeUpload.privacyStatus' : 'youtubePrivacyStatus']: evaluation.privacyStatus,
  };
  if (evaluation.remoteState === 'ready') {
    fields['youtubeUpload.readyAt'] = item.youtubeUpload.remoteState === 'ready' && item.youtubeUpload.readyAt ? item.youtubeUpload.readyAt : now;
    if (kind === 'video') {
      const url = `https://www.youtube.com/watch?v=${item.youtubeVideoId}`;
      Object.assign(fields, { videoSource: 'youtube', videoUrl: url, sourceUrl: url });
    }
  } else if (kind === 'video' && item.videoSource === 'youtube' && item.filePath) {
    try {
      const source = inspectLocalUploadFile(item.filePath);
      if (source.safe && source.exists) Object.assign(fields, { videoSource: 'upload', videoUrl: `/uploads/${require('node:path').basename(source.localPath)}` });
    } catch { /* missing source is handled by the admin notification */ }
  }
  const recovered = latestIncident(item, 'query_failure') && item.youtubeUpload.lastCheckError
    ? { detectedAt: now, observed: evaluation.privacyStatus, action: 'query_recovered', result: 'ok', actor: 'system' } : null;
  let saved = await updateItem(kind, stateFilter(kind, item), {
    $set: fields, ...(recovered ? { $push: { 'youtubeUpload.privacyIncidents': recovered } } : {}),
  });
  if (!saved) return null;
  if (evaluation.remoteState === 'blocked') {
    await notify({ kind, item: saved, reason: 'remote_blocked', detectedAt: item.youtubeUpload.readyAt || item.youtubeUpload.uploadedAt || now });
  }
  if (evaluation.privacyStatus === 'public') {
    saved = await handlePublicPrivacy({ kind, item: saved, remote, now, fetchImpl }) || saved;
  }
  if (publish && kind === 'short_asset' && evaluation.remoteState === 'ready'
    && saved.reviewStatus === 'approved' && saved.status !== 'archived' && saved.status !== 'published'
    && Number(saved.reviewedGenerationVersion) === Number(saved.generationVersion || 1)) {
    await require('./shortAssetPublish.service').markShortAssetPublished(saved);
  }
  return saved;
}

async function checkItemRemoteState({ kind = 'video', item, id, fetchImpl = global.fetch, now = new Date() } = {}) {
  const supplied = plain(item);
  const current = await modelFor(kind).findById(supplied?._id || id).lean();
  // Callers may pass projected records or hydrated legacy documents whose
  // defaults were never persisted. Use the complete lean record for CAS while
  // rejecting a delayed callback belonging to an older upload/generation.
  if (supplied && (!current || supplied.youtubeVideoId !== current.youtubeVideoId
    || (supplied.youtubeUpload?.attemptId || null) !== (current.youtubeUpload?.attemptId || null)
    || Number(supplied.generationVersion || 1) !== Number(current.generationVersion || 1))) return null;
  if (!current?.youtubeVideoId || current.youtubeUpload?.status !== 'uploaded') return null;
  let body;
  try { body = await fetchRemoteBatch([current.youtubeVideoId], { fetchImpl }); }
  catch {
    const saved = await markQueryFailure(kind, current, now);
    // An insert response reporting public is already a privacy incident even
    // when the subsequent readiness query fails. Ownership is re-read before PUT.
    if (saved && (saved.youtubeUpload?.privacyStatus || saved.youtubePrivacyStatus) === 'public') {
      return handlePublicPrivacy({ kind, item: saved, remote: { status: { privacyStatus: 'public' } }, now, fetchImpl });
    }
    return saved;
  }
  return applyRemoteObservation({ kind, item: current, remote: body.items?.find((entry) => entry.id === current.youtubeVideoId), now, fetchImpl });
}

function retryDue(item, now) {
  if ((item.youtubeUpload?.privacyStatus || item.youtubePrivacyStatus) !== 'public') return false;
  const detected = latestIncident(item, 'detected_public');
  const attempts = (item.youtubeUpload?.privacyIncidents || []).filter((entry) => entry.action === 'auto_private'
    && (!detected || new Date(entry.detectedAt) >= new Date(detected.detectedAt)));
  if (!attempts.length) return true;
  const last = attempts[attempts.length - 1];
  return now - new Date(last.detectedAt) >= RETRY_DELAYS[Math.min(attempts.length - 1, RETRY_DELAYS.length - 1)];
}

async function checkYouTubeRemoteStates({ fetchImpl = global.fetch, now = new Date(), includeAll = false } = {}) {
  const groups = await Promise.all(['video', 'short_asset'].map(async (kind) => {
    const items = await modelFor(kind).find({ 'youtubeUpload.status': 'uploaded', youtubeVideoId: { $exists: true, $nin: [null, ''] },
      ...(kind === 'video' ? { deletedAt: null } : {}) }).lean();
    return items.filter((item) => includeAll || item.youtubeUpload.remoteState === 'processing'
      || item.youtubeUpload.lastCheckError || !item.youtubeUpload.lastCheckAt
      || now - new Date(item.youtubeUpload.lastCheckAt) >= DAY || retryDue(item, now)).map((item) => ({ kind, item }));
  }));
  const entries = groups.flat();
  let checked = 0; let failedBatches = 0;
  for (let offset = 0; offset < entries.length; offset += 50) {
    const batch = entries.slice(offset, offset + 50);
    let body;
    try { body = await fetchRemoteBatch([...new Set(batch.map(({ item }) => item.youtubeVideoId))], { fetchImpl }); }
    catch {
      failedBatches += 1;
      for (const { kind, item } of batch) await markQueryFailure(kind, item, now);
      continue;
    }
    const byId = new Map((body.items || []).map((remote) => [remote.id, remote]));
    for (const { kind, item } of batch) {
      await applyRemoteObservation({ kind, item, remote: byId.get(item.youtubeVideoId), now, fetchImpl });
      checked += 1;
    }
  }
  return { checked, failedBatches };
}

// Readiness and the daily privacy audit continue while uploads/recovery are
// paused. Only the privacy_guard switch controls automatic privacy changes.
function startYouTubeRemoteStateScheduler({
  intervalMs = require('../config/env').youtubeUploadRecoveryIntervalMs,
  fetchImpl = global.fetch,
  now = () => new Date(),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  if (remoteScheduler.timer) return remoteScheduler.inFlight;
  const generation = Symbol('youtube-remote-state');
  remoteScheduler.generation = generation;
  const runOnce = () => {
    if (remoteScheduler.generation !== generation) return Promise.resolve(null);
    if (remoteScheduler.inFlight) return remoteScheduler.inFlight;
    const execution = checkYouTubeRemoteStates({ fetchImpl, now: now() }).catch(() => {
      if (process.env.NODE_ENV !== 'test') console.error('YouTube remote state check failed; it will retry next round.');
      return null;
    });
    const release = () => { if (remoteScheduler.inFlight === execution) remoteScheduler.inFlight = null; };
    remoteScheduler.inFlight = execution;
    execution.then(release, release);
    return execution;
  };
  const initial = runOnce();
  // A recovery interval of zero disables upload polling, not privacy auditing.
  const delay = Number.isFinite(Number(intervalMs)) && Number(intervalMs) > 0 ? Number(intervalMs) : 5 * 60000;
  remoteScheduler.clearTimer = clearIntervalImpl;
  remoteScheduler.timer = setIntervalImpl(runOnce, delay);
  remoteScheduler.timer?.unref?.();
  return initial;
}

function stopYouTubeRemoteStateScheduler() {
  remoteScheduler.generation = null;
  if (remoteScheduler.timer) remoteScheduler.clearTimer(remoteScheduler.timer);
  remoteScheduler.timer = null;
  remoteScheduler.clearTimer = null;
}

// The switch and coordination state deliberately share the approved key. CAS
// includes the complete value so admin writes preserve counts and live owners.
async function mutateGuard(mutator) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await RuntimeSetting.findOne({ key: 'privacy_guard' }).lean();
    const value = current?.value && typeof current.value === 'object' ? current.value : { enabled: current?.value === true };
    const guard = mutator(structuredClone(value.guard || {}));
    if (!guard) return null;
    try {
      const result = await RuntimeSetting.findOneAndUpdate({ key: 'privacy_guard', ...observedField('value', current?.value) },
        { $set: { value: { ...value, guard } } }, { new: true, upsert: !current, setDefaultsOnInsert: true }).lean();
      if (result) return result.value.guard;
    } catch (error) { if (error.code !== 11000) throw error; }
  }
  return null;
}

function nextPacificMidnight(now) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  const date = formatter.format(now);
  // Binary-search the first instant in a different LA date; handles DST.
  let low = now.getTime(); let high = low + 26 * HOUR;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (formatter.format(new Date(middle)) === date) low = middle; else high = middle;
  }
  return new Date(high);
}

async function handlePublicPrivacy({ kind, item, remote, now = new Date(), fetchImpl = global.fetch } = {}) {
  if (!item?.youtubeVideoId || item.youtubeUpload?.status !== 'uploaded' || remote?.status?.privacyStatus !== 'public') return item;
  const previous = latestIncident(item, 'detected_public');
  const resolved = [...(item.youtubeUpload?.privacyIncidents || [])].reverse().find((entry) => ['auto_private', 'restore_unlisted'].includes(entry.action) && entry.result === 'confirmed');
  const incident = previous && (!resolved || new Date(previous.detectedAt) > new Date(resolved.detectedAt)) ? previous
    : { detectedAt: now, observed: 'public', action: 'detected_public', result: 'public', actor: 'system' };
  if (incident !== previous) item = await appendIncident(kind, item, incident) || item;
  await notify({ kind, item, reason: 'privacy_public', detectedAt: incident.detectedAt, urgent: true });
  if (!(await isYouTubeLifecycleSwitchEnabled('privacy_guard')) || !retryDue(item, now)) return item;
  if (!getExpectedPrivacyStatuses(kind, item).length) return item;
  return changePrivacy({ kind, item, remote, privacyStatus: 'private', actor: 'system', now, fetchImpl, automatic: true });
}

async function changePrivacy({ kind, item, remote, privacyStatus, actor, now, fetchImpl, automatic = false }) {
  const ownerToken = randomUUID();
  const acquired = await mutateGuard((guard) => {
    if (new Date(guard.quotaUntil || 0) > now || new Date(guard.leaseUntil || 0) > now) return null;
    return { ...guard, ownerToken, leaseUntil: new Date(now.getTime() + 90000) };
  });
  if (!acquired) {
    if (automatic) return item;
    throw new AppError('Privacy changes are temporarily paused.', 409, 'YOUTUBE_PRIVACY_DEFERRED');
  }
  let observed = remote?.status?.privacyStatus || null;
  let initiallyObserved = observed;
  let result = 'failed';
  try {
    await withDeadline(fetchImpl, async (boundedFetch) => {
      const { fetchAccessToken, setVideoPrivacy } = require('./youtubeUpload.service');
      const token = await fetchAccessToken({ fetchImpl: boundedFetch });
      const channel = await youtubeJson(`${CHANNELS_URL}?part=id&mine=true`, token, boundedFetch);
      // Never act on a supplied/stale observation alone; check channel again.
      const body = await youtubeJson(`${VIDEOS_URL}?${new URLSearchParams({ part: 'status,snippet', id: item.youtubeVideoId })}`, token, boundedFetch);
      const actual = body.items?.find((entry) => entry.id === item.youtubeVideoId);
      observed = actual?.status?.privacyStatus || null;
      initiallyObserved = observed;
      if (!channel.items?.[0]?.id || actual?.snippet?.channelId !== channel.items[0].id) { result = 'not_owned'; return; }
      if (automatic && observed !== 'public') { result = `observed:${observed || 'unknown'}`; return; }
      const current = await modelFor(kind).findById(item._id).lean();
      if (!current || current.youtubeVideoId !== item.youtubeVideoId || current.youtubeUpload?.status !== 'uploaded'
        || !getExpectedPrivacyStatuses(kind, current).length
        || (!automatic && getExpectedPrivacyStatuses(kind, current).join(',') !== 'unlisted')
        || current.youtubeUpload.attemptId !== item.youtubeUpload.attemptId
        || Number(current.generationVersion || 1) !== Number(item.generationVersion || 1)) { result = 'state_changed'; return; }
      if (automatic && !(await isYouTubeLifecycleSwitchEnabled('privacy_guard'))) { result = 'disabled'; return; }
      // Reserve immediately before the videos.update. Failed/ambiguous sends
      // count too, and all processes use the same atomic value CAS.
      const claimed = await mutateGuard((guard) => {
        if (guard.ownerToken !== ownerToken || new Date(guard.leaseUntil) <= now || new Date(guard.quotaUntil || 0) > now) return null;
        const updates = (guard.updates || []).filter((time) => new Date(time) > new Date(now.getTime() - HOUR));
        if (updates.length >= 10) return null;
        return { ...guard, updates: [...updates, now] };
      });
      if (!claimed) { result = 'rate_limited'; return; }
      await setVideoPrivacy({ youtubeVideoId: item.youtubeVideoId, privacyStatus, fetchImpl: boundedFetch });
      const readback = await youtubeJson(`${VIDEOS_URL}?part=status&id=${encodeURIComponent(item.youtubeVideoId)}`, token, boundedFetch);
      observed = readback.items?.find((entry) => entry.id === item.youtubeVideoId)?.status?.privacyStatus || null;
      result = observed === privacyStatus ? 'confirmed' : `readback:${observed || 'unknown'}`;
    });
  } catch (error) {
    result = error.quotaExceeded || error.reason === 'quotaExceeded' ? 'quota_exceeded' : 'failed';
    if (result === 'quota_exceeded') await mutateGuard((guard) => ({ ...guard, quotaUntil: nextPacificMidnight(now) }));
  } finally {
    await mutateGuard((guard) => guard.ownerToken === ownerToken ? { ...guard, ownerToken: null, leaseUntil: null } : null);
  }
  // Rate/lease deferrals are not failed API attempts and do not restart backoff.
  if (['rate_limited', 'disabled', 'state_changed'].includes(result)) {
    if (automatic) return item;
    throw new AppError('Privacy changes are temporarily deferred.', 409, 'YOUTUBE_PRIVACY_DEFERRED');
  }
  const incident = { detectedAt: now, observed: initiallyObserved, action: automatic ? 'auto_private' : 'restore_unlisted', result, actor: String(actor || 'system') };
  let updated = await appendIncident(kind, item, incident) || item;
  if (result === 'confirmed') {
    updated = await updateItem(kind, { _id: item._id,
      $and: observedFields(item, ['youtubeVideoId', 'generationVersion', 'youtubeUpload.attemptId']) },
    { $set: { [kind === 'video' ? 'youtubeUpload.privacyStatus' : 'youtubePrivacyStatus']: observed } }) || updated;
  }
  if (!automatic && result !== 'confirmed') throw new AppError('YouTube privacy readback could not be confirmed.', 502, 'YOUTUBE_PRIVACY_NOT_CONFIRMED');
  return updated;
}

async function restoreUnlisted({ kind, id, actor, fetchImpl = global.fetch, now = new Date() } = {}) {
  const item = await modelFor(kind).findById(id).lean();
  if (!item) throw new AppError('YouTube upload not found.', 404, 'YOUTUBE_UPLOAD_NOT_FOUND');
  if (!item.youtubeVideoId || item.youtubeUpload?.status !== 'uploaded' || getExpectedPrivacyStatuses(kind, item).join(',') !== 'unlisted') {
    throw new AppError('This lifecycle does not allow restoring unlisted privacy.', 409, 'YOUTUBE_PRIVACY_RESTORE_NOT_ALLOWED');
  }
  const changed = await changePrivacy({ kind, item, privacyStatus: 'unlisted', actor, now, fetchImpl });
  const checked = await checkItemRemoteState({ kind, item: changed, fetchImpl, now });
  return { kind, id: String(id), privacyStatus: checked?.youtubeUpload?.privacyStatus || checked?.youtubePrivacyStatus || null,
    remoteState: checked?.youtubeUpload?.remoteState || null, blockedReason: checked?.youtubeUpload?.blockedReason || null };
}

async function buildYouTubeRemoteStateSnapshot() {
  const groups = await Promise.all(['video', 'short_asset'].map(async (kind) => {
    const items = await modelFor(kind).find({ 'youtubeUpload.status': 'uploaded', ...(kind === 'video' ? { deletedAt: null } : {}) })
      .select('youtubeUpload.remoteState').lean();
    return { kind, processing: items.filter((item) => item.youtubeUpload?.remoteState === 'processing').length,
      blocked: items.filter((item) => item.youtubeUpload?.remoteState === 'blocked').length,
      unchecked: items.filter((item) => !item.youtubeUpload?.remoteState).length };
  }));
  return { notReadyCount: groups.reduce((sum, group) => sum + group.processing + group.blocked + group.unchecked, 0), groups };
}

// A successful current-round query is mandatory: stale ready metadata or a
// failed query must never authorize irreversible source deletion.
async function verifyRemoteReadyForCleanup({ kind, id, fetchImpl = global.fetch, now = new Date() } = {}) {
  const item = await modelFor(kind).findById(id).lean();
  if (!item || item.youtubeUpload?.status !== 'uploaded' || !item.youtubeVideoId) return 'remote_not_ready';
  let body;
  try { body = await fetchRemoteBatch([item.youtubeVideoId], { fetchImpl }); }
  catch { await markQueryFailure(kind, item, now); return 'remote_check_failed'; }
  const saved = await applyRemoteObservation({ kind, item, remote: body.items?.find((entry) => entry.id === item.youtubeVideoId), now, fetchImpl, publish: false });
  return saved?.youtubeUpload?.remoteState === 'ready' && (kind !== 'video' || saved.videoSource === 'youtube') ? null : 'remote_not_ready';
}

module.exports = { RETRY_DELAYS, applyRemoteObservation, buildYouTubeRemoteStateSnapshot, checkItemRemoteState,
  checkYouTubeRemoteStates, evaluateRemoteState, fetchRemoteBatch, getExpectedPrivacyStatuses,
  handlePublicPrivacy, nextPacificMidnight, readUploadPrivacy, restoreUnlisted, retryDue, verifyRemoteReadyForCleanup,
  startYouTubeRemoteStateScheduler, stopYouTubeRemoteStateScheduler };
