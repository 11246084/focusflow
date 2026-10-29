const fs = require('node:fs');
const Video = require('../models/video.model');
const ShortAsset = require('../models/shortAsset.model');
const { assertObjectId } = require('../utils/objectId');
const AppError = require('../utils/appError');

const GROUPS = { video: Video, short_asset: ShortAsset };

async function loadItems() {
  const groups = await Promise.all(Object.entries(GROUPS).map(async ([kind, model]) => {
    const items = await model.find({ youtubeUpload: { $ne: null } })
      .select('_id title courseId youtubeVideoId youtubeUpload youtubePrivacyStatus youtubeAvailability filePath videoSource').lean();
    return items.map((item) => ({ kind, item }));
  }));
  return groups.flat();
}

// 明確列出可回傳的欄位；不能把 session、filePath 或模型快照送給管理頁。
function uploadRow(kind, item) {
  const upload = item.youtubeUpload || {};
  return {
    kind, id: String(item._id), title: item.title || '',
    courseId: item.courseId ? String(item.courseId) : null,
    youtubeVideoId: item.youtubeVideoId || null,
    status: upload.status || null, waitReason: upload.waitReason || null,
    error: upload.error ? String(upload.error).replace(/https?:\/\/\S+/g, '[remote endpoint]') : null,
    nextRetryAt: upload.nextRetryAt || null, queuedAt: upload.queuedAt || null,
    uploadedAt: upload.uploadedAt || null, phase: upload.phase || null,
    attemptCount: Number(upload.attemptCount || 0), retrySafe: upload.retrySafe === true,
    remoteState: upload.remoteState || null, blockedReason: upload.blockedReason || null,
    readyAt: upload.readyAt || null, lastCheckAt: upload.lastCheckAt || null,
    lastCheckError: upload.lastCheckError || null,
    privacyStatus: kind === 'video' ? upload.privacyStatus || null : item.youtubePrivacyStatus || null,
    youtubeAvailability: kind === 'short_asset' ? item.youtubeAvailability || null : null,
    orphanUploads: (upload.orphanUploads || []).map(({ youtubeVideoId, attemptId, detectedAt }) => ({ youtubeVideoId, attemptId, detectedAt })),
  };
}

async function getUploadOverview({ now = new Date() } = {}) {
  const [pause, gate, groups] = await Promise.all([
    require('./youtubeUploadGate.service').getUploadPauseSnapshot({ now }),
    require('./youtubeUploadGate.service').getUploadGateSnapshot(),
    loadItems(),
  ]);
  const items = groups.map(({ kind, item }) => uploadRow(kind, item));
  const since = now.getTime() - 24 * 60 * 60 * 1000;
  return {
    pause, gate,
    waitingCount: items.filter((item) => item.status === 'waiting').length,
    uploadingCount: items.filter((item) => item.status === 'uploading').length,
    successLast24Hours: items.filter((item) => item.status === 'uploaded' && new Date(item.uploadedAt).getTime() >= since).length,
    lastPauseSuccessCount: pause.lastPauseSuccessCount ?? null,
    items: items.sort((a, b) => new Date(b.uploadedAt || b.queuedAt || 0) - new Date(a.uploadedAt || a.queuedAt || 0)),
  };
}

async function probeUploads({ user, fetchImpl = global.fetch, now = new Date() } = {}) {
  return require('./youtubeUploadGate.service').runUploadProbe({ actor: user?.id || user?._id, fetchImpl, now });
}

async function listPrivacyIncidents() {
  const groups = await loadItems();
  return {
    items: groups.flatMap(({ kind, item }) => (item.youtubeUpload?.privacyIncidents || []).map((incident) => ({
      kind, id: String(item._id), title: item.title || '', youtubeVideoId: item.youtubeVideoId || null,
      detectedAt: incident.detectedAt, observed: incident.observed,
      action: incident.action, result: incident.result, actor: incident.actor,
      privacyStatus: kind === 'video' ? item.youtubeUpload?.privacyStatus || null : item.youtubePrivacyStatus || null,
    }))).sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt)),
  };
}

async function restorePrivacy({ kind, id, user, fetchImpl = global.fetch, now = new Date() } = {}) {
  if (!GROUPS[kind]) throw new AppError('Invalid upload kind.', 400, 'VALIDATION_ERROR');
  assertObjectId(id, kind);
  return require('./youtubeRemoteState.service').restoreUnlisted({ kind, id, actor: String(user?.id || user?._id), fetchImpl, now });
}

async function getStorageOverview() {
  const [storage, localGroups] = await Promise.all([
    require('./uploadStorage.service').status(),
    Promise.all(Object.entries(GROUPS).map(async ([kind, model]) => (await model.find({ filePath: { $nin: [null, ''], $exists: true } })
      .select('_id title courseId filePath youtubeVideoId youtubeUpload youtubePrivacyStatus').lean()).map((item) => ({ kind, item })))),
  ]);
  const groups = localGroups.flat();
  let pendingLocalBytes = 0;
  let unreadableLocalCount = 0;
  for (const { kind, item } of groups) {
    if (!item.filePath || item.youtubeUpload?.remoteState === 'ready') continue;
    // 不將 DB 的任意路徑交給 stat；與原片安全檢查共用 realpath 邊界。
    try {
      const file = require('../utils/localVideoSource').inspectLocalUploadFile(item.filePath);
      if (file.safe && file.exists && (kind === 'video' || !item.youtubeUpload?.localCleanupAt)) pendingLocalBytes += fs.statSync(file.localPath).size;
    } catch { unreadableLocalCount += 1; }
  }
  return {
    ...storage, pendingLocalBytes, unreadableLocalCount,
    blocked: groups.filter(({ item }) => item.youtubeUpload?.remoteState === 'blocked').map(({ kind, item }) => uploadRow(kind, item)),
  };
}

module.exports = { getUploadOverview, probeUploads, listPrivacyIncidents, restorePrivacy, getStorageOverview };
