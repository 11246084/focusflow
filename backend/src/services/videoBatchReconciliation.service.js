const path = require('path');
const { readFileSync } = require('fs');
const env = require('../config/env');
const Video = require('../models/video.model');
const VideoBatch = require('../models/videoBatch.model');
const {
  VIDEO_BATCH_STATUSES,
  VIDEO_PROCESSING_STATUSES,
} = require('../constants/enums');
const videoProcessingService = require('./videoProcessing.service');
const videoBatchProcessingService = require('./videoBatchProcessing.service');
const { syncBatchStatus, validateBatchId } = require('./videoBatch.service');

let reconciliationTimer = null;

// Reconciliation treats the Pipeline manifest as an external handoff: identity
// and cardinality are verified before any Video state transition is applied.

function isSameOrDescendant(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveBatchManifestPath(batchId) {
  const normalized = validateBatchId(batchId);
  const batchesRoot = path.resolve(env.projectRoot, '../STT_Whisper/data/outputs/batches');
  const manifestPath = path.resolve(batchesRoot, normalized, 'batch_manifest.json');
  if (!isSameOrDescendant(batchesRoot, manifestPath)) {
    throw new Error('Batch manifest path escaped the configured output root.');
  }
  return manifestPath;
}

function readBatchManifest(batchId) {
  const payload = JSON.parse(readFileSync(resolveBatchManifestPath(batchId), 'utf8'));
  if (payload.batch_id !== batchId || !Array.isArray(payload.items)) {
    throw new Error('Batch manifest identity or items are invalid.');
  }
  return payload;
}

function safeManifestFailure(item) {
  const errorCode = String(item.last_error_code || 'PIPELINE_BATCH_ITEM_FAILED').slice(0, 100);
  const errorMessage = String(item.last_error_message || 'Video batch item failed.').slice(0, 300);
  return { errorCode, errorMessage };
}

async function reconcileVideoBatchFromManifest(batch, manifest) {
  const batchItems = new Map(
    (batch.items || [])
      .filter((item) => item.videoId)
      .map((item) => [String(item.itemId), String(item.videoId)]),
  );
  // Validate all entries first. This prevents a forged or stale manifest from
  // partially mutating a legitimate Backend batch.
  const seenVideoIds = new Set();
  const validatedItems = manifest.items.map((item) => {
    const expectedVideoId = batchItems.get(String(item.item_id || ''));
    const manifestVideoId = String(item.requested_video_id || item.video_id || '');
    if (!expectedVideoId || manifestVideoId !== expectedVideoId || seenVideoIds.has(expectedVideoId)) {
      throw new Error('Batch manifest item does not match the Backend batch contract.');
    }
    seenVideoIds.add(expectedVideoId);
    return { item, expectedVideoId };
  });
  if (seenVideoIds.size !== batchItems.size) {
    throw new Error('Batch manifest does not contain every Backend batch item.');
  }

  for (const { item, expectedVideoId } of validatedItems) {
    const video = await Video.findById(expectedVideoId);
    if (!video) continue;
    const currentStatus = video.processing?.status;

    if (item.status === 'running' && currentStatus === VIDEO_PROCESSING_STATUSES.QUEUED) {
      await videoProcessingService.startVideoProcessing(expectedVideoId);
    } else if (item.status === 'completed') {
      if (currentStatus === VIDEO_PROCESSING_STATUSES.QUEUED) {
        await videoProcessingService.startVideoProcessing(expectedVideoId);
      }
      const refreshed = await Video.findById(expectedVideoId);
      if (refreshed?.processing?.status === VIDEO_PROCESSING_STATUSES.PROCESSING) {
        await videoProcessingService.completeVideoProcessing(expectedVideoId);
      }
    } else if (['failed', 'skipped'].includes(item.status)
      && [VIDEO_PROCESSING_STATUSES.QUEUED, VIDEO_PROCESSING_STATUSES.PROCESSING].includes(currentStatus)) {
      await videoProcessingService.failVideoProcessing(expectedVideoId, safeManifestFailure(item));
    }
  }

  return syncBatchStatus(batch);
}

async function reconcileActiveVideoBatches() {
  if (!env.videoBatchPipelineEnabled) return [];
  const batches = await VideoBatch.find({
    processingMode: 'pipeline_batch',
    status: { $in: [VIDEO_BATCH_STATUSES.CREATING, VIDEO_BATCH_STATUSES.PROCESSING] },
  });
  const results = [];
  for (const batch of batches) {
    try {
      const manifest = readBatchManifest(batch.batchId);
      const presentation = await reconcileVideoBatchFromManifest(batch, manifest);
      const terminal = ['completed', 'partial', 'failed'].includes(manifest.status);
      // A non-terminal manifest with no local child is resumed from its durable
      // checkpoint; the Pipeline lease prevents duplicate executors.
      if (!terminal && !videoBatchProcessingService.isVideoBatchProcessRunning(batch.batchId)) {
        videoBatchProcessingService.scheduleVideoBatchResume({
          batchId: batch.batchId,
          videoIds: (batch.items || []).map((item) => String(item.videoId || '')).filter(Boolean),
        });
      }
      results.push({ batchId: batch.batchId, status: presentation.status, reconciled: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        results.push({ batchId: batch.batchId, reconciled: false, reason: 'manifest_not_ready' });
      } else {
        console.error(`Video batch reconciliation failed for ${batch.batchId}.`, error);
        results.push({ batchId: batch.batchId, reconciled: false, reason: 'invalid_or_unreadable_manifest' });
      }
    }
  }
  return results;
}

function startVideoBatchReconciliationScheduler() {
  if (!env.videoBatchPipelineEnabled) return;
  reconcileActiveVideoBatches().catch((error) => {
    console.error('Initial video batch reconciliation failed.', error);
  });
  if (env.videoBatchReconcileIntervalMs > 0 && !reconciliationTimer) {
    reconciliationTimer = setInterval(() => {
      reconcileActiveVideoBatches().catch((error) => {
        console.error('Scheduled video batch reconciliation failed.', error);
      });
    }, env.videoBatchReconcileIntervalMs);
    reconciliationTimer.unref?.();
  }
}

function stopVideoBatchReconciliationScheduler() {
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  reconciliationTimer = null;
}

module.exports = {
  isSameOrDescendant,
  readBatchManifest,
  reconcileActiveVideoBatches,
  reconcileVideoBatchFromManifest,
  resolveBatchManifestPath,
  startVideoBatchReconciliationScheduler,
  stopVideoBatchReconciliationScheduler,
};
