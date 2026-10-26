const { inspectLocalUploadFile } = require('../utils/localVideoSource');
const { fileWorkKeys, sourceStatusWorkKey, sourceWorkKey, tryAcquireWork } = require('./youtubeWorkOwnership.service');
const { claimCleanupSource, inspectCleanupSource, loadLocalFileReferences, deleteCleanupSource } = require('./localSourceCleanup.service');
const ShortAsset = require('../models/shortAsset.model');
const {
  SHORT_ASSET_STATUSES,
  YOUTUBE_UPLOAD_STATUSES,
} = require('../constants/enums');
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

// CLEANUP_SOURCES.short_asset.listEntries：只列出符合短片安全條件的成品，
// 保留期從 YouTube 上傳完成起算（#30）。
async function listShortAssetCleanupEntries() {
  const assets = await ShortAsset.find({
    status: { $in: CLEANABLE_SHORT_ASSET_STATUSES },
    'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.UPLOADED,
    youtubeVideoId: { $exists: true, $nin: [null, ''] },
    filePath: { $exists: true, $nin: [null, ''] },
  })
    .select('_id title courseId filePath status generationVersion youtubeVideoId youtubeUpload')
    .lean();
  const cleanable = assets.filter(isCleanableShortAsset);
  if (!cleanable.length) return [];

  const references = await loadLocalFileReferences();
  const entries = [];
  for (const asset of cleanable) {
    const source = await inspectCleanupSource(SHORT_ASSET_CLEANUP_KIND, asset, references);
    if (source.reason) continue;

    entries.push({
      kind: SHORT_ASSET_CLEANUP_KIND,
      id: String(asset._id),
      title: asset.title || '',
      courseId: asset.courseId ? String(asset.courseId?._id || asset.courseId) : null,
      sizeBytes: source.file.sizeBytes,
      sourceSnapshot: source.snapshot,
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
async function cleanupShortAssetLocalFile(assetId, options = {}) {
  const release = tryAcquireWork([sourceWorkKey(SHORT_ASSET_CLEANUP_KIND, assetId), sourceStatusWorkKey(SHORT_ASSET_CLEANUP_KIND, assetId)]);
  if (!release) return { cleaned: false, reason: 'operation_in_progress' };
  let releaseFile;
  try {
    if (!(await isYouTubeLifecycleSwitchEnabled(YOUTUBE_LIFECYCLE_SWITCHES.CLEANUP))) return { cleaned: false, reason: 'disabled' };
    const asset = await ShortAsset.findById(assetId).lean();
    if (!asset) return { cleaned: false, reason: 'short_asset_not_found' };
    if (asset.youtubeUpload?.localCleanupAt) return { cleaned: false, reason: 'already_cleaned' };
    if (!isCleanableShortAsset(asset)) return { cleaned: false, reason: 'lifecycle_not_complete' };
    let file;
    try { file = inspectLocalUploadFile(asset.filePath); } catch { return { cleaned: false, reason: 'reference_check_failed' }; }
    releaseFile = tryAcquireWork(fileWorkKeys(file));
    if (!releaseFile) return { cleaned: false, reason: 'operation_in_progress' };
    const source = await inspectCleanupSource(SHORT_ASSET_CLEANUP_KIND, asset);
    if (source.reason) {
      await recordCleanupError(assetId, source.reason === 'shared_reference'
        ? 'Refusing to clean a local file referenced by another short asset or video.' : `Refusing cleanup: ${source.reason}.`);
      return { cleaned: false, reason: source.reason };
    }
    const owner = await claimCleanupSource(SHORT_ASSET_CLEANUP_KIND, asset, source, options);
    if (!owner) return { cleaned: false, reason: 'source_changed' };
    const deletion = await deleteCleanupSource(source.file, { ...options, verifyOwnership: owner.verifyOwnership });
    if (!deletion.cleaned) {
      if (deletion.reason === 'delete_failed') await ShortAsset.findOneAndUpdate(owner.filter, { $set: { 'youtubeUpload.localCleanupError': 'Local file deletion failed; source retained for retry.' } });
      return { cleaned: false, reason: deletion.reason };
    }
    try {
      const finalized = await ShortAsset.findOneAndUpdate(owner.filter, { $set: {
        'youtubeUpload.localCleanupAt': new Date(), 'youtubeUpload.localCleanupError': null,
      } }, { new: true });
      if (!finalized) throw new Error('Cleanup ownership changed before finalization.');
      return { cleaned: deletion.existed, reason: deletion.existed ? null : 'already_missing' };
    } catch { return { cleaned: deletion.existed, reason: 'state_write_failed', freedBytes: deletion.freedBytes }; }
  } finally { releaseFile?.(); release(); }
}

module.exports = {
  CLEANABLE_SHORT_ASSET_STATUSES,
  SHORT_ASSET_CLEANUP_KIND,
  cleanupShortAssetLocalFile,
  isCleanableShortAsset,
  listShortAssetCleanupEntries,
};
