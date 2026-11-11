const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const service = require('../services/recutConsent.service');

function createRecutConsentController(consent = service) {
  const input = (req) => ({
    user: req.user, courseId: req.params.courseId,
    videoId: req.body?.videoId ?? req.query?.videoId,
    sourceId: req.body?.sourceId ?? req.query?.sourceId,
    teacherId: req.body?.teacherId ?? req.query?.teacherId,
  });
  return {
    getTerms: asyncHandler(async (req, res) => sendSuccess(res, { data: consent.getTerms() })),
    getConsent: asyncHandler(async (req, res) => sendSuccess(res, { data: await consent.getConsent(input(req)) })),
    recordConsent: asyncHandler(async (req, res) => sendSuccess(res, { data: await consent.recordConsent({
      ...input(req), kind: req.body?.kind, choice: req.body?.choice, requestId: req.body?.requestId,
      termsVersion: req.body?.termsVersion, evidenceRef: req.body?.evidenceRef,
    }) })),
    listWithdrawalAssets: asyncHandler(async (req, res) => sendSuccess(res, { data: await consent.listWithdrawalAssets({ ...input(req), kind: req.query?.kind }) })),
    withdraw: asyncHandler(async (req, res) => sendSuccess(res, { data: await consent.withdraw({
      ...input(req), kind: req.body?.kind, requestId: req.body?.requestId, termsVersion: req.body?.termsVersion,
      selectedAssetIds: req.body?.selectedAssetIds, selectAll: req.body?.selectAll,
    }) })),
    retryWithdrawal: asyncHandler(async (req, res) => sendSuccess(res, { data: await consent.retryWithdrawal({ ...input(req), withdrawalId: req.params.withdrawalId }) })),
    listManualActions: asyncHandler(async (req, res) => sendSuccess(res, { data: await consent.listManualActions({ user: req.user }) })),
  };
}
module.exports = { createRecutConsentController, ...createRecutConsentController() };
