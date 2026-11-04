const fs = require('fs');
const os = require('os');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const Video = require('../models/video.model');
const ShortAsset = require('../models/shortAsset.model');
const { inspectLocalUploadFile, sameLocalFile } = require('../utils/localVideoSource');
const { isYouTubeLifecycleSwitchEnabled } = require('./youtubeLifecycleSettings.service');
const { fileWorkKeys, getNested, isBackupUnassigned, observedField, randomWorkId, tryAcquireWork } = require('./youtubeWorkOwnership.service');

const CLEANUP_LEASE_MS = 120_000;
function cleanupStorageKey() {
  const env = require('../config/env');
  return createHash('sha256').update(`${os.hostname()}:${fs.realpathSync.native(env.uploadDir)}`).digest('hex');
}
function expiredCleanupClaim() {
  return { $expr: { $lte: ['$youtubeUpload.cleanupClaimedAt', { $subtract: ['$$NOW', CLEANUP_LEASE_MS] }] } };
}

function sourceSnapshot(item, file) {
  return {
    file,
    fields: {
      filePath: item.filePath,
      youtubeVideoId: item.youtubeVideoId,
      'youtubeUpload.status': item.youtubeUpload?.status,
      'youtubeUpload.uploadedAt': item.youtubeUpload?.uploadedAt,
      'youtubeUpload.remoteState': item.youtubeUpload?.remoteState,
      'youtubeUpload.readyAt': item.youtubeUpload?.readyAt,
      videoSource: item.videoSource,
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
async function deleteCleanupSource(file, { beforeDelete, beginDelete, verifyOwnership, leaseValid = () => true, finalFreeBytes, minFreeBytes } = {}) {
  try {
    if (beginDelete && !(await beginDelete())) return { cleaned: false, reason: 'source_changed' };

  } catch { return { cleaned: false, reason: 'reference_check_failed' }; }

  // Every DB/setting await precedes the final space decision. Production uses
  // statfsSync below; async providers exist only for deterministic tests.
  const stopReason = beforeDelete ? await beforeDelete() : null;
  if (stopReason) return { cleaned: false, reason: stopReason };
  try { if (verifyOwnership && !(await verifyOwnership())) return { cleaned: false, reason: 'source_changed' }; } catch { return { cleaned: false, reason: 'reference_check_failed' }; }
  if (!(await isYouTubeLifecycleSwitchEnabled('cleanup'))) return { cleaned: false, reason: 'disabled' };
  try {
    if (!leaseValid()) return { cleaned: false, reason: 'source_changed' };
    const current = inspectLocalUploadFile(file.localPath);
    if (!current.safe || current.pathKey !== file.pathKey || current.fingerprint !== file.fingerprint) {
      return { cleaned: false, reason: 'source_changed' };
    }
    if (minFreeBytes > 0) {
      let free;
      try { free = finalFreeBytes(); } catch { return { cleaned: false, reason: 'space_unknown' }; }
      if (!Number.isFinite(free) || free < 0) return { cleaned: false, reason: 'space_unknown' };
      if (free >= minFreeBytes) return { cleaned: false, reason: 'space_recovered' };
    }
    // No asynchronous work between the lease/identity/space checks and unlink.
    if (!leaseValid()) return { cleaned: false, reason: 'source_changed' };
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
  const deadline = performance.now() + CLEANUP_LEASE_MS;
  const conditions = Object.entries(snapshot.fields).map(([field, value]) => observedField(field, value));
  const claimed = await model.findOneAndUpdate({ _id: item._id, 'youtubeUpload.cleanupIntent': null, $and: conditions }, {
    $set: { ...playback, 'youtubeUpload.localSourceVersion': version,
      'youtubeUpload.cleanupIntent': { id: version, phase: 'claimed', storageKey: cleanupStorageKey(), file: source.file },
    },
    $currentDate: { 'youtubeUpload.cleanupClaimedAt': true },
  }, { new: true });
  if (!claimed) return null;
  const filter = { _id: item._id, $and: [
    { 'youtubeUpload.cleanupIntent.id': version },
    ...Object.entries(snapshot.fields).filter(([field]) => field !== 'youtubeUpload.localSourceVersion').map(([field, value]) => observedField(field, value)),
    { 'youtubeUpload.localSourceVersion': version },
  ] };
  return {
    filter,
    leaseValid: () => performance.now() < deadline,
    async beginDelete() {
      return Boolean(await model.findOneAndUpdate({ ...filter, 'youtubeUpload.cleanupIntent.phase': 'claimed' },
        { $set: { 'youtubeUpload.cleanupIntent.phase': 'deleting' } }));
    },
    async deferFinalization() {
      // Only this owner, after it has finished all filesystem work, can hand off
      // before expiry. An ambiguous DB failure keeps the intent until recovery.
      try { await model.findOneAndUpdate(filter, { $set: { 'youtubeUpload.cleanupIntent.phase': 'repairable' } }); }
      catch { /* a subsequent expired-owner takeover will reconcile it */ }
    },
    async release() {
      // A failed cancellation leaves a recoverable intent; never erase a newer owner.
      try { await model.findOneAndUpdate({ _id: item._id, 'youtubeUpload.cleanupIntent.id': version },
        { $unset: { 'youtubeUpload.cleanupIntent': 1, 'youtubeUpload.cleanupClaimedAt': 1 } }); } catch { /* recovery retries */ }
    },
    verifyOwnership: async () => {
      const current = await model.find(filter).limit(1).lean();
      if (!current.length) return false;
      return !(await inspectCleanupSource(kind, current[0])).reason;
    },
  };
}

async function repairCleanupIntents() {
  const storageKey = cleanupStorageKey();
  let repaired = 0;
  let unresolved = 0;
  for (const [kind, model] of [['video', Video], ['short_asset', ShortAsset]]) {
    const items = await model.find({ 'youtubeUpload.cleanupIntent.storageKey': storageKey }).lean();
    for (const item of items) {
      const intent = item.youtubeUpload.cleanupIntent;
      try {
        // Fence the old worker *before* observing the file. Keep the intent in
        // place throughout recovery so rollback/restore cannot enter the gap.
        // Legacy intents without a phase are eligible only after lease expiry.
        const recoveryId = randomWorkId();
        const owned = await model.findOneAndUpdate({
          _id: item._id, filePath: item.filePath, 'youtubeUpload.cleanupIntent.id': intent.id,
          $or: [{ 'youtubeUpload.cleanupIntent.phase': 'repairable' }, expiredCleanupClaim()],
        }, { $set: { 'youtubeUpload.cleanupIntent.id': recoveryId, 'youtubeUpload.cleanupIntent.phase': 'recovering',
          'youtubeUpload.localSourceVersion': recoveryId },
        $currentDate: { 'youtubeUpload.cleanupClaimedAt': true } }, { new: true });
        if (!owned) continue;
        const filter = { _id: owned._id, filePath: owned.filePath, 'youtubeUpload.cleanupIntent.id': recoveryId,
          'youtubeUpload.cleanupIntent.phase': 'recovering', 'youtubeUpload.localSourceVersion': recoveryId };
        const file = inspectLocalUploadFile(owned.filePath);
        if (!file.safe || file.pathKey !== owned.youtubeUpload.cleanupIntent.file.pathKey) { unresolved += 1; continue; }
        if (!file.exists) {
          // No new deletion: metadata reconciliation is independent of switches,
          // retention and free space, and only on the storage which made the intent.
          const done = await model.findOneAndUpdate(filter, { $set: {
            ...(kind === 'video' ? { filePath: null } : {}),
            'youtubeUpload.localCleanupAt': new Date(), 'youtubeUpload.localCleanupError': null,
          }, $unset: { 'youtubeUpload.cleanupIntent': 1, 'youtubeUpload.cleanupClaimedAt': 1 } });
          if (done) repaired += 1;
        } else {
          // Only recovery owns this intent now; no deletion can be resumed by
          // the expired owner. Never cancel from a pre-takeover file snapshot.
          await model.findOneAndUpdate(filter,
            { $unset: { 'youtubeUpload.cleanupIntent': 1, 'youtubeUpload.cleanupClaimedAt': 1 } });
        }
      } catch { unresolved += 1; }
    }
  }
  return { repaired, unresolved };
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

module.exports = { CLEANUP_LEASE_MS, cleanupStorageKey, repairCleanupIntents, claimCleanupSource, deleteCleanupSource, discardUnreferencedUpload, inspectCleanupSource, loadLocalFileReferences, matchesSourceSnapshot, sourceSnapshot };
