const Course = require('../models/course.model');
const ShortAsset = require('../models/shortAsset.model');
const User = require('../models/user.model');
const Video = require('../models/video.model');
const {
  SHORT_ASSET_REVIEW_STATUSES,
  SHORT_ASSET_STATUSES,
  VIDEO_SOURCE_TYPES,
  YOUTUBE_AVAILABILITIES,
  YOUTUBE_UPLOAD_STATUSES,
} = require('../constants/enums');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const {
  YOUTUBE_VIDEOS_URL,
  buildYouTubeUploadSnapshot,
  buildYouTubeWatchUrl,
  fetchAccessToken,
  hasPrivacyCapableScope,
  normalizePrivacyStatus,
} = require('./youtubeUpload.service');
const { markShortAssetPublished } = require('./shortAssetPublish.service');
const { notifyYouTubeUploadResolved } = require('./notification.service');

// 被隔離的上傳由管理員收尾（decisions.md #17、#18、#28）。隔離＝上傳失敗且不可自動重試
// （retrySafe 不是 true），YouTube 可能已收到影片，自動重試會在頻道留下兩支相同的影片。

const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const YOUTUBE_PLAYLIST_ITEMS_URL = 'https://www.googleapis.com/youtube/v3/playlistItems';
// 上傳清單由新到舊，每頁 50 支、每頁 1 單位配額；只往回看 1000 支，避免頻道很大時耗盡配額。
const LOOKUP_PAGE_SIZE = 50;
const LOOKUP_MAX_PAGES = 20;

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const QUARANTINE_KINDS = Object.freeze({
  VIDEO: 'video',
  SHORT_ASSET: 'short_asset',
});

// 與 youtubeUpload.service 的「尚未上傳」定義一致，含舊資料存成空字串的 ID。
const MISSING_YOUTUBE_VIDEO_ID = {
  $or: [
    { youtubeVideoId: null },
    { youtubeVideoId: '' },
    { youtubeVideoId: { $exists: false } },
  ],
};

const QUARANTINED_UPLOAD = {
  'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.FAILED,
  // 舊資料可能沒有 retrySafe；沒標記過的一律視為不安全（同 assertRetryableUpload）。
  'youtubeUpload.retrySafe': { $ne: true },
};

const KIND_DEFINITIONS = {
  [QUARANTINE_KINDS.VIDEO]: {
    model: Video,
    label: 'video',
    notFound: () => new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND'),
    // 上傳時寫入描述的標記（youtubeUpload.service autoUploadVideoToYouTube）。
    descriptionMarker: (id) => `Uploaded by FocusFlow (video ${id})`,
    query: () => ({ ...QUARANTINED_UPLOAD, $and: [MISSING_YOUTUBE_VIDEO_ID] }),
    uploaderId: (item) => item.uploadedBy?._id || item.uploadedBy || null,
    // 比照 autoUploadVideoToYouTube 上傳成功時寫入的欄位：播放改走 YouTube。
    buildApplyUpdate: ({ youtubeVideoId, now }) => {
      const youtubeUrl = buildYouTubeWatchUrl(youtubeVideoId);
      return {
        youtubeVideoId,
        sourceUrl: youtubeUrl,
        videoUrl: youtubeUrl,
        videoSource: VIDEO_SOURCE_TYPES.YOUTUBE,
        'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.UPLOADED,
        'youtubeUpload.error': null,
        'youtubeUpload.uploadedAt': now,
        'youtubeUpload.failedAt': null,
        'youtubeUpload.retrySafe': false,
        'youtubeUpload.nextRetryAt': null,
      };
    },
    afterApply: async () => null,
  },
  [QUARANTINE_KINDS.SHORT_ASSET]: {
    model: ShortAsset,
    label: 'short asset',
    notFound: () => new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND'),
    // 短片上傳時加在描述末尾的標記（#29，D 塊）。
    descriptionMarker: (id) => `(FocusFlow short ${id})`,
    // 只處理本功能上傳的成品（有 filePath）；已封存的成品不再上架，不列入。
    query: () => ({
      ...QUARANTINED_UPLOAD,
      filePath: { $exists: true, $nin: [null, ''] },
      status: { $ne: SHORT_ASSET_STATUSES.ARCHIVED },
      $and: [MISSING_YOUTUBE_VIDEO_ID],
    }),
    // ShortAsset 沒有 uploadedBy；確認揭露的就是上傳成品的教師。
    uploaderId: (item) => item.disclosure?.confirmedBy || null,
    // 比照 uploadShortAssetToYouTube 上傳成功時的欄位；status 不動，上架另由審核判斷。
    buildApplyUpdate: ({ youtubeVideoId, privacyStatus, now }) => {
      const normalizedPrivacy = normalizePrivacyStatus(privacyStatus);
      return {
        youtubeVideoId,
        youtubeUrl: buildYouTubeWatchUrl(youtubeVideoId),
        // 已轉成 private 的影片學生端嵌入不了，比照退回時的標示。
        youtubeAvailability: normalizedPrivacy === 'private'
          ? YOUTUBE_AVAILABILITIES.UNAVAILABLE
          : YOUTUBE_AVAILABILITIES.PLAYABLE,
        youtubePrivacyStatus: normalizedPrivacy,
        lastCheckedAt: now,
        'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.UPLOADED,
        'youtubeUpload.error': null,
        'youtubeUpload.uploadedAt': now,
        'youtubeUpload.failedAt': null,
        'youtubeUpload.retrySafe': false,
        'youtubeUpload.nextRetryAt': null,
      };
    },
    // 審核比收尾早通過時，比照上傳成功後的判斷補上架，否則成品會卡在「已通過但沒進學生牆」。
    afterApply: async (asset) => {
      if (
        asset.reviewStatus === SHORT_ASSET_REVIEW_STATUSES.APPROVED
        && Number(asset.reviewedGenerationVersion) === Number(asset.generationVersion || 1)
        && asset.status !== SHORT_ASSET_STATUSES.PUBLISHED
        && asset.youtubeAvailability === YOUTUBE_AVAILABILITIES.PLAYABLE
      ) {
        return markShortAssetPublished(asset);
      }
      return null;
    },
  },
};

