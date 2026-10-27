const { randomUUID } = require('node:crypto');
const Job = require('../models/courseDeletionJob.model');
const { isFocusFlowUploadedVideo, isPrivatizeOnDeleteConfigured, privatizeVideoOnDelete } = require('./youtubeUpload.service');
const { reserveYouTubeBackup } = require('./youtubeWorkOwnership.service');

const JOB_LEASE_MS = 120_000;
const RETRY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
let timer;
let scheduledRun;

async function enqueueCourseDeletionJobs(courseId, videos, session) {
  const uploaded = videos.filter(isFocusFlowUploadedVideo);
  // Backfill legacy ownership in the same transaction. Delayed privacy work
  // must never target an ID reassigned to other content after its Video is gone.
  for (const video of uploaded) await reserveYouTubeBackup(video.youtubeVideoId, 'video', video, { session });
  const ids = [...new Set(uploaded.map((video) => video.youtubeVideoId))];
  if (!ids.length) return;
  await Job.insertMany(ids.map((youtubeVideoId) => ({ _id: `${courseId}:${youtubeVideoId}`, courseId, youtubeVideoId, status: 'pending' })),
    { session, ordered: true });
}

async function privatizeWithDeadline(job, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let deadline;
  try {
    // Bound the entire token + privacy + response-body operation. A timeout
    // returns this job to pending so one hung provider cannot pin the scheduler.
    // Race as well as abort: a late reply cannot acknowledge an expired attempt.
    const expired = new Promise((_, reject) => {
      deadline = setTimeout(() => {
        const error = new Error('YouTube privacy update timed out.');
        controller.abort(error); reject(error);
      }, timeoutMs);
    });
    const boundedFetch = (url, options = {}) => {
      controller.signal.throwIfAborted();
      const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
      return fetchImpl(url, { ...options, signal });
    };
    return await Promise.race([expired, privatizeVideoOnDelete({ youtubeVideoId: job.youtubeVideoId,
      youtubeUpload: { status: 'uploaded' } }, { fetchImpl: boundedFetch })]);
  } finally { clearTimeout(deadline); }
}

async function runCourseDeletionJobs({ courseId, fetchImpl = global.fetch, limit = 10, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (!isPrivatizeOnDeleteConfigured()) return { completed: 0, deferred: true };
  let completed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await Job.findOneAndUpdate({ ...(courseId ? { courseId } : {}), $or: [
      { status: 'pending', $or: [{ nextAttemptAt: null }, { $expr: { $lte: ['$nextAttemptAt', '$$NOW'] } }] },
      { status: 'running', $expr: { $lte: ['$claimedAt', { $subtract: ['$$NOW', JOB_LEASE_MS] }] } },
    ] }, { $set: { status: 'running', attemptId: randomUUID() }, $inc: { attemptCount: 1 }, $currentDate: { claimedAt: true } },
    { new: true, sort: { nextAttemptAt: 1, _id: 1 } });
    if (!job) break;
    const owner = { _id: job._id, status: 'running', attemptId: job.attemptId };
    try {
      // Repeating private is safe after an ambiguous reply or process death.
      // Never execute this in the course transaction: abort cannot undo YouTube.
      const result = await privatizeWithDeadline(job, fetchImpl, requestTimeoutMs);
      if (!result) throw new Error('YouTube privacy update is not confirmed.');
      const done = await Job.findOneAndUpdate(owner, { $set: { status: 'completed', completedAt: new Date(), lastError: null } });
      if (done) completed += 1;
    } catch {
      // If this write also fails the running lease remains recoverable. Keep a
      // generic diagnostic rather than persisting provider response bodies.
      await Job.findOneAndUpdate(owner, { $set: { status: 'pending', nextAttemptAt: new Date(Date.now() + RETRY_MS),
        lastError: 'YouTube privacy update is not confirmed; retry pending.' } });
    }
  }
  return { completed, deferred: false };
}

function startCourseDeletionJobScheduler() {
  if (timer) return;
  const run = () => {
    if (scheduledRun) return;
    scheduledRun = runCourseDeletionJobs().catch(() => {
      console.error('[courseDeletion] persisted privacy work will be retried.');
    }).finally(() => { scheduledRun = null; });
  };
  run(); timer = setInterval(run, RETRY_MS); timer.unref?.();
}
function stopCourseDeletionJobScheduler() { clearInterval(timer); timer = null; }

module.exports = { JOB_LEASE_MS, enqueueCourseDeletionJobs, runCourseDeletionJobs, startCourseDeletionJobScheduler, stopCourseDeletionJobScheduler };
