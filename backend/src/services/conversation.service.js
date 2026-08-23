const Conversation = require('../models/conversation.model');
const Message = require('../models/message.model');
const Course = require('../models/course.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { assertCanAccessCourse } = require('./courseAccess.service');
const { contextualizeQuestion, normalizeHistory } = require('./contextualQuestion.service');
const { askQuestion } = require('./qa.service');

function publicMessage(message) {
  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    role: message.role,
    content: message.content,
    sources: message.sources || [],
    standaloneQuestion: message.standaloneQuestion || null,
    createdAt: message.createdAt,
  };
}

async function createConversation({ user, courseId, title = '' }) {
  assertObjectId(courseId, 'course');
  const course = await Course.findById(courseId);
  if (!course) throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  await assertCanAccessCourse(user, course);
  const conversation = await Conversation.create({
    userId: user.id,
    courseId: course._id,
    title: String(title || '').trim() || 'New conversation',
  });
  return {
    id: String(conversation._id),
    courseId: String(conversation.courseId),
    title: conversation.title,
    createdAt: conversation.createdAt,
  };
}

async function loadOwnedConversation({ user, conversationId }) {
  assertObjectId(conversationId, 'conversation');
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new AppError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND');
  if (String(conversation.userId) !== String(user.id)) {
    throw new AppError('Conversation access denied.', 403, 'CONVERSATION_ACCESS_DENIED');
  }
  return conversation;
}

async function listMessages({ user, conversationId }) {
  await loadOwnedConversation({ user, conversationId });
  const messages = await Message.find({ conversationId }).sort({ createdAt: 1 }).lean();
  return messages.map(publicMessage);
}

async function sendMessage({ user, conversationId, content }) {
  const startedAt = Date.now();
  const conversation = await loadOwnedConversation({ user, conversationId });
  const question = String(content || '').trim();
  if (!question) throw new AppError('Message content is required.', 400, 'VALIDATION_ERROR');

  const existing = await Message.find({ conversationId }).sort({ createdAt: -1 })
    .limit(require('../config/env').maxConversationTurns * 2).lean();
  const history = normalizeHistory([...existing].reverse().map((message) => ({
    role: message.role,
    content: message.content,
  })));
  const contextual = contextualizeQuestion({ recentConversationHistory: history, currentQuestion: question });
  const userMessage = await Message.create({ conversationId, role: 'user', content: question });

  const result = await askQuestion({
    user,
    courseId: String(conversation.courseId),
    question,
    retrievalQuestion: contextual.standaloneQuestion,
    source: 'api',
    conversationHistory: history,
    conversationId,
    contextualization: contextual,
  });
  const assistantMessage = await Message.create({
    conversationId,
    role: 'assistant',
    content: result.answer,
    sources: result.matches || [],
    standaloneQuestion: contextual.standaloneQuestion,
    runtime: result.runtime,
  });
  await Conversation.findByIdAndUpdate(conversationId, { $set: { updatedAt: new Date() } });

  console.info('[conversational-qa]', {
    conversationId: String(conversationId),
    originalQuestion: question,
    requiresContext: contextual.requiresContext,
    standaloneQuestion: contextual.standaloneQuestion,
    retrievalMode: result.runtime?.hierarchicalRetrieval?.retrievalMode || result.runtime?.searchBackendUsed,
    retrievedParentIds: result.runtime?.hierarchicalRetrieval?.retrievedParentIds || [],
    retrievedChunkIds: (result.matches || []).map((match) => match.chunkId).filter(Boolean),
    answerProvider: result.runtime?.answerProviderUsed,
    latencyMs: Date.now() - startedAt,
  });

  return {
    conversationId: String(conversationId),
    userMessage: publicMessage(userMessage),
    assistantMessage: publicMessage(assistantMessage),
    answer: result.answer,
    sources: result.matches || [],
    standaloneQuestion: contextual.standaloneQuestion,
    requiresContext: contextual.requiresContext,
    runtime: result.runtime,
  };
}

module.exports = { createConversation, listMessages, sendMessage, loadOwnedConversation };