function getKindDefinition(kind) {
  const definition = KIND_DEFINITIONS[kind];
  if (!definition) {
    throw new AppError(`kind must be one of: ${Object.keys(KIND_DEFINITIONS).join(', ')}.`, 400, 'VALIDATION_ERROR');
  }
  return definition;
}

function toId(value) {
  if (!value) return null;
  return String(value._id || value);
}

async function loadById(model, ids, fields) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const documents = await model.find({ _id: { $in: unique } }).select(fields).lean();
  return new Map(documents.map((document) => [String(document._id), document]));
}

function isQuarantined(kind, item) {
  if (!item || item.youtubeVideoId) return false;
  if (item.youtubeUpload?.status !== YOUTUBE_UPLOAD_STATUSES.FAILED) return false;
  if (item.youtubeUpload?.retrySafe === true) return false;
  if (kind === QUARANTINE_KINDS.SHORT_ASSET) {
    return Boolean(item.filePath) && item.status !== SHORT_ASSET_STATUSES.ARCHIVED;
  }
  return true;
}

// 只有被隔離的項目可以查詢、套用或重設；其他狀態回 409，避免覆寫正常上傳流程。
async function loadQuarantinedItem(kind, id) {
  const definition = getKindDefinition(kind);
  assertObjectId(id, definition.label);
  const item = await definition.model.findById(id).lean();
  if (!item) throw definition.notFound();
  if (!isQuarantined(kind, item)) {
    throw new AppError(
      `Only quarantined YouTube uploads can be resolved; this ${definition.label} is not quarantined.`,
      409,
      'YOUTUBE_QUARANTINE_NOT_ALLOWED',
    );
  }
  return item;
}

// 不呼叫 YouTube 的初步判斷，給清單決定要不要顯示「查詢 YouTube」：
// 沒有憑證 → false；最近一次換 token 成功 → 看 scope；還不知道 → null。
function resolveSearchableHint() {
  const snapshot = buildYouTubeUploadSnapshot();
  if (!snapshot.credentialsConfigured) return false;
  if (snapshot.credentialCheck.status !== 'ok') return null;
  return hasPrivacyCapableScope();
}

async function listQuarantinedItems() {
  const groups = await Promise.all(Object.entries(KIND_DEFINITIONS).map(async ([kind, definition]) => {
    const items = await definition.model.find(definition.query()).lean();
    return items.map((item) => ({ kind, item, definition }));
  }));
  const entries = groups.flat();

  const [courses, users] = await Promise.all([
    loadById(Course, entries.map(({ item }) => toId(item.courseId)), '_id title'),
    loadById(User, entries.map(({ item, definition }) => toId(definition.uploaderId(item))), '_id name'),
  ]);

  const items = entries.map(({ kind, item, definition }) => {
    const courseId = toId(item.courseId);
    const uploaderId = toId(definition.uploaderId(item));
    return {
      kind,
      id: String(item._id),
      title: item.title || '',
      courseId,
      courseTitle: courses.get(courseId)?.title || item.courseSnapshot?.title || '',
      uploadedBy: {
        id: uploaderId,
        name: (uploaderId && users.get(uploaderId)?.name) || null,
      },
      failedAt: item.youtubeUpload?.failedAt || null,
      error: item.youtubeUpload?.error || null,
      attemptCount: Number(item.youtubeUpload?.attemptCount || 0),
    };
  });

  // 最新的失敗排最前面，管理員先看到剛發生的。
  items.sort((left, right) => new Date(right.failedAt || 0).getTime() - new Date(left.failedAt || 0).getTime());
  return { items, searchable: resolveSearchableHint() };
}

