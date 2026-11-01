'use strict';
const AppError = require('../utils/appError');
async function assertWorkConsent(input) {
  const consent = require('./recutConsent.service');
  try { return await consent.assertConsentForWork(input); }
  catch (error) {
    if (/^RECUT_.*CONSENT|^RECUT_SYNTHETIC_VOICE/.test(error.code || '')) {
      error.publicDetails = { consentTerms: consent.getTerms(), consentUrl: `/api/v1/courses/${input.courseId}/recut-consent` };
    }
    throw error;
  }
}
async function assertScriptConsent(script, { contentOnly = false } = {}) {
  if (!script) throw new AppError('Short script not found.', 404, 'SHORT_SCRIPT_NOT_FOUND');
  const sourceIds = new Set();
  if (script.recut?.currentVersionId) {
    const version = await require('../models/recutVersion.model').findById(script.recut.currentVersionId).lean();
    const source = version && await require('../models/recutSource.model').findById(version.sourceId).lean();
    if (source?.videoId) sourceIds.add(String(source.videoId));
  }
  if (!sourceIds.size) for (const evidence of script.evidence || []) if (evidence.videoId) sourceIds.add(String(evidence.videoId));
  const base = { courseId: String(script.courseId), contentOnly, avatar: script.productionMode !== 'recut' };
  if (!sourceIds.size) return assertWorkConsent(base);
  const Video = require('../models/video.model');
  for (const id of sourceIds) {
    const video = await Video.findOne({ $or: [
      ...(require('mongoose').isValidObjectId(id) ? [{ _id: id }] : []), { videoId: id }, { video_id: id },
    ] }).lean();
    if (!video) throw new AppError('Consent source video is unavailable.', 409, 'RECUT_SOURCE_UNAVAILABLE');
    await assertWorkConsent({ ...base, videoId: String(video._id) });
  }
}
async function assertTaskConsent(task) {
  return assertScriptConsent(await require('../models/shortScript.model').findById(task.scriptId).lean());
}
async function assertAssetConsent(asset) {
  const script = asset.sourceScriptId && await require('../models/shortScript.model').findById(asset.sourceScriptId).lean();
  if (script) return assertScriptConsent(script);
  return assertWorkConsent({ courseId: String(asset.courseId), ...(asset.sourceVideoId ? { videoId: String(asset.sourceVideoId) } : {}), contentOnly: true });
}
module.exports = { assertWorkConsent, assertScriptConsent, assertTaskConsent, assertAssetConsent };
