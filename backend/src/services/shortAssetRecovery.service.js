const env = require('../config/env');
const ShortAsset = require('../models/shortAsset.model');
const { SHORT_ASSET_STATUSES, YOUTUBE_UPLOAD_STATUSES } = require('../constants/enums');
const {
  isShortAssetUploadRunning,
  runTrackedShortAssetUpload,
} = require('./shortAssetPublish.service');

// 短片成品納入 YouTube 上傳恢復排程（decisions.md #28）。由 youtubeUpload.service 的
// recoverPendingYouTubeUploads 在處理完影片後呼叫：兩層開關、同一輪的鎖與批次大小都沿用影片的，
// 規則也相同——可安全重試的失敗依退避重試；卡在上傳中超過時限的隔離，等管理員收尾。

const MISSING_YOUTUBE_VIDEO_ID = {
  $or: [
    { youtubeVideoId: null },
    { youtubeVideoId: '' },
    { youtubeVideoId: { $exists: false } },
  ],
};

const STALE_UPLOAD_ERROR = 'Stale upload quarantined: an administrator must confirm whether YouTube received it.';

function buildShortAssetRecoveryQuery(now) {
  const staleBefore = new Date(now.getTime() - env.youtubeUploadStuckAfterMs);
  return {
    // 只處理本功能上傳的成品（有本機檔），已封存的不再上傳。
    filePath: { $exists: true, $nin: [null, ''] },
    status: { $ne: SHORT_ASSET_STATUSES.ARCHIVED },
    // 沒確認揭露的成品上傳前就會被擋下且不留失敗紀錄，撈進來只會每輪重來。
    'disclosure.aiDisclosureConfirmed': true,
    'disclosure.consentConfirmed': true,
    $and: [
      MISSING_YOUTUBE_VIDEO_ID,
      {
        $or: [
          { 'youtubeUpload.status': 'waiting', 'youtubeUpload.nextRetryAt': { $lte: now } },
          {
            'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.FAILED,
            'youtubeUpload.retrySafe': true,
            $and: [
              {
                $or: [
                  { 'youtubeUpload.attemptCount': { $lt: env.youtubeUploadMaxAttempts } },
                  { 'youtubeUpload.attemptCount': null },
                  { 'youtubeUpload.attemptCount': { $exists: false } },
                ],
              },
              {
                $or: [
                  { 'youtubeUpload.nextRetryAt': { $lte: now } },
                  { 'youtubeUpload.nextRetryAt': null },
                  { 'youtubeUpload.nextRetryAt': { $exists: false } },
                ],
              },
            ],
          },
          {
            'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.UPLOADING,
            $or: [
              { 'youtubeUpload.lastAttemptAt': { $lte: staleBefore } },
              { 'youtubeUpload.lastAttemptAt': null },
              { 'youtubeUpload.lastAttemptAt': { $exists: false } },
            ],
          },
        ],
      },
    ],
  };
}

async function recoverShortAssetUploads({ fetchImpl = global.fetch, now = new Date() } = {}) {
  // 短片自動化關閉時不得把任何東西送上 YouTube（同 scheduleUploadOnCreate），也不動上傳紀錄。
  if (!env.shortScriptAutomationEnabled) {
    return { recovered: 0, quarantined: 0, skippedItems: 0 };
  }

  const candidates = await ShortAsset.find(buildShortAssetRecoveryQuery(now))
    .select('+youtubeUpload.session.url')
    .sort({ 'youtubeUpload.queuedAt': 1, _id: 1 })
    .limit(env.youtubeUploadRecoveryBatchSize)
    .lean();
  const staleBefore = now.getTime() - env.youtubeUploadStuckAfterMs;
  let recovered = 0;
  let quarantined = 0;
  let skippedItems = 0;

  for (const asset of candidates) {
    if (asset.youtubeUpload?.status === YOUTUBE_UPLOAD_STATUSES.UPLOADING) {
      const lastAttemptMs = new Date(asset.youtubeUpload?.lastAttemptAt || 0).getTime();
      // 本行程還在傳的只是比較久，不是卡住。
      if (isShortAssetUploadRunning(asset._id) || lastAttemptMs > staleBefore) {
        skippedItems += 1;
        continue;
      }
      const quarantinedAsset = await require('./youtubeUpload.service').recoverStaleUpload({ model: ShortAsset, kind: 'short_asset', item: asset, fetchImpl, now });
      if (quarantinedAsset) {
        if (quarantinedAsset.youtubeUpload.status === 'uploaded' || quarantinedAsset.youtubeUpload.retrySafe) recovered += 1;
        else quarantined += 1;
      } else {
        skippedItems += 1;
      }
      continue;
    }

    if (isShortAssetUploadRunning(asset._id)) {
      skippedItems += 1;
      continue;
    }
    try {
      const uploaded = await runTrackedShortAssetUpload({ assetId: asset._id, fetchImpl, observed: asset, now });
      if (uploaded) recovered += 1;
      else skippedItems += 1;
    } catch (error) {
      if (error.youtubeUploadAttempted) recovered += 1;
      else skippedItems += 1;
      // 失敗原因與下一次重試時間已寫進 youtubeUpload；這一輪繼續處理下一支。
      if (process.env.NODE_ENV !== 'test') {
        console.error(`[shortAsset] YouTube upload recovery failed for ${asset._id}.`, error);
      }
    }
  }

  return { recovered, quarantined, skippedItems };
}

module.exports = {
  STALE_UPLOAD_ERROR,
  buildShortAssetRecoveryQuery,
  recoverShortAssetUploads,
};
