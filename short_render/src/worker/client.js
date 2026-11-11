'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { resolvePlan, validatePlan, SHORT_RENDER_VERSION, ASSET_VERSIONS } = require('../plan');
const { createHttpClient, safeJobId, workerError } = require('./http');
const { classifyChecks } = require('./checks');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const jobPlanHash = (job) => crypto.createHash('sha256').update(JSON.stringify(canonical({
  plan: job.plan, shortRenderVersion: job.shortRenderVersion, assetVersions: job.assetVersions,
}))).digest('hex');
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function validateJob(job) {
  safeJobId(job?.jobId); safeJobId(job?.scriptId); safeJobId(job?.versionId);
  if (typeof job.leaseToken !== 'string' || !/^[A-Za-z\d_-]{43}$/.test(job.leaseToken)
    || !Number.isFinite(Date.parse(job.leaseExpiresAt))) throw workerError('RECUT_JOB_INVALID');
  if (job.shortRenderVersion !== SHORT_RENDER_VERSION || !same(job.assetVersions, ASSET_VERSIONS)
    || job.plan?.versions?.shortRender !== job.shortRenderVersion || !same(job.plan?.versions?.assets, job.assetVersions)) {
    throw workerError('RECUT_RENDER_VERSION_MISMATCH');
  }
  if (job.planHash !== jobPlanHash(job)) throw workerError('RECUT_PLAN_HASH_MISMATCH');
  if (String(job.source?.videoId) !== job.plan?.source?.videoId) throw workerError('RECUT_SOURCE_MISMATCH');
  const { resolved, errors } = resolvePlan(job.plan, { sentences: job.source?.sentences });
  if (errors.length || !validatePlan(job.plan, { sentences: job.source?.sentences, evidence: job.source, resolved }).valid) {
    throw workerError('RECUT_PLAN_INVALID');
  }
  return resolved;
}
function createWorker(config, { api = createHttpClient(config), loadRenderer = () => require('./render').createRenderer(config),
  now = Date.now, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
  // Windows 上剛結束的 Chrome／ffmpeg 可能還握著檔案（EBUSY、EPERM），刪除時重試幾次。
  removeDirectory = (target) => fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } = {}) {
  const { workRoot, heartbeatMs = 60000, jobTimeoutMs = 30 * 60000, pollMs = 10000, hostKind = 'desktop', enableVmRender = false } = config;
  if (typeof workRoot !== 'string' || !path.isAbsolute(workRoot)
    || ![heartbeatMs, jobTimeoutMs, pollMs].every((v) => Number.isSafeInteger(v) && v > 0)
    || heartbeatMs > 60000 || !['desktop', 'vm'].includes(hostKind) || typeof enableVmRender !== 'boolean') throw workerError('RECUT_CONFIG_INVALID');
  let busy = false;
  async function runOnce({ signal } = {}) {
    if (busy) throw workerError('RECUT_WORKER_BUSY');
    if (hostKind === 'vm' && !enableVmRender) return { status: 'disabled' };
    busy = true;
    let job, directory, root, timer, expiryTimer, timeoutTimer, heartbeatPending = Promise.resolve(), lostLease = false, uploading = false;
    const controller = new AbortController();
    const abort = (code) => { if (!controller.signal.aborted) controller.abort(workerError(code)); };
    const onCancel = () => abort('RECUT_RENDER_CANCELLED');
    signal?.addEventListener('abort', onCancel, { once: true });
    function checkLease() {
      controller.signal.throwIfAborted();
      if (Date.parse(job.leaseExpiresAt) <= now()) { lostLease = true; throw workerError('RECUT_LEASE_INVALID'); }
    }
    function expiry() {
      clearTimeout(expiryTimer);
      const remaining = Date.parse(job.leaseExpiresAt) - now();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 10 * 60000 + 1000) {
        lostLease = true; abort('RECUT_LEASE_INVALID'); return;
      }
      expiryTimer = setTimeout(() => { lostLease = true; abort('RECUT_LEASE_INVALID'); }, remaining);
    }
    function heartbeat() {
      heartbeatPending = heartbeatPending.then(async () => {
        checkLease();
        const result = await api.heartbeat(job, controller.signal);
        checkLease();
        // Only the private lease expiry is updated; the captured render job stays frozen.
        job = { ...job, leaseExpiresAt: result?.leaseExpiresAt };
        expiry();
        checkLease();
      }).catch((error) => { lostLease = true; abort(error.code || 'RECUT_LEASE_INVALID'); throw error; });
      heartbeatPending.catch(() => {});
      return heartbeatPending;
    }
    try {
      if (signal?.aborted) onCancel();
      controller.signal.throwIfAborted();
      job = await api.claim(controller.signal);
      if (!job) return { status: 'idle' }; // Admin accepting switch remains authoritative.
      job = structuredClone(job);
      const captured = freeze(structuredClone(job));
      const resolved = validateJob(captured);
      checkLease(); expiry();
      timeoutTimer = setTimeout(() => abort('RECUT_RENDER_TIMEOUT'), jobTimeoutMs);
      timer = setIntervalImpl(() => { if (!controller.signal.aborted) heartbeat().catch(() => {}); }, heartbeatMs);
      await fs.mkdir(workRoot, { recursive: true });
      root = await fs.realpath(workRoot);
      directory = await fs.mkdtemp(path.join(root, 'recut-job-'));
      const sourcePath = path.join(directory, 'source.mp4');
      await api.download(job, sourcePath, controller.signal);
      checkLease();
      const started = now();
      const renderer = await loadRenderer();
      checkLease();
      const output = await renderer({ job: captured, resolved: freeze(resolved), sourcePath, outDir: directory, signal: controller.signal });
      checkLease();
      const realOutput = await fs.realpath(output.filePath);
      const relative = path.relative(directory, realOutput);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !relative.endsWith('.mp4')) throw workerError('RECUT_RESULT_PATH_INVALID');
      const checks = output.checks;
      const classification = classifyChecks(checks, { ...captured.plan.canvas, durationSec: resolved.total });
      if (!classification.valid) throw Object.assign(workerError('RECUT_RENDER_CHECK_FAILED'), { checks });
      await heartbeat(); // Revalidate ownership immediately before submitting.
      checkLease();
      const metadata = { versionId: captured.versionId, planVersion: captured.plan.schemaVersion, planHash: captured.planHash,
        shortRenderVersion: captured.shortRenderVersion, assetVersions: captured.assetVersions, checks,
        renderDurationMs: Math.max(0, Math.round(now() - started)) };
      uploading = true;
      const result = await api.upload(job, realOutput, metadata, controller.signal);
      return { status: 'succeeded', jobId: job.jobId, assetId: result.assetId };
    } catch (error) {
      const code = controller.signal.reason?.code || error.code || 'RECUT_RENDER_FAILED';
      // Upload response uncertainty is resolved by backend recovery, never by a second result/failure.
      if (job && !lostLease && !uploading && Date.parse(job.leaseExpiresAt) > now()) {
        const failureCode = ['RECUT_RENDER_TIMEOUT', 'RECUT_RENDER_CANCELLED', 'RECUT_NETWORK_ERROR', 'RECUT_REQUEST_TIMEOUT_OR_CANCELLED'].includes(code)
          ? 'RECUT_RENDER_TRANSIENT' : code;
        try { await api.fail(job, { code: /^RECUT_[A-Z_]+$/.test(failureCode) ? failureCode : 'RECUT_RENDER_FAILED',
          message: 'Worker stopped; inspect the failure code.', ...(error.checks ? { checks: error.checks } : {}) }); } catch { /* lease/recovery owns retry */ }
      }
      return { status: controller.signal.aborted ? 'cancelled' : 'failed', code: /^RECUT_[A-Z_]+$/.test(code) ? code : 'RECUT_RENDER_FAILED',
        ...(code === 'RECUT_RENDER_VERSION_MISMATCH' ? { action: 'upgrade-worker' } : {}) };
    } finally {
      if (timer !== undefined) clearIntervalImpl(timer);
      clearTimeout(expiryTimer); clearTimeout(timeoutTimer);
      // Drain an in-flight heartbeat before freeing the single-job slot.
      await heartbeatPending.catch(() => {});
      signal?.removeEventListener('abort', onCancel);
      // 清理暫存只是善後：失敗時留下資料夾並記錄，不能蓋掉已經算好的結果，
      // 也不能讓 busy 停在 true（之後每次都會回 RECUT_WORKER_BUSY，worker 等於卡死）。
      try {
        if (directory) {
          const real = await fs.realpath(directory);
          if (path.dirname(real) !== root || !path.basename(real).startsWith('recut-job-')) throw workerError('RECUT_CLEANUP_PATH_INVALID');
          await removeDirectory(real);
        }
      } catch (cleanupError) {
        console.error('[recut-worker] job directory cleanup failed', String(cleanupError?.code || 'ERROR'));
      } finally {
        busy = false;
      }
    }
  }
  async function run({ signal, onStatus = () => {} } = {}) {
    while (!signal?.aborted) {
      const result = await runOnce({ signal }); onStatus(result);
      if (result.status === 'disabled' || ['RECUT_WORKER_UNAUTHORIZED', 'RECUT_RENDER_VERSION_MISMATCH', 'RECUT_WORKER_KEY_INVALID'].includes(result.code)) return result;
      if (signal?.aborted) break;
      try { await delay(pollMs, undefined, { signal }); } catch { break; }
    }
    return { status: 'stopped' };
  }
  return { runOnce, run };
}
module.exports = { createWorker, validateJob, jobPlanHash };
