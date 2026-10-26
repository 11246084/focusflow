const fs = require('fs');
const Video = require('../models/video.model');
const ShortAsset = require('../models/shortAsset.model');
const { inspectLocalUploadFile, sameLocalFile } = require('../utils/localVideoSource');
const { isYouTubeLifecycleSwitchEnabled } = require('./youtubeLifecycleSettings.service');
const { fileWorkKeys, getNested, isBackupUnassigned, observedField, randomWorkId, tryAcquireWork } = require('./youtubeWorkOwnership.service');

function sourceSnapshot(item, file) {
  return {
    file,
    fields: {
      filePath: item.filePath,
      youtubeVideoId: item.youtubeVideoId,
      'youtubeUpload.status': item.youtubeUpload?.status,
      'youtubeUpload.uploadedAt': item.youtubeUpload?.uploadedAt,
      'youtubeUpload.localSourceRestoredAt': item.youtubeUpload?.localSourceRestoredAt,
      'youtubeUpload.localCleanupAt': item.youtubeUpload?.localCleanupAt,
      'processing.status': item.processing?.status,
      status: item.status,
      generationVersion: item.generationVersion,
      'youtubeUpload.localSourceVersion': item.youtubeUpload?.localSourceVersion,
    },
  };
}

async function loadLocalFileReferences() {
  const query = { filePath: { $exists: true, $nin: [null, ''] } };
  const groups = await Promise.all([Video.find(query).select('_id filePath').lean(), ShortAsset.find(query).select('_id filePath').lean()]);
  return groups.flatMap((items, index) => items.map((item) => ({
    kind: index === 0 ? 'video' : 'short_asset', id: String(item._id),
    file: inspectLocalUploadFile(item.filePath),
  })));
}

async function inspectCleanupSource(kind, item, references) {
  try {
    const file = inspectLocalUploadFile(item.filePath);
    if (!file.safe) return { reason: 'unsafe_path' };
    const refs = references || await loadLocalFileReferences();
    if (refs.some((ref) => (ref.kind !== kind || ref.id !== String(item._id)) && sameLocalFile(ref.file, file))) {
      return { reason: 'shared_reference' };
    }
    if (item.youtubeVideoId && !(await isBackupUnassigned(item.youtubeVideoId, { kind, id: item._id }))) {
      return { reason: 'backup_in_use' };
    }
    return { file, snapshot: sourceSnapshot(item, file), reason: null };
  } catch { return { reason: 'reference_check_failed' }; }
}

// 所有非破壞性 await 完成後才重查開關，接著同步核對實體身份並 unlink。
async function deleteCleanupSource(file, { beforeDelete, verifyOwnership } = {}) {
  const stopReason = beforeDelete ? await beforeDelete() : null;
  if (stopReason) return { cleaned: false, reason: stopReason };
  try {
    if (verifyOwnership && !(await verifyOwnership())) return { cleaned: false, reason: 'source_changed' };
  } catch { return { cleaned: false, reason: 'reference_check_failed' }; }
  if (!(await isYouTubeLifecycleSwitchEnabled('cleanup'))) return { cleaned: false, reason: 'disabled' };
  try {
    const current = inspectLocalUploadFile(file.localPath);
    if (!current.safe || current.pathKey !== file.pathKey || current.fingerprint !== file.fingerprint) {
      return { cleaned: false, reason: 'source_changed' };
    }
    if (current.exists) fs.unlinkSync(current.localPath);
    return { cleaned: true, reason: null, existed: current.exists, freedBytes: current.sizeBytes };
  } catch { return { cleaned: false, reason: 'delete_failed' }; }
}

function matchesSourceSnapshot(item, file, snapshot) {
  if (!snapshot) return true;
  if (file.pathKey !== snapshot.file.pathKey || file.fingerprint !== snapshot.file.fingerprint) return false;
  return Object.entries(snapshot.fields).every(([field, expected]) => {
    const actual = getNested(item, field);
    if (expected instanceof Date || actual instanceof Date) return new Date(actual).getTime() === new Date(expected).getTime();
    return actual === expected;
  });
}

async function claimCleanupSource(kind, item, source, options, playback = {}) {
  const snapshot = options.candidate?.sourceSnapshot || source.snapshot;
  if (!matchesSourceSnapshot(item, source.file, snapshot)) return null;
  const model = kind === 'video' ? Video : ShortAsset;
  const version = randomWorkId();
  const conditions = Object.entries(snapshot.fields).map(([field, value]) => observedField(field, value));
  const claimed = await model.findOneAndUpdate({ _id: item._id, $and: conditions }, {
    $set: { ...playback, 'youtubeUpload.localSourceVersion': version },
  }, { new: true });
  if (!claimed) return null;
  const filter = { _id: item._id, $and: [
    ...Object.entries(snapshot.fields).filter(([field]) => field !== 'youtubeUpload.localSourceVersion').map(([field, value]) => observedField(field, value)),
    { 'youtubeUpload.localSourceVersion': version },
  ] };
  return {
    filter,
    verifyOwnership: async () => {
      const current = await model.find(filter).limit(1).lean();
      if (!current.length) return false;
      return !(await inspectCleanupSource(kind, current[0])).reason;
    },
  };
}

// multer 已收下但請求被拒的檔案：DB 無法證明無引用時保留，不刪其他請求的來源。
async function discardUnreferencedUpload(file) {
  let release;
  try {
    if (!file?.path) return;
    const source = inspectLocalUploadFile(file.path);
    if (!source.safe || !source.exists) return;
    release = tryAcquireWork(fileWorkKeys(source));
    if (!release) return;
    const refs = await loadLocalFileReferences();
    if (!refs.some((ref) => sameLocalFile(ref.file, source))) fs.unlinkSync(source.localPath);
  } catch { /* DB／檔案身份未知時保留，待人工或後續孤兒檔清理。 */ }
  finally { release?.(); }
}

module.exports = { claimCleanupSource, deleteCleanupSource, discardUnreferencedUpload, inspectCleanupSource, loadLocalFileReferences, matchesSourceSnapshot, sourceSnapshot };
