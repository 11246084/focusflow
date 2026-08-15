const path = require('path');
const { spawn } = require('child_process');
const {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  writeFileSync,
} = require('fs');
const env = require('../config/env');
const AppError = require('../utils/appError');
const Video = require('../models/video.model');
const { VIDEO_PROCESSING_STATUSES } = require('../constants/enums');
const { failVideoProcessing } = require('./videoProcessing.service');
const {
  attachSttProcessLifecycle,
  buildSttProcessEnvironment,
} = require('./sttProcessLifecycle.service');

const runningBatchProcesses = new Map();

// This adapter owns only the local process boundary. Durable status remains in
// MongoDB/manifest records so a Backend restart can reconcile safely.

function isSameOrDescendant(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveSttPython(sttDir) {
  const venvPython = process.platform === 'win32'
    ? path.join(sttDir, '.venv', 'Scripts', 'python.exe')
    : path.join(sttDir, '.venv', 'bin', 'python');
  if (existsSync(venvPython)) return venvPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function buildBatchRequest(batchId, items) {
  const normalizedItems = (items || []).map((item) => {
    const videoPath = path.resolve(String(item.videoPath || ''));
    if (!isSameOrDescendant(env.uploadDir, videoPath)) {
      throw new AppError(
        'Batch video path must stay under UPLOAD_DIR.',
        500,
        'VIDEO_BATCH_SCHEDULE_FAILED',
      );
    }
    return {
      itemId: String(item.itemId || ''),
      videoId: String(item.videoId || ''),
      videoPath,
    };
  });
  if (!normalizedItems.length || normalizedItems.some((item) => !item.itemId || !item.videoId)) {
    throw new AppError('Batch has no schedulable items.', 500, 'VIDEO_BATCH_SCHEDULE_FAILED');
  }
  return { version: 1, batchId, items: normalizedItems };
}

function writeBatchRequest(sttDir, request) {
  const requestDir = path.join(sttDir, 'data', 'batch_requests');
  mkdirSync(requestDir, { recursive: true });
  const requestPath = path.join(requestDir, `${request.batchId}.json`);
  const temporaryPath = `${requestPath}.${process.pid}.tmp`;
  // Publish atomically so the Pipeline never reads a partially written request.
  writeFileSync(temporaryPath, JSON.stringify(request, null, 2), { encoding: 'utf8', flag: 'wx' });
  renameSync(temporaryPath, requestPath);
  return requestPath;
}

async function markUnexpectedBatchExitFailed(videoIds, failure) {
  for (const videoId of videoIds) {
    const video = await Video.findById(videoId);
    if ([VIDEO_PROCESSING_STATUSES.QUEUED, VIDEO_PROCESSING_STATUSES.PROCESSING]
      .includes(video?.processing?.status)) {
      await failVideoProcessing(videoId, failure);
    }
  }
}

function spawnBatchProcess({ batchId, args, videoIds, leaseConflictIsSuccess = true }) {
  const existing = runningBatchProcesses.get(batchId);
  if (existing) {
    return { pid: existing.pid || null, alreadyRunning: true };
  }
  if (!env.processingWebhookSecret) {
    throw new AppError(
      'Processing webhook secret is required for batch scheduling.',
      500,
      'VIDEO_BATCH_SCHEDULE_FAILED',
    );
  }
  const sttDir = path.resolve(env.projectRoot, '../STT_Whisper');
  const logDir = path.join(sttDir, 'data');
  mkdirSync(logDir, { recursive: true });
  const logFd = openSync(path.join(logDir, `pipeline_batch_${batchId}.log`), 'a');
  let sttProcess;
  try {
    sttProcess = spawn(resolveSttPython(sttDir), ['src/batch_main.py', '--project-root', sttDir, ...args], {
      cwd: sttDir,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      env: buildSttProcessEnvironment(process.env, {
        MONGODB_URI: env.mongodbUri,
        MONGODB_DATABASE_NAME: 'focusflow',
        BACKEND_URL: `http://localhost:${env.port}`,
        PROCESSING_WEBHOOK_SECRET: env.processingWebhookSecret,
        CLEANUP_AFTER_UPLOAD: 'true',
        CLEANUP_KEEP_CHECKPOINTS: 'false',
      }),
    });
  } catch (error) {
    closeSync(logFd);
    throw error;
  }
  runningBatchProcesses.set(batchId, sttProcess);
  attachSttProcessLifecycle({
    sttProcess,
    logFd,
    videoId: batchId,
    onUnexpectedExit: (failure) => markUnexpectedBatchExitFailed(videoIds, failure),
    // 1 is a terminal partial/failed batch whose item webhooks already carry
    // the real errors. 75 means another live process owns the batch lease.
    successfulExitCodes: leaseConflictIsSuccess ? [0, 1, 75] : [0, 1],
    onClose: () => {
      if (runningBatchProcesses.get(batchId) === sttProcess) {
        runningBatchProcesses.delete(batchId);
      }
    },
  });
  return { pid: sttProcess.pid || null, alreadyRunning: false };
}

function scheduleVideoBatchProcessing({ batchId, items }) {
  const sttDir = path.resolve(env.projectRoot, '../STT_Whisper');
  const request = buildBatchRequest(batchId, items);
  const requestPath = writeBatchRequest(sttDir, request);
  const result = spawnBatchProcess({
    batchId,
    args: ['--batch-request', requestPath],
    videoIds: request.items.map((item) => item.videoId),
  });
  return { requestPath, ...result };
}

function buildBatchResumeArgs(batchId, retryVideoIds = []) {
  const args = ['--batch-resume', batchId];
  for (const videoId of retryVideoIds) {
    args.push('--batch-retry-video-id', String(videoId));
  }
  return args;
}

function scheduleVideoBatchResume({ batchId, videoIds, retryVideoIds = [] }) {
  return spawnBatchProcess({
    batchId,
    args: buildBatchResumeArgs(batchId, retryVideoIds),
    videoIds,
    leaseConflictIsSuccess: retryVideoIds.length === 0,
  });
}

function isVideoBatchProcessRunning(batchId) {
  return runningBatchProcesses.has(batchId);
}

module.exports = {
  buildBatchResumeArgs,
  buildBatchRequest,
  isSameOrDescendant,
  markUnexpectedBatchExitFailed,
  resolveSttPython,
  isVideoBatchProcessRunning,
  scheduleVideoBatchProcessing,
  scheduleVideoBatchResume,
  spawnBatchProcess,
  writeBatchRequest,
};
