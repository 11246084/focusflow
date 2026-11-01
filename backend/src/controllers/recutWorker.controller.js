const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const service = require('../services/recutWorker.service');
const { discardUnreferencedUpload } = require('../services/localSourceCleanup.service');
function body(req, allowed) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some((key) => !allowed.includes(key))) throw new AppError('Unexpected worker request fields.', 400, 'VALIDATION_ERROR');
  return req.body;
}
const leaseOptions = (req) => ({ worker: req.recutWorker, jobId: req.params.jobId, leaseToken: req.get('X-Recut-Lease') });
module.exports = {
  createWorker: asyncHandler(async (req, res) => sendSuccess(res, { statusCode: 201, data: await service.createWorker({ user: req.user, ...body(req, ['name']) }) })),
  listWorkers: asyncHandler(async (req, res) => sendSuccess(res, { data: await service.listWorkers() })),
  updateWorker: asyncHandler(async (req, res) => sendSuccess(res, { data: await service.updateWorker({ user: req.user, workerId: req.params.workerId, ...body(req, ['accepting', 'isActive']) }) })),
  authenticate: asyncHandler(async (req, res, next) => {
    if (req.headers.cookie || !/^Bearer rw_/.test(req.headers.authorization || '')) throw new AppError('Worker key required.', 401, 'RECUT_WORKER_UNAUTHORIZED');
    req.recutWorker = await service.authenticateWorker(req.headers.authorization.slice(7)); next();
  }),
  checkLease: asyncHandler(async (req, res, next) => { await service.ownedLease(leaseOptions(req)); next(); }),
  claim: asyncHandler(async (req, res) => sendSuccess(res, { data: await service.claimRenderJob({ worker: req.recutWorker, ...body(req, ['shortRenderVersion', 'assetVersions']) }) })),
  heartbeat: asyncHandler(async (req, res) => { body(req, []); return sendSuccess(res, { data: await service.heartbeat(leaseOptions(req)) }); }),
  source: asyncHandler(async (req, res) => res.sendFile(await service.sourceFile(leaseOptions(req)))),
  failure: asyncHandler(async (req, res) => {
    const result = await service.failRender({ ...leaseOptions(req), ...body(req, ['code', 'message', 'checks']) });
    return sendSuccess(res, { data: { status: result.status, attemptCount: result.attemptCount } });
  }),
  complete: asyncHandler(async (req, res) => {
    let submitted = false;
    try {
      body(req, ['metadata']);
      let metadata;
      try { metadata = JSON.parse(req.body.metadata); } catch { throw new AppError('metadata must be JSON.', 400, 'VALIDATION_ERROR'); }
      submitted = true;
      return sendSuccess(res, { statusCode: 201, data: await service.completeRender({ ...leaseOptions(req), metadata, file: req.file }) });
    } catch (err) { if (!submitted) await discardUnreferencedUpload(req.file); throw err; }
  }),
};