function createVerifyError(message, responseText) {
  const suffix = responseText ? ` ${String(responseText).slice(0, 300)}` : '';
  return new AppError(`${message}${suffix}`.trim(), 502, 'YOUTUBE_QUARANTINE_VERIFY_FAILED');
}

async function youtubeGet(url, accessToken, fetchImpl, failureMessage) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (error) {
    throw createVerifyError(failureMessage, error?.message);
  }
  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw createVerifyError(failureMessage, responseText);
  }
  return response.json();
}

// 憑證所屬頻道（自家頻道）的 ID 與「上傳的影片」播放清單。
async function fetchOwnChannel(accessToken, fetchImpl) {
  const payload = await youtubeGet(
    `${YOUTUBE_CHANNELS_URL}?part=id,contentDetails&mine=true`,
    accessToken,
    fetchImpl,
    'Failed to read the YouTube channel of the configured credentials.',
  );
  const channel = payload?.items?.[0];
  if (!channel?.id) {
    throw createVerifyError('The configured YouTube credentials do not own a channel.');
  }
  return {
    channelId: channel.id,
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads || null,
  };
}

function toLookupMatch(playlistItem) {
  return {
    youtubeVideoId: playlistItem.contentDetails?.videoId || playlistItem.snippet?.resourceId?.videoId || null,
    title: playlistItem.snippet?.title || '',
    publishedAt: playlistItem.contentDetails?.videoPublishedAt || playlistItem.snippet?.publishedAt || null,
    privacyStatus: playlistItem.status?.privacyStatus || null,
  };
}

// 「查詢 YouTube」（#17）：用描述標記比對自家頻道的上傳清單，只回傳結果，不修改資料。
// 憑證沒有讀取權限（只有 youtube.upload）時回 searchable: false，畫面改為手動輸入。
async function lookupQuarantinedItem({ kind, id, fetchImpl = global.fetch } = {}) {
  const definition = getKindDefinition(kind);
  await loadQuarantinedItem(kind, id);

  let accessToken;
  try {
    accessToken = await fetchAccessToken({ fetchImpl });
  } catch (error) {
    if (error?.code === 'YOUTUBE_UPLOAD_NOT_CONFIGURED') return { searchable: false, matches: [] };
    throw error;
  }
  if (!hasPrivacyCapableScope()) return { searchable: false, matches: [] };

  const { uploadsPlaylistId } = await fetchOwnChannel(accessToken, fetchImpl);
  if (!uploadsPlaylistId) return { searchable: true, matches: [] };

  const marker = definition.descriptionMarker(String(id));
  const matches = [];
  let pageToken = null;
  for (let page = 0; page < LOOKUP_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails,status',
      playlistId: uploadsPlaylistId,
      maxResults: String(LOOKUP_PAGE_SIZE),
    });
    if (pageToken) params.set('pageToken', pageToken);
    const payload = await youtubeGet(
      `${YOUTUBE_PLAYLIST_ITEMS_URL}?${params.toString()}`,
      accessToken,
      fetchImpl,
      'Failed to list uploaded YouTube videos.',
    );
    for (const playlistItem of payload?.items || []) {
      if (String(playlistItem.snippet?.description || '').includes(marker)) {
        matches.push(toLookupMatch(playlistItem));
      }
    }
    pageToken = payload?.nextPageToken || null;
    if (!pageToken) break;
  }

  return { searchable: true, matches: matches.filter((match) => match.youtubeVideoId) };
}

function normalizeYouTubeVideoId(value) {
  const youtubeVideoId = String(value || '').trim();
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(youtubeVideoId)) {
    throw new AppError('youtubeVideoId must be an 11-character YouTube video ID.', 400, 'VALIDATION_ERROR');
  }
  return youtubeVideoId;
}

