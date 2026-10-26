const { randomUUID } = require('node:crypto');
const env = require('../config/env');

// 部署限制沿用決策 #11：只有一個 backend writer。這些鎖不跨行程；
// 擴為 cluster／多台前必須改用共同所有權儲存。DB token 則用於拒絕過期回寫。
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

async function isBackupUnassigned(youtubeVideoId, { kind, id } = {}) {
  const Video = require('../models/video.model');
  const ShortAsset = require('../models/shortAsset.model');
  // 匯入的 Video URL 可跨課程共用；只有系統上傳完成的 Video 佔用備份。
  const [videos, assets] = await Promise.all([
    Video.find({ youtubeVideoId, 'youtubeUpload.status': 'uploaded', ...(kind === 'video' && id ? { _id: { $ne: id } } : {}) }).select('_id').limit(1).lean(),
    ShortAsset.find({ youtubeVideoId, ...(kind === 'short_asset' && id ? { _id: { $ne: id } } : {}) }).select('_id').limit(1).lean(),
  ]);
  return videos.length === 0 && assets.length === 0;
}

module.exports = { attemptOwnerQuery, fileWorkKeys, getNested, isBackupUnassigned, observedField, observedFields, randomWorkId: randomUUID,
  sourceStatusWorkKey, sourceWorkKey, tryAcquireWork, uploadClaimQuery, uploadStateUpdate };
