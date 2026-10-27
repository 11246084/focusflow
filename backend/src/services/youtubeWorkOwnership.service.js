const { randomUUID } = require('node:crypto');
const env = require('../config/env');

// Fast rejection within this process only. Persistent claims/conditional
// updates below are the authority when multiple backends share a database.
const activeKeys = new Set();
function sourceWorkKey(kind, id) { return `source:${kind}:${String(id).toLowerCase()}`; }
function sourceStatusWorkKey(kind, id) { return `source-status:${kind}:${String(id).toLowerCase()}`; }
function fileWorkKeys(file) {
  return [`file-path:${file.pathKey}`, ...(file.physicalKey ? [`file-inode:${file.physicalKey}`] : [])];
}
function tryAcquireWork(keys) {
  const unique = [...new Set(keys)];
  if (unique.some((key) => activeKeys.has(key))) return null;
  for (const key of unique) activeKeys.add(key);
  let released = false;
  return () => { if (!released) { released = true; for (const key of unique) activeKeys.delete(key); } };
}
function getNested(item, field) { return field.split('.').reduce((value, key) => value?.[key], item); }
function observedField(field, value) {
  if (value === undefined) return { [field]: { $exists: false } };
  if (value === null) return { [field]: { $eq: null, $exists: true } };
  return { [field]: value };
}
function observedFields(item, fields) { return fields.map((field) => observedField(field, getNested(item, field))); }
function uploadStateUpdate(item, fields) {
  // Mongo 不能在 null parent 下用 dotted $set 建子欄位。初次佔用一次建立整份狀態；
  // 已有狀態的重試仍只更新指定欄位，保留來源／清理 metadata。
  if (item.youtubeUpload != null) return fields;
  return { youtubeUpload: Object.fromEntries(Object.entries(fields).map(([field, value]) => [field.replace(/^youtubeUpload\./, ''), value])) };
}
function uploadClaimUpdate(item, fields) {
  if (item.youtubeUpload == null) return [
    { $set: uploadStateUpdate(item, fields) },
    { $set: { 'youtubeUpload.heartbeatAt': '$$NOW' } },
  ];
  return { $set: fields, $currentDate: { 'youtubeUpload.heartbeatAt': true } };
}

const UPLOAD_OBSERVED_FIELDS = [
  'filePath', 'youtubeUpload.status', 'youtubeUpload.retrySafe', 'youtubeUpload.attemptCount',
  'youtubeUpload.lastAttemptAt', 'youtubeUpload.attemptId', 'youtubeUpload.nextRetryAt', 'generationVersion',
];
function uploadClaimQuery(item, { allowRetry = true, now = new Date(), observed = item, shortAsset = false } = {}) {
  const initial = { 'youtubeUpload.status': null };
  const retry = {
    'youtubeUpload.status': 'failed', 'youtubeUpload.retrySafe': true,
    $and: [
      { $or: [{ 'youtubeUpload.attemptCount': { $lt: env.youtubeUploadMaxAttempts } }, { 'youtubeUpload.attemptCount': null }] },
      { $or: [{ 'youtubeUpload.nextRetryAt': { $lte: now } }, { 'youtubeUpload.nextRetryAt': null }] },
    ],
  };
  return {
    _id: item._id,
    ...NO_CLEANUP_INTENT,
    ...(shortAsset ? { status: { $ne: 'archived' }, 'disclosure.aiDisclosureConfirmed': true, 'disclosure.consentConfirmed': true }
      : { 'processing.status': 'completed' }),
    $and: [
      { $or: [{ youtubeVideoId: null }, { youtubeVideoId: '' }] },
      { $or: allowRetry ? [initial, retry] : [initial] },
      ...observedFields(observed, UPLOAD_OBSERVED_FIELDS),
    ],
  };
}
function attemptOwnerQuery(item, attemptId) {
  return { _id: item._id, 'youtubeUpload.status': 'uploading', 'youtubeUpload.attemptId': attemptId,
    $and: observedFields(item, ['filePath', 'generationVersion']) };
}

