const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Worker = require('../models/recutWorker.model');
const Job = require('../models/recutRenderJob.model');
const ShortScript = require('../models/shortScript.model');
const Version = require('../models/recutVersion.model');
const Approval = require('../models/recutApproval.model');
const ShortAsset = require('../models/shortAsset.model');
const Source = require('../models/recutSource.model');
const Video = require('../models/video.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { withRecutTransition, recutSnapshot } = require('./recutState.service');
const { inspectLocalUploadFile } = require('../utils/localVideoSource');
const { discardUnreferencedUpload } = require('./localSourceCleanup.service');
const { classifyRenderChecks } = require('./recutRenderChecks.service');
const LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const digest = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const same = (a, b) => a != null && b != null && String(a) === String(b);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const planHash = (version) => digest(JSON.stringify(canonical({ plan: version.plan, shortRenderVersion: version.shortRenderVersion, assetVersions: version.assetVersions })));
function error(message, code = 'RECUT_WORKER_CONFLICT', status = 409) { return new AppError(message, status, code); }
const publicWorker = (worker) => ({ id: String(worker._id), name: worker.name, isActive: worker.isActive,
  accepting: worker.accepting, activeJobId: worker.activeJobId ? String(worker.activeJobId) : null, lastSeenAt: worker.lastSeenAt || null });
async function createWorker({ user, name }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw error('name must be 1-120 characters.', 'VALIDATION_ERROR', 400);
  const _id = new mongoose.Types.ObjectId(); const secret = crypto.randomBytes(32).toString('base64url');
  const key = `rw_${_id}.${secret}`;
  await require('./adminAudit.service').audit(user.id, 'recut_worker_create', 'success', String(_id));
  const worker = await Worker.create({ _id, name: name.trim(), keyHash: digest(key), createdBy: user.id });
  return { ...publicWorker(worker), key };
}
async function listWorkers() { return { items: (await Worker.find().sort({ createdAt: 1 }).lean()).map(publicWorker) }; }
async function updateWorker({ user, workerId, accepting, isActive }) {
  assertObjectId(workerId, 'worker');
  if ((accepting !== undefined && typeof accepting !== 'boolean') || (isActive !== undefined && typeof isActive !== 'boolean')
    || (accepting === undefined && isActive === undefined)) throw error('Boolean accepting or isActive required.', 'VALIDATION_ERROR', 400);
  // Revocation is permanent; issue a fresh one-time key to re-enable a computer.
  if (isActive === true) throw error('Revoked keys cannot be reactivated.', 'VALIDATION_ERROR', 400);
  const existing = await Worker.findById(workerId).lean();
  if (!existing) throw error('Worker not found.', 'RECUT_WORKER_NOT_FOUND', 404);
  await require('./adminAudit.service').audit(user.id, 'recut_worker_update', 'success', `${workerId}:${isActive === false ? 'revoke' : accepting ? 'resume' : 'pause'}`);
  const worker = await Worker.findByIdAndUpdate(workerId, { $set: { ...(accepting !== undefined ? { accepting } : {}), ...(isActive === false ? { isActive: false, accepting: false } : {}) } }, { new: true });
  return publicWorker(worker);
}
async function authenticateWorker(key) {
  const match = /^rw_([a-f\d]{24})\.[A-Za-z\d_-]{43}$/.exec(key || '');
  if (!match) throw error('Invalid worker key.', 'RECUT_WORKER_UNAUTHORIZED', 401);
  const worker = await Worker.findById(match[1]).select('+keyHash').lean();
  const actual = digest(key); const expected = String(worker?.keyHash || '').padEnd(64, '0');
  if (!worker?.isActive || expected.length !== actual.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    throw error('Invalid or revoked worker key.', 'RECUT_WORKER_UNAUTHORIZED', 401);
  }
  return worker;
}
async function approvedVersion(script, versionId) {
  await require('./recutWorkConsent.service').assertScriptConsent(script);
  const snap = recutSnapshot(script);
  if (script.productionMode !== 'recut' || !same(snap.currentVersionId, versionId) || snap.activeTaskId || snap.pendingEditId) throw error('Current recut version changed.');
  const approved = (await Approval.find({ scriptId: script._id, versionId, type: 'script' }).lean()).some((a) => a.approvedAt && a.approvedBy && !a.revokedAt);
  const version = await Version.findById(versionId).lean();
  if (!approved || !version?.plan || !same(version.scriptId, script._id)) throw error('Current script approval is required.');
  return version;
}
async function ensureRenderJob(scriptId) {
  return withRecutTransition(scriptId, async () => {
    const script = await ShortScript.findById(scriptId).lean();
    if (!script || script.recut?.state !== 'render_queued') return null;
    const version = await approvedVersion(script, script.recut.currentVersionId);
    const existing = (await Job.find({ scriptId, versionId: version._id }).lean())[0];
    if (existing && !['failed', 'cancelled', 'succeeded'].includes(existing.status)) return existing;
    if (existing) {
      // Explicit teacher retry reuses the job with a new attempt budget; retain prior attempts.
      return Job.findOneAndUpdate({ _id: existing._id, status: existing.status }, { $set: {
        status: 'queued', attemptCount: 0, excludedWorkerIds: [], error: null, notifiedAt: null,
        queuedAt: new Date(), planHash: planHash(version), workerId: null, leaseHash: null, leaseExpiresAt: null,
      } }, { new: true });
    }
    try { return await Job.create({ scriptId, courseId: script.courseId, versionId: version._id, planHash: planHash(version), queuedAt: new Date() }); }
    catch (err) { if (err.code === 11000) return (await Job.find({ scriptId, versionId: version._id }).lean())[0]; throw err; }
  });
}
async function notifyFailure(job) {
  const script = await ShortScript.findById(job.scriptId).lean();
  const notifications = require('./notification.service');
  await notifications.notifyRecutRenderFailed({ job, script });
  await Job.findByIdAndUpdate(job._id, { $set: { notifiedAt: new Date() } });
}
async function settleFailure(job, { code, message, retryable, checks = null, now = new Date() }) {
  const failed = !retryable || job.attemptCount >= MAX_ATTEMPTS;
  const saved = await Job.findOneAndUpdate({ _id: job._id, status: 'leased', leaseHash: job.leaseHash, workerId: job.workerId }, {
    $set: { status: failed ? 'failed' : 'queued', error: { code, message: String(message || code).slice(0, 500) }, checks,
      workerId: null, leaseHash: null, leaseExpiresAt: null, ...(failed ? { finishedAt: now } : {}) },
    $push: { attempts: { workerId: job.workerId, at: now, code, checks }, excludedWorkerIds: job.workerId },
  }, { new: true });
  if (!saved) return null;
  await Worker.findOneAndUpdate({ _id: job.workerId, activeJobId: job._id }, { $set: { activeJobId: null } });
  await withRecutTransition(job.scriptId, async (transition) => {
    const script = await ShortScript.findById(job.scriptId).lean();
    if (!same(script?.recut?.currentVersionId, job.versionId) || script.recut.state !== 'rendering') return;
    await transition({ event: failed ? 'render_failed' : 'requeue_render', versionId: job.versionId });
  });
  if (failed) await notifyFailure(saved);
  return saved;
}
async function recoverRenderJobs({ now = new Date() } = {}) {
  for (const job of await Job.find({ status: 'leased', leaseExpiresAt: { $lte: now } }).select('+leaseHash').lean()) {
    await settleFailure(job, { code: 'RECUT_LEASE_EXPIRED', message: 'Worker lease expired.', retryable: true, now });
  }
  for (const job of await Job.find({ status: 'completing' }).select('+leaseHash').lean()) await finalizeCompletion(job);
  // Repair a crash after reserving the worker but before attaching its job.
  for (const worker of await Worker.find({ activeJobId: { $ne: null } }).lean()) {
    const job = await Job.findById(worker.activeJobId).lean();
    if ((!job || !['leased', 'completing'].includes(job.status) || !same(job.workerId, worker._id))
      && (!same(worker.activeJobId, worker._id) || !worker.reservedAt || now - new Date(worker.reservedAt) >= LEASE_MS)) await Worker.findOneAndUpdate({ _id: worker._id, activeJobId: worker.activeJobId }, { $set: { activeJobId: null } });
  }
  for (const script of await ShortScript.find({ productionMode: 'recut', 'recut.state': 'render_queued' }).lean()) await ensureRenderJob(script._id);
  for (const job of await Job.find({ status: 'failed', notifiedAt: null }).lean()) await notifyFailure(job);
}
async function claimRenderJob({ worker, shortRenderVersion, assetVersions, now = new Date() }) {
  await recoverRenderJobs({ now });
  const reserved = await Worker.findOneAndUpdate({ _id: worker._id, isActive: true, accepting: true, activeJobId: null }, { $set: { activeJobId: worker._id, lastSeenAt: now, reservedAt: now } }, { new: true });
  if (!reserved) return null;
  let claimed = null;
  try {
    for (const job of await Job.find({ status: 'queued' }).sort({ queuedAt: 1, _id: 1 }).lean()) {
      if (job.excludedWorkerIds?.some((id) => same(id, worker._id))) continue;
      const result = await withRecutTransition(job.scriptId, async (transition) => {
        const script = await ShortScript.findById(job.scriptId).lean();
        if (!script || script.recut?.state !== 'render_queued') return null;
        const version = await approvedVersion(script, job.versionId);
        if (planHash(version) !== job.planHash) throw error('Plan version changed.');
        if (shortRenderVersion !== version.shortRenderVersion || JSON.stringify(canonical(assetVersions)) !== JSON.stringify(canonical(version.assetVersions))) {
          await require('./notification.service').notifyYouTubeSystemEvent({ dedupeKey: `recut_version_mismatch:${worker._id}:${job._id}:${job.planHash}`,
            title: 'recut worker 版本不符', content: `worker「${worker.name}」與施工單版本不符，未開始渲染。` });
          throw error('Worker renderer or material version does not match the approved plan.', 'RECUT_RENDER_VERSION_MISMATCH');
        }
        const leaseToken = crypto.randomBytes(32).toString('base64url');
        const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
        claimed = await Job.findOneAndUpdate({ _id: job._id, status: 'queued', attemptCount: job.attemptCount }, { $set: {
          status: 'leased', workerId: worker._id, leaseHash: digest(leaseToken), leaseExpiresAt,
        }, $inc: { attemptCount: 1 } }, { new: true });
        if (!claimed) return null;
        const attached = await Worker.findOneAndUpdate({ _id: worker._id, isActive: true, activeJobId: worker._id }, { $set: { activeJobId: job._id } });
        if (!attached) throw error('Worker was revoked or reservation changed.', 'RECUT_WORKER_UNAUTHORIZED', 401);
        await transition({ event: 'start_render', versionId: version._id });
        return { jobId: String(job._id), scriptId: String(script._id), versionId: String(version._id), planHash: job.planHash,
          plan: version.plan, source: await Source.findById(version.sourceId).select('videoId startSec endSec sentences').lean(), shortRenderVersion: version.shortRenderVersion, assetVersions: version.assetVersions, leaseToken, leaseExpiresAt };
      });
      if (result) return result;
    }
    return null;
  } catch (err) {
    if (claimed) await settleFailure(claimed, { code: err.code || 'RECUT_CLAIM_FAILED', message: err.message, retryable: true, now });
    throw err;
  } finally {
    if (!claimed) await Worker.findOneAndUpdate({ _id: worker._id, activeJobId: worker._id }, { $set: { activeJobId: null } });
  }
}
async function ownedLease({ worker, jobId, leaseToken, now = new Date() }) {
  assertObjectId(jobId, 'render job');
  const freshWorker = await Worker.findById(worker._id).lean();
  const job = await Job.findById(jobId).select('+leaseHash').lean();
  if (!freshWorker?.isActive || !job || job.status !== 'leased' || !same(job.workerId, worker._id)
    || !same(freshWorker.activeJobId, job._id) || job.leaseHash !== digest(leaseToken) || new Date(job.leaseExpiresAt) <= now) throw error('Render lease expired or changed.', 'RECUT_LEASE_INVALID');
  return job;
}
async function heartbeat(options) {
  const now = options.now || new Date(); const job = await ownedLease({ ...options, now });
  const script = await ShortScript.findById(job.scriptId).lean();
  await approvedVersion(script, job.versionId);
  const saved = await Job.findOneAndUpdate({ _id: job._id, status: 'leased', workerId: options.worker._id, leaseHash: job.leaseHash, leaseExpiresAt: { $gt: now } }, {
    $set: { leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  }, { new: true });
  if (!saved) throw error('Render lease changed.', 'RECUT_LEASE_INVALID');
  await Worker.findByIdAndUpdate(options.worker._id, { $set: { lastSeenAt: now } });
  return { leaseExpiresAt: saved.leaseExpiresAt };
}
async function sourceFile(options) {
  const job = await ownedLease(options); const script = await ShortScript.findById(job.scriptId).lean();
  const version = await approvedVersion(script, job.versionId);
  const source = await Source.findById(version.sourceId).lean(); const video = source && await Video.findById(source.videoId).lean();
  const file = video?.filePath && inspectLocalUploadFile(video.filePath);
  if (!file?.safe || !file.exists) throw error('Original source is unavailable.', 'RECUT_SOURCE_UNAVAILABLE');
  return file.localPath;
}
async function failRender(options) {
  const job = await ownedLease(options); const { code, message, checks } = options;
  const version = await Version.findById(job.versionId).lean();
  const classification = checks ? classifyRenderChecks(checks, await require('./recutRenderSpec.service').renderSpecification(version)) : null;
  const retryable = classification ? classification.retryable : ['RECUT_RENDER_TRANSIENT', 'RECUT_FONT_NOT_LOADED', 'RECUT_BLACK_FRAMES'].includes(code);
  return settleFailure(job, { code: String(code || 'RECUT_RENDER_FAILED').slice(0, 100), message, checks, retryable, now: options.now });
}
async function finalizeCompletionOwned(job, transition) {
  const script = await ShortScript.findById(job.scriptId).lean();
  const version = await approvedVersion(script, job.versionId);
  let asset = await ShortAsset.findById(job.resultAssetId).lean();
  if (!asset) {
    const file = inspectLocalUploadFile(job.filePath);
    if (!file.safe || !file.exists) throw error('Accepted render file is missing.', 'RECUT_SOURCE_UNAVAILABLE');
    const source = await Source.findById(version.sourceId).lean();
    try {
      asset = await ShortAsset.create({ _id: job.resultAssetId, courseId: script.courseId, sourceScriptId: script._id,
        sourceVideoId: source.videoId, recutVersionId: version._id, generationVersion: 1, title: script.topic,
        filePath: job.filePath, status: 'draft', reviewStatus: 'pending',
        disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true, confirmedBy: script.createdBy, confirmedAt: new Date() } });
    } catch (err) { if (err.code !== 11000) throw err; asset = await ShortAsset.findById(job.resultAssetId).lean(); }
  }
  if (script.recut.state === 'rendering') await transition({ event: 'attach_asset', versionId: version._id, assetId: asset._id, generationVersion: 1 });
  else if (!same(script.recut.currentAssetId, asset._id)) throw error('Accepted render no longer owns the script.');
  const saved = await Job.findOneAndUpdate({ _id: job._id, status: 'completing', resultAssetId: asset._id }, {
    $set: { status: 'succeeded', finishedAt: new Date(), leaseHash: null },
    $push: { attempts: { workerId: job.workerId, at: new Date(), code: 'succeeded', checks: job.checks } },
  }, { new: true });
  if (!saved) throw error('Render completion changed.');
  await Worker.findOneAndUpdate({ _id: job.workerId, activeJobId: job._id }, { $set: { activeJobId: null } });
  return { assetId: String(asset._id), status: 'asset_review' };
}
const finalizeCompletion = (job) => withRecutTransition(job.scriptId, (transition) => finalizeCompletionOwned(job, transition));
async function completeRender(options) {
  const { file, metadata } = options;
  let accepted = false;
  try {
    const job = await ownedLease(options);
    return await withRecutTransition(job.scriptId, async (transition) => {
      const currentJob = await ownedLease(options); const script = await ShortScript.findById(job.scriptId).lean();
      const version = await approvedVersion(script, job.versionId);
        if (script.recut.state !== 'rendering' || !metadata || metadata.versionId !== String(version._id) || metadata.planHash !== job.planHash
        || metadata.shortRenderVersion !== version.shortRenderVersion || JSON.stringify(canonical(metadata.assetVersions)) !== JSON.stringify(canonical(version.assetVersions))) throw error('Render result version mismatch.', 'RECUT_RENDER_VERSION_MISMATCH');
      if ((metadata.planVersion !== undefined && metadata.planVersion !== version.plan.schemaVersion)
        || (metadata.renderDurationMs !== undefined && (!Number.isSafeInteger(metadata.renderDurationMs) || metadata.renderDurationMs < 0))) {
        throw error('Render metadata version or duration is invalid.', 'RECUT_RENDER_VERSION_MISMATCH');
      }
      const specification = await require('./recutRenderSpec.service').renderSpecification(version);
      const classification = classifyRenderChecks(metadata.checks, specification);
      if (!classification.valid) throw error(`Render checks failed: ${classification.issues.join(',')}`, 'RECUT_RENDER_CHECK_FAILED');
      const local = file?.path && inspectLocalUploadFile(file.path);
      if (!local?.safe || !local.exists || local.sizeBytes <= 0) throw error('A nonempty owned MP4 is required.', 'VALIDATION_ERROR', 400);
      // A durable completing record owns the output across crashes. Recovery resumes
      // asset creation/linking; it never reassigns an accepted output to another worker.
      const completed = await Job.findOneAndUpdate({ _id: currentJob._id, status: 'leased', workerId: options.worker._id,
        leaseHash: currentJob.leaseHash, leaseExpiresAt: { $gt: new Date() } }, { $set: {
        status: 'completing', checks: metadata.checks, filePath: file.path, resultAssetId: new mongoose.Types.ObjectId(),
        planVersion: metadata.planVersion || version.plan.schemaVersion, renderDurationMs: metadata.renderDurationMs ?? null,
      } }, { new: true });
      if (!completed) throw error('Render lease changed.', 'RECUT_LEASE_INVALID');
      accepted = true;
      return finalizeCompletionOwned(completed, transition);
    });
  } catch (err) {
    if (!accepted) {
      await discardUnreferencedUpload(file);
      if (err.code === 'RECUT_RENDER_CHECK_FAILED') await failRender({ ...options, code: err.code, message: err.message, checks: metadata.checks });
    }
    throw err;
  }
}
module.exports = { LEASE_MS, MAX_ATTEMPTS, digest, planHash, publicWorker, createWorker, listWorkers, updateWorker,
  finalizeCompletion, authenticateWorker, ensureRenderJob, recoverRenderJobs, claimRenderJob, ownedLease, heartbeat, sourceFile, failRender, completeRender };
