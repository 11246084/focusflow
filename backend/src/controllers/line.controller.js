const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const lineService = require('../services/line.service');

const handleWebhook = asyncHandler(async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  const result = await lineService.processWebhookEvents(events);

  return sendSuccess(res, {
    message: 'LINE webhook processed.',
    data: result,
  });
});

module.exports = {
  handleWebhook,
};
