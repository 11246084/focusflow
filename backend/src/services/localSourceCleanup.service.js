const fs = require('fs');
const Video = require('../models/video.model');
const ShortAsset = require('../models/shortAsset.model');
const { inspectLocalUploadFile, sameLocalFile } = require('../utils/localVideoSource');
const { isYouTubeLifecycleSwitchEnabled } = require('./youtubeLifecycleSettings.service');

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
    return { file, snapshot: sourceSnapshot(item, file), reason: null };
  } catch { return { reason: 'reference_check_failed' }; }
}

// 所有非破壞性 await 完成後才重查開關，接著同步核對實體身份並 unlink。
async function deleteCleanupSource(file, { beforeDelete } = {}) {
  const stopReason = beforeDelete ? await beforeDelete() : null;
  if (stopReason) return { cleaned: false, reason: stopReason };
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

module.exports = { deleteCleanupSource, inspectCleanupSource, loadLocalFileReferences, sourceSnapshot };
