const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const service = require('../services/conversation.service');

const createConversation = asyncHandler(async (req, res) => {
  const courseId = String(req.body.courseId || '').trim();
  if (!courseId) throw new AppError('courseId is required.', 400, 'VALIDATION_ERROR');
  const data = await service.createConversation({ user: req.user, courseId, title: req.body.title });
  return sendSuccess(res, { statusCode: 201, message: 'Conversation created.', data });
});
const listMessages = asyncHandler(async (req, res) => {
  const messages = await service.listMessages({ user: req.user, conversationId: req.params.conversationId });
  return sendSuccess(res, { message: 'Conversation messages retrieved.', data: { messages } });
});
const sendMessage = asyncHandler(async (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) throw new AppError('content is required.', 400, 'VALIDATION_ERROR');
  const data = await service.sendMessage({ user: req.user, conversationId: req.params.conversationId, content });
  return sendSuccess(res, { statusCode: 201, message: 'Message answered.', data });
});
module.exports = { createConversation, listMessages, sendMessage };
