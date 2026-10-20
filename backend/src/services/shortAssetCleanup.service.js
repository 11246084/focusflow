const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const ShortAsset = require('../models/shortAsset.model');
const Video = require('../models/video.model');
const {
  SHORT_ASSET_STATUSES,
  YOUTUBE_UPLOAD_STATUSES,
} = require('../constants/enums');
const { isPathInside, resolveLocalUploadPath } = require('./youtubeUpload.service');
const {
  YOUTUBE_LIFECYCLE_SWITCHES,
  isYouTubeLifecycleSwitchEnabled,
} = require('./youtubeLifecycleSettings.service');

// 短片成品的原片清理（decisions.md #28、#30、#31），由 youtubeLifecycle.service 的
// CLEANUP_SOURCES 以 kind 'short_asset' 掛入；保留期、空間門檻、預告與排程都走 A 的共用判斷。
//
// 獨立成檔而不放進 shortAssetPublish.service：清理只讀寫檔案與兩個清理欄位，
// 與上架、恢復排程、隔離收尾互不相干，分開才不會和那幾段的修改互相牽動。

const SHORT_ASSET_CLEANUP_KIND = 'short_asset';

// 被退回、尚未重拍的草稿還要用這個檔重新上傳或轉私人，不清理；
// 已上架與已封存的成品 YouTube 上已有一份（#30）。
const CLEANABLE_SHORT_ASSET_STATUSES = Object.freeze([
  SHORT_ASSET_STATUSES.PUBLISHED,
  SHORT_ASSET_STATUSES.ARCHIVED,
]);

function shortErrorMessage(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 300);
}

function toValidTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function isCleanableShortAsset(asset) {
  return Boolean(
    asset
    && CLEANABLE_SHORT_ASSET_STATUSES.includes(asset.status)
    && asset.youtubeVideoId
    && asset.youtubeUpload?.status === YOUTUBE_UPLOAD_STATUSES.UPLOADED
    && toValidTime(asset.youtubeUpload?.uploadedAt) !== null
    && asset.filePath
    && !asset.youtubeUpload?.localCleanupAt,
  );
}

function isSafeUploadPath(localPath) {
  const uploadRoot = path.resolve(env.uploadDir);
  return isPathInside(uploadRoot, localPath) && localPath !== uploadRoot;
}

// 同一個 filePath 被幾筆成品與影片引用。清理後的成品仍保留 filePath，所以照樣計入。
async function countFileReferences(filePaths) {
  const [assets, videos] = await Promise.all([
    ShortAsset.find({ filePath: { $in: filePaths } }).select('_id filePath').lean(),
    Video.find({ filePath: { $in: filePaths } }).select('_id filePath').lean(),
  ]);
  const counts = new Map();
  for (const reference of [...assets, ...videos]) {
    counts.set(reference.filePath, (counts.get(reference.filePath) || 0) + 1);
  }
  return counts;
}

function readFileSize(localPath) {
  try {
    return fs.statSync(localPath).size;
  } catch {
    return 0;
  }
}

// CLEANUP_SOURCES.short_asset.listEntries：只列出符合短片安全條件的成品，
// 保留期從 YouTube 上傳完成起算（#30）。
async function listShortAssetCleanupEntries() {
  const assets = await ShortAsset.find({
    status: { $in: CLEANABLE_SHORT_ASSET_STATUSES },
    'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.UPLOADED,
    youtubeVideoId: { $exists: true, $nin: [null, ''] },
    filePath: { $exists: true, $nin: [null, ''] },
  })
    .select('_id title courseId filePath status youtubeVideoId youtubeUpload')
    .lean();
  const cleanable = assets.filter(isCleanableShortAsset);
  if (!cleanable.length) return [];

  const referenceCounts = await countFileReferences([...new Set(cleanable.map((asset) => asset.filePath))]);
  const entries = [];
  for (const asset of cleanable) {
    const localPath = resolveLocalUploadPath(asset.filePath);
    if (!isSafeUploadPath(localPath)) continue;
    if ((referenceCounts.get(asset.filePath) || 0) > 1) continue;

    entries.push({
      kind: SHORT_ASSET_CLEANUP_KIND,
      id: String(asset._id),
      title: asset.title || '',
      courseId: asset.courseId ? String(asset.courseId?._id || asset.courseId) : null,
      sizeBytes: readFileSize(localPath),
      retentionStartTime: toValidTime(asset.youtubeUpload.uploadedAt),
    });
  }
  return entries;
}

async function recordCleanupError(assetId, message) {
  await ShortAsset.findByIdAndUpdate(assetId, { $set: { 'youtubeUpload.localCleanupError': message } });
}

// CLEANUP_SOURCES.short_asset.cleanup：刪檔前重新確認開關（#14）與每一項安全條件。
// 成功後 filePath 保留不清空，改記 localCleanupAt（#31）。
async function cleanupShortAssetLocalFile(assetId) {
  if (!(await isYouTubeLifecycleSwitchEnabled(YOUTUBE_LIFECYCLE_SWITCHES.CLEANUP))) {
    return { cleaned: false, reason: 'disabled' };
  }

  const asset = await ShortAsset.findById(assetId).lean();
  if (!asset) return { cleaned: false, reason: 'short_asset_not_found' };
  if (asset.youtubeUpload?.localCleanupAt) return { cleaned: false, reason: 'already_cleaned' };
  if (!isCleanableShortAsset(asset)) return { cleaned: false, reason: 'lifecycle_not_complete' };

  const localPath = resolveLocalUploadPath(asset.filePath);
  if (!isSafeUploadPath(localPath)) {
    await recordCleanupError(assetId, 'Refusing to clean a short asset path outside UPLOAD_DIR.');
    return { cleaned: false, reason: 'unsafe_path' };
  }

  const [otherAssets, videos] = await Promise.all([
    ShortAsset.find({ _id: { $ne: asset._id }, filePath: asset.filePath }).select('_id').lean(),
    Video.find({ filePath: asset.filePath }).select('_id').lean(),
  ]);
  if (otherAssets.length || videos.length) {
    await recordCleanupError(assetId, 'Refusing to clean a local file referenced by another short asset or video.');
    return { cleaned: false, reason: 'shared_reference' };
  }

  try {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    await ShortAsset.findByIdAndUpdate(assetId, {
      $set: {
        'youtubeUpload.localCleanupAt': new Date(),
        'youtubeUpload.localCleanupError': null,
      },
    });
    return { cleaned: true, reason: null };
  } catch (error) {
    await recordCleanupError(assetId, shortErrorMessage(error));
    return { cleaned: false, reason: 'delete_failed' };
  }
}

module.exports = {
  CLEANABLE_SHORT_ASSET_STATUSES,
  SHORT_ASSET_CLEANUP_KIND,
  cleanupShortAssetLocalFile,
  isCleanableShortAsset,
  listShortAssetCleanupEntries,
};
