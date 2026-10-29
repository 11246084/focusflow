const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const service = require('../services/recut.service');
function assertBody(body, keys = []) {
  if (body != null && (typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !keys.includes(key)))) {
    throw new AppError('Unexpected recut request fields.', 400, 'VALIDATION_ERROR');
  }
}
const params = (req) => ({ user: req.user, scriptId: req.params.scriptId, taskId: req.params.taskId });
module.exports = {
  setProductionMode: asyncHandler(async (req, res) => {
    assertBody(req.body, ['productionMode']);
    const data = await service.setProductionMode({ ...params(req), mode: req.body?.productionMode });
    return sendSuccess(res, { data });
  }),
  startGeneration: asyncHandler(async (req, res) => {
    assertBody(req.body);
    return sendSuccess(res, { statusCode: 202, message: 'Recut generation queued.', data: await service.startGeneration(params(req)) });
  }),
  getState: asyncHandler(async (req, res) => sendSuccess(res, { data: await service.getState(params(req)) })),
  getTask: asyncHandler(async (req, res) => sendSuccess(res, { data: await service.getTask(params(req)) })),
  cancelTask: asyncHandler(async (req, res) => {
    assertBody(req.body);
    return sendSuccess(res, { data: await service.cancelTask(params(req)) });
  }),
};