const UPLOAD_HEARTBEAT_MS = 15_000;
const UPLOAD_LEASE_MS = 120_000;
const NO_CLEANUP_INTENT = { 'youtubeUpload.cleanupIntent': null };
function expiredUploadHeartbeat() {
  // Compare against Mongo's clock, not a scheduler's injectable candidate time.
  return { $or: [
    { 'youtubeUpload.heartbeatAt': null },
    { $expr: { $lte: ['$youtubeUpload.heartbeatAt', { $subtract: ['$$NOW', UPLOAD_LEASE_MS] }] } },
  ] };
}
function keepUploadAlive(model, owner) {
  const controller = new AbortController();
  let stopped = false;
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      if (stopped) return;
      try {
        const renewed = await model.findOneAndUpdate(owner, { $currentDate: { 'youtubeUpload.heartbeatAt': true } });
        if (!renewed) controller.abort(new Error('YouTube upload ownership lost.'));
      } catch (error) { controller.abort(error); }
    });
  }, UPLOAD_HEARTBEAT_MS);
  timer.unref?.();
  return { signal: controller.signal, async stop() { stopped = true; clearInterval(timer); await pending; } };
}

async function reserveYouTubeBackup(youtubeVideoId, kind, item, { session } = {}) {
  const Backup = require('../models/youTubeBackup.model');
  const AppError = require('../utils/appError');
  const contentKey = `${kind}:${String(item._id).toLowerCase()}${kind === 'short_asset' ? `:${Number(item.generationVersion || 1)}` : ''}`;
  if (!(await isBackupUnassigned(youtubeVideoId, { kind, id: item._id, session }))) {
    throw new AppError('YouTube backup belongs to another content.', 409, 'YOUTUBE_QUARANTINE_VIDEO_IN_USE');
  }
  // Insert/upsert only under the same content identity. A conflicting _id fails
  // atomically even when two processes both observed no legacy assignment.
  try {
    await Backup.findOneAndUpdate({ _id: youtubeVideoId, contentKey },
      { $setOnInsert: { contentKey } }, { upsert: true, new: true, session });
  } catch (error) {
    if (error.code !== 11000) throw error;
    throw new AppError('YouTube backup belongs to another content.', 409, 'YOUTUBE_QUARANTINE_VIDEO_IN_USE');
  }
  // Retain reservations on ambiguous DB failures. The same content can resume;
  // a different source can never inherit an orphaned but possibly used backup.
}

async function isBackupUnassigned(youtubeVideoId, { kind, id, session } = {}) {
  const Video = require('../models/video.model');
  const ShortAsset = require('../models/shortAsset.model');
  // 匯入的 Video URL 可跨課程共用；只有系統上傳完成的 Video 佔用備份。
  // Transaction operations must be sequential on one session. Outside a
  // transaction the existing callers retain their parallel read behavior.
  const findVideos = () => Video.find({ youtubeVideoId, 'youtubeUpload.status': 'uploaded', ...(kind === 'video' && id ? { _id: { $ne: id } } : {}) }, null, { session }).select('_id').limit(1).lean();
  const findAssets = () => ShortAsset.find({ youtubeVideoId, ...(kind === 'short_asset' && id ? { _id: { $ne: id } } : {}) }, null, { session }).select('_id').limit(1).lean();
  const [videos, assets] = session ? [await findVideos(), await findAssets()] : await Promise.all([findVideos(), findAssets()]);
  return videos.length === 0 && assets.length === 0;
}

module.exports = { attemptOwnerQuery, expiredUploadHeartbeat, keepUploadAlive, NO_CLEANUP_INTENT, reserveYouTubeBackup, UPLOAD_HEARTBEAT_MS, UPLOAD_LEASE_MS, fileWorkKeys, getNested, isBackupUnassigned, observedField, observedFields, randomWorkId: randomUUID,
  sourceStatusWorkKey, sourceWorkKey, tryAcquireWork, uploadClaimQuery, uploadClaimUpdate, uploadStateUpdate };
