const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const lineService = require('../services/line.service');
const { buildLineRuntimeSnapshot } = require('../services/runtimeDiagnostics.service');

const handleWebhook = asyncHandler(async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  const result = await lineService.processWebhookEvents(events);

  return sendSuccess(res, {
    message: 'LINE webhook processed.',
    data: result,
  });
});

const issueBindToken = asyncHandler(async (req, res) => {
  const token = await lineService.generateBindToken(req.user.id);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Bind token issued.',
    data: { token, expiresAt },
    meta: {
      lineRuntime: buildLineRuntimeSnapshot(),
    },
  });
});

module.exports = {
  handleWebhook,
  issueBindToken,
};
