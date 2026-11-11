'use strict';
const AppError = require('../utils/appError');
const same = (a, b) => a != null && b != null && String(a) === String(b);

function createRecutConsentLifecycle({ queue, setVideoPrivacy = (request) => require('./youtubeUpload.service').setVideoPrivacy(request) } = {}) {
  const Course = require('../models/course.model');
  const Script = require('../models/shortScript.model');
  const Asset = require('../models/shortAsset.model');
  const Job = require('../models/recutRenderJob.model');
  const Worker = require('../models/recutWorker.model');
  async function scopedScripts(scope) {
    const courses = await Course.find({ teacherId: scope.teacherId, ...(scope.courseId ? { _id: scope.courseId } : {}) }).lean();
    const scripts = await Script.find({ courseId: { $in: courses.map((course) => course._id) } }).lean();
    const result = [];
    for (const script of scripts) {
      const recut = script.productionMode === 'recut';
      if (scope.kind === 'voice' && !recut) continue;
      if (['avatarLikeness', 'voiceClone'].includes(scope.kind) && recut) continue;
      if (scope.videoId) {
        const version = script.recut?.currentVersionId && await require('../models/recutVersion.model').findById(script.recut.currentVersionId).lean();
        const source = version && await require('../models/recutSource.model').findById(version.sourceId).lean();
        const evidence = (script.evidence || []).some((item) => same(item.videoId, scope.videoId) || same(item.videoId, scope.sourceId));
        if (!same(source?.videoId, scope.videoId) && !evidence) continue;
      }
      result.push(script);
    }
    return { courses, scripts: result };
  }
  async function scopedAssets(scope, { includeArchived = false } = {}) {
    const { courses, scripts } = await scopedScripts(scope);
    const assets = await Asset.find({ courseId: { $in: courses.map((course) => course._id) },
      ...(!includeArchived ? { status: { $ne: 'archived' } } : {}) }).lean();
    return assets.filter((asset) => scripts.some((script) => same(script._id, asset.sourceScriptId))
      || (scope.kind === 'content' && (!scope.videoId || same(asset.sourceVideoId, scope.videoId))));
  }
  async function assetInScope(id, scope) {
    const asset = (await scopedAssets(scope, { includeArchived: true })).find((item) => same(item._id, id));
    if (!asset) throw new AppError('Withdrawal asset is outside this scope.', 403, 'RECUT_WITHDRAWAL_ASSET_DENIED');
    return asset;
  }
  async function stopWork(scope) {
    const { scripts } = await scopedScripts(scope);
    for (const script of scripts) {
      const tasks = await require('../models/recutTask.model').find({ scriptId: script._id, status: { $in: ['queued', 'running', 'cancel_requested'] } }).lean();
      for (const task of tasks) await (queue || require('./recutQueue.service').recutQueue).requestCancel(task._id);
      await require('./recutState.service').withRecutTransition(script._id, async (transition) => {
        for (const job of await Job.find({ scriptId: script._id, status: { $in: ['queued', 'leased', 'completing'] } }).select('+leaseHash').lean()) {
          const cancelled = await Job.findOneAndUpdate({ _id: job._id, status: job.status, leaseHash: job.leaseHash ?? null },
            { $set: { status: 'cancelled', leaseHash: null, leaseExpiresAt: null, finishedAt: new Date(),
              error: { code: 'RECUT_CONSENT_WITHDRAWN', message: 'Consent was withdrawn.' } } }, { new: true });
          if (cancelled && job.workerId) await Worker.findOneAndUpdate({ _id: job.workerId, activeJobId: job._id }, { $set: { activeJobId: null } });
          if (cancelled && job.resultAssetId) await Asset.findOneAndUpdate({ _id: job.resultAssetId, status: 'draft' }, { $set: {
            status: 'archived', publishedAt: null, consentWithdrawal: { withdrawalId: `consent-stop:${job._id}`, privateRequired: false },
          } });
        }
        if (script.productionMode === 'recut') await transition({ event: 'consent_stop' });
      });
    }
  }
  async function archiveAsset(id, scope, context) {
    const asset = await assetInScope(id, scope);
    const change = async () => {
      await Asset.findOneAndUpdate({ _id: asset._id, generationVersion: asset.generationVersion ?? null }, { $set: {
        status: 'archived', publishedAt: null, 'youtubeUpload.nextRetryAt': null, 'youtubeUpload.retrySafe': false,
        consentWithdrawal: { ...(asset.consentWithdrawal || {}), withdrawalId: context.withdrawalId,
          archiveOperationId: context.operationId,
          privateRequired: Boolean(asset.youtubeVideoId && asset.consentWithdrawal?.privateVideoId !== asset.youtubeVideoId), archivedAt: new Date() },
      } }, { new: true });
    };
    if (asset.sourceScriptId) await require('./recutState.service').withRecutScriptLock(asset.sourceScriptId, change);
    else await change();
  }
  async function privatize(asset, context = {}) {
    if (!asset?.youtubeVideoId) return;
    if (asset.youtubePrivacyStatus === 'private' && asset.consentWithdrawal?.privateVideoId === asset.youtubeVideoId) return;
    await Asset.findByIdAndUpdate(asset._id, { $set: { 'consentWithdrawal.privateRequired': true } });
    try { await setVideoPrivacy({ youtubeVideoId: asset.youtubeVideoId, privacyStatus: 'private', ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}) }); }
    catch (error) {
      await Asset.findByIdAndUpdate(asset._id, { $set: { 'consentWithdrawal.manualActionRequired': true, 'consentWithdrawal.privateFailedAt': new Date() } });
      throw error;
    }
    await Asset.findOneAndUpdate({ _id: asset._id, youtubeVideoId: asset.youtubeVideoId, status: 'archived' }, { $set: {
      youtubePrivacyStatus: 'private', youtubeAvailability: 'unavailable', 'consentWithdrawal.privateRequired': false,
      'consentWithdrawal.manualActionRequired': false,
      'consentWithdrawal.privateVideoId': asset.youtubeVideoId, 'consentWithdrawal.privateOperationId': context.operationId || null,
      'consentWithdrawal.privateAt': new Date(),
    } });
  }
  async function makeYouTubePrivate(id, scope, context) { return privatize(await assetInScope(id, scope), context); }
  async function listAdmins() { return require('../models/user.model').find({ role: 'admin', isActive: true }).select('_id').lean(); }
  async function listManualAssetActions() {
    return (await Asset.find({ status: 'archived', 'consentWithdrawal.privateRequired': true, 'consentWithdrawal.manualActionRequired': true }).lean())
      .map((asset) => ({ id: `${asset.consentWithdrawal.withdrawalId}:private:${asset._id}`, withdrawalId: asset.consentWithdrawal.withdrawalId,
        assetId: String(asset._id), courseId: String(asset.courseId), type: 'makeYouTubePrivate', status: 'failed', manualActionRequired: true }));
  }
  async function notifyAdmin(id, payload, context) {
    await require('../models/notification.model').bulkWrite([{ updateOne: { filter: { recipientId: id, dedupeKey: context.operationId },
      update: { $setOnInsert: { recipientId: id, dedupeKey: context.operationId, source: 'system_maintenance', title: '短片撤回需要手動下架',
        content: payload.message, urgent: true, courseIds: [] } }, upsert: true } }]);
  }
  async function recoverAssetPrivacy() {
    for (const asset of await Asset.find({ status: 'archived', 'consentWithdrawal.privateRequired': true }).lean()) {
      try { await privatize(asset, { operationId: `${asset.consentWithdrawal.withdrawalId}:private:${asset._id}` }); }
      catch {
        for (const admin of await listAdmins()) await notifyAdmin(admin._id, { message: '短片撤回後轉私人失敗，請手動下架。' },
          { operationId: `${asset.consentWithdrawal.withdrawalId}:late-private:${asset._id}:admin:${admin._id}` });
      }
    }
  }
  async function quarantineAsset(asset, { youtubeVideoId = asset.youtubeVideoId, fetchImpl } = {}) {
    const withdrawalId = asset.consentWithdrawal?.withdrawalId || `consent-blocked:${asset._id}:${asset.generationVersion || 1}`;
    const saved = await Asset.findOneAndUpdate({ _id: asset._id, generationVersion: asset.generationVersion ?? null }, { $set: {
      status: 'archived', publishedAt: null, ...(youtubeVideoId ? { youtubeVideoId } : {}),
      'youtubeUpload.nextRetryAt': null, 'youtubeUpload.retrySafe': false,
      consentWithdrawal: { ...(asset.consentWithdrawal || {}), withdrawalId, privateRequired: Boolean(youtubeVideoId), archivedAt: new Date() },
    } }, { new: true });
    if (!saved) throw new AppError('Consent compensation asset generation changed.', 409, 'RECUT_CONSENT_COMPENSATION_CONFLICT');
    try { await privatize(saved, { operationId: `${withdrawalId}:private:${asset._id}`, fetchImpl }); }
    catch {
      for (const admin of await listAdmins()) await notifyAdmin(admin._id, { message: '撤回時短片上傳已送出，轉私人失敗，請手動下架。' },
        { operationId: `${withdrawalId}:late-private:${asset._id}:admin:${admin._id}` });
    }
    return saved;
  }
  return { listAssets: (scope) => scopedAssets(scope), stopWork, archiveAsset, makeYouTubePrivate, listAdmins, notifyAdmin, listManualAssetActions, recoverAssetPrivacy, quarantineAsset };
}
let configuredLifecycle;
function configureRecutConsentLifecycle(options) {
  const lifecycle = createRecutConsentLifecycle(options);
  require('./recutConsent.service').configureLifecycle(lifecycle);
  configuredLifecycle = lifecycle;
  return lifecycle;
}
function quarantineForConsentLoss(asset, options) {
  return (configuredLifecycle || configureRecutConsentLifecycle()).quarantineAsset(asset, options);
}
module.exports = { createRecutConsentLifecycle, configureRecutConsentLifecycle, quarantineForConsentLoss };
