const env = require('../config/env');

const pendingJobs = [];
const queuedKeys = new Set();
const activeKeys = new Set();

function snapshot() {
  return {
    concurrency: env.videoProcessingConcurrency,
    active: activeKeys.size,
    queued: pendingJobs.length,
    activeVideoIds: [...activeKeys],
    queuedVideoIds: pendingJobs.map((job) => job.key),
  };
}

function finishJob(key) {
  activeKeys.delete(key);
  drain();
}

function drain() {
  while (activeKeys.size < env.videoProcessingConcurrency && pendingJobs.length) {
    const job = pendingJobs.shift();
    queuedKeys.delete(job.key);
    activeKeys.add(job.key);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      finishJob(job.key);
    };

    try {
      job.start(done);
    } catch (error) {
      Promise.resolve(job.onStartError?.(error)).finally(done);
    }
  }
}

function enqueueVideoProcessing({ videoId, start, onStartError = null }) {
  const key = String(videoId || '').trim();
  if (!key || typeof start !== 'function') {
    throw new TypeError('A videoId and start callback are required.');
  }
  if (queuedKeys.has(key) || activeKeys.has(key)) {
    return { accepted: false, duplicate: true, ...snapshot() };
  }

  queuedKeys.add(key);
  pendingJobs.push({ key, start, onStartError });
  drain();
  return { accepted: true, duplicate: false, ...snapshot() };
}

function getVideoProcessingQueueSnapshot() {
  return snapshot();
}

function resetVideoProcessingQueueForTests() {
  pendingJobs.length = 0;
  queuedKeys.clear();
  activeKeys.clear();
}

module.exports = {
  enqueueVideoProcessing,
  getVideoProcessingQueueSnapshot,
  resetVideoProcessingQueueForTests,
};
