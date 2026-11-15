const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess, buildSuccessResponse } = require('../utils/apiResponse');
const service = require('../services/conversation.service');

const createConversation = asyncHandler(async (req, res) => {
  const courseId = String(req.body.courseId || '').trim();
  if (!courseId) throw new AppError('courseId is required.', 400, 'VALIDATION_ERROR');
  const data = await service.createConversation({ user: req.user, courseId, title: req.body.title });
  return sendSuccess(res, { statusCode: 201, message: 'Conversation created.', data });
});
const listConversations = asyncHandler(async (req, res) => {
  const courseId = String(req.query.courseId || '').trim();
  if (!courseId) throw new AppError('courseId is required.', 400, 'VALIDATION_ERROR');
  const conversations = await service.listConversations({ user: req.user, courseId });
  return sendSuccess(res, { message: 'Conversations retrieved.', data: { conversations } });
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
const streamMessage = asyncHandler(async (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) throw new AppError('content is required.', 400, 'VALIDATION_ERROR');
  let timer;
  const write = (event, data) => {
    if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    const data = await service.sendMessage({
      user: req.user, conversationId: req.params.conversationId, content,
      onAccepted: (userMessage, assistantMessage) => {
        res.status(201);
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'Content-Encoding': 'identity' });
        res.flushHeaders();
        write('accepted', { userMessageId: userMessage.id, assistantMessageId: assistantMessage.id, userMessage, assistantMessage });
        timer = setInterval(() => {
          if (!res.writableEnded && !res.destroyed) res.write(':\n\n');
        }, 15000);
      },
      onStage: (stage) => write('stage', { stage }),
    });
    write('done', buildSuccessResponse({ message: 'Message answered.', data }));
    if (!res.writableEnded && !res.destroyed) res.end();
  } catch (error) {
    if (!res.headersSent) throw error;
    write('error', { message: 'Request failed.', code: 'INTERNAL_SERVER_ERROR' });
    if (!res.writableEnded && !res.destroyed) res.end();
  } finally {
    clearInterval(timer);
  }
});
const retryMessage = asyncHandler(async (req, res) => {
  const data = await service.retryMessage({
    user: req.user,
    conversationId: req.params.conversationId,
    userMessageId: req.params.messageId,
  });
  return sendSuccess(res, { message: 'Message retry completed.', data });
});
module.exports = { createConversation, listConversations, listMessages, sendMessage, streamMessage, retryMessage };