// 同一支 YouTube 影片不能同時是兩個 FocusFlow 上傳項目的播放來源，
// 否則清理其中一支的原片時，另一支的原片其實沒有 YouTube 備份。
async function assertYouTubeVideoIdUnused(youtubeVideoId) {
  const [videos, assets] = await Promise.all([
    Video.find({ youtubeVideoId, 'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.UPLOADED })
      .select('_id').limit(1).lean(),
    ShortAsset.find({ youtubeVideoId }).select('_id').limit(1).lean(),
  ]);
  if (videos.length || assets.length) {
    throw new AppError(
      `YouTube video ${youtubeVideoId} is already linked to another FocusFlow upload.`,
      409,
      'YOUTUBE_QUARANTINE_VIDEO_IN_USE',
    );
  }
}

// 套用前向 YouTube 確認影片存在且屬於自家頻道（#18）：填錯 ID 會讓學生看到別的影片，
// 清理開著時還會刪掉唯一的原片。
async function verifyOwnYouTubeVideo(youtubeVideoId, fetchImpl) {
  const accessToken = await fetchAccessToken({ fetchImpl });
  const { channelId } = await fetchOwnChannel(accessToken, fetchImpl);
  const payload = await youtubeGet(
    `${YOUTUBE_VIDEOS_URL}?part=snippet,status&id=${encodeURIComponent(youtubeVideoId)}`,
    accessToken,
    fetchImpl,
    'Failed to read the YouTube video.',
  );
  const remote = payload?.items?.[0];
  if (!remote) {
    throw new AppError(
      `YouTube video ${youtubeVideoId} was not found.`,
      422,
      'YOUTUBE_QUARANTINE_VIDEO_NOT_FOUND',
    );
  }
  if (remote.snippet?.channelId !== channelId) {
    throw new AppError(
      `YouTube video ${youtubeVideoId} does not belong to the FocusFlow channel.`,
      422,
      'YOUTUBE_QUARANTINE_VIDEO_NOT_OWNED',
    );
  }
  return { privacyStatus: remote.status?.privacyStatus || null };
}

// 只在項目仍是隔離狀態時寫入；檢查後被其他流程改掉時回 null，不覆寫。
function updateIfStillQuarantined(kind, id, $set) {
  const definition = getKindDefinition(kind);
  return definition.model.findOneAndUpdate(
    { _id: id, ...definition.query() },
    { $set },
    { new: true },
  );
}

function createStateChangedError(definition) {
  return new AppError(
    `The ${definition.label} is no longer quarantined; refresh and try again.`,
    409,
    'YOUTUBE_QUARANTINE_NOT_ALLOWED',
  );
}

// 「確認套用」（#17、#18）：驗證通過才標成已上傳並切換播放。
async function applyQuarantinedItem({
  kind,
  id,
  youtubeVideoId,
  fetchImpl = global.fetch,
  now = new Date(),
} = {}) {
  const definition = getKindDefinition(kind);
  const normalizedYouTubeVideoId = normalizeYouTubeVideoId(youtubeVideoId);
  const item = await loadQuarantinedItem(kind, id);
  await assertYouTubeVideoIdUnused(normalizedYouTubeVideoId);
  const remote = await verifyOwnYouTubeVideo(normalizedYouTubeVideoId, fetchImpl);

  const updated = await updateIfStillQuarantined(kind, id, definition.buildApplyUpdate({
    youtubeVideoId: normalizedYouTubeVideoId,
    privacyStatus: remote.privacyStatus,
    now,
  }));
  if (!updated) throw createStateChangedError(definition);
  await definition.afterApply(updated);
  // 用處理前的失敗時間防重複：同一次失敗只通知一次。
  await notifyYouTubeUploadResolved({
    kind,
    item,
    uploaderId: definition.uploaderId(item),
    action: 'applied',
  });

  return { kind, id: String(id), status: YOUTUBE_UPLOAD_STATUSES.UPLOADED };
}

// 「重設為可重試」：確定 YouTube 上沒有這支時使用，次數歸零，交給恢復排程或教師重試。
async function resetQuarantinedItem({ kind, id, now = new Date() } = {}) {
  const definition = getKindDefinition(kind);
  const item = await loadQuarantinedItem(kind, id);

  const updated = await updateIfStillQuarantined(kind, id, {
    'youtubeUpload.retrySafe': true,
    'youtubeUpload.attemptCount': 0,
    'youtubeUpload.nextRetryAt': now,
  });
  if (!updated) throw createStateChangedError(definition);
  await notifyYouTubeUploadResolved({
    kind,
    item,
    uploaderId: definition.uploaderId(item),
    action: 'reset',
  });

  return {
    kind,
    id: String(id),
    status: YOUTUBE_UPLOAD_STATUSES.FAILED,
    retrySafe: true,
    attemptCount: 0,
  };
}

module.exports = {
  LOOKUP_MAX_PAGES,
  QUARANTINE_KINDS,
  YOUTUBE_CHANNELS_URL,
  YOUTUBE_PLAYLIST_ITEMS_URL,
  YOUTUBE_VIDEOS_URL,
  applyQuarantinedItem,
  listQuarantinedItems,
  loadQuarantinedItem,
  lookupQuarantinedItem,
  resetQuarantinedItem,
};
