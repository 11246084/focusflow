const Conversation = require('../models/conversation.model');
const Message = require('../models/message.model');
const Course = require('../models/course.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { assertCanAccessCourse } = require('./courseAccess.service');
const { contextualizeQuestion, normalizeHistory } = require('./contextualQuestion.service');
const { askQuestion } = require('./qa.service');
const { summarizeTextForLog } = require('../utils/logPreview');

function publicMessage(message) {
  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    role: message.role,
    content: message.content,
    status: message.status || 'completed',
    replyToMessageId: message.replyToMessageId ? String(message.replyToMessageId) : null,
    errorCode: message.errorCode || null,
    sources: message.sources || [],
    standaloneQuestion: message.standaloneQuestion || null,
    createdAt: message.createdAt,
  };
}

function conversationSourcesFromCitations(citations) {
  return (Array.isArray(citations) ? citations : []).map((citation) => ({
    videoId: citation.videoId || null,
    chunkId: citation.chunkId || null,
    segmentId: citation.segmentId || null,
    parentIds: Array.isArray(citation.parentIds) ? citation.parentIds : [],
    startSec: citation.timestamp?.startSec ?? null,
    endSec: citation.timestamp?.endSec ?? null,
    videoTitle: citation.videoTitle || citation.sourceVideo?.title || null,
    transcript: citation.transcriptSnippet || '',
    score: typeof citation.match?.score === 'number' ? citation.match.score : null,
  }));
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

async function listConversations({ user, courseId }) {
  assertObjectId(courseId, 'course');
  const course = await Course.findById(courseId);
  if (!course) throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  await assertCanAccessCourse(user, course);
  const conversations = await Conversation.find({ userId: user.id, courseId })
    .sort({ updatedAt: -1 }).lean();
  return conversations.map((conversation) => ({
    id: String(conversation._id),
    courseId: String(conversation.courseId),
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  }));
}

async function loadOwnedConversation({ user, conversationId }) {
  assertObjectId(conversationId, 'conversation');
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new AppError('Conversation not found.', 404, 'CONVERSATION_NOT_FOUND');
  if (String(conversation.userId) !== String(user.id)) {
    throw new AppError('Conversation access denied.', 403, 'CONVERSATION_ACCESS_DENIED');
  }
  const course = await Course.findById(conversation.courseId);
  if (!course) throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
  await assertCanAccessCourse(user, course);
  return conversation;
}

async function listMessages({ user, conversationId }) {
  await loadOwnedConversation({ user, conversationId });
  const messages = await Message.find({ conversationId }).sort({ createdAt: 1 }).lean();
  return messages.map(publicMessage);
}

function historyFromMessages(messages) {
  return normalizeHistory((Array.isArray(messages) ? messages : [])
    .filter((message) => message.status !== 'failed')
    .map((message) => ({ role: message.role, content: message.content })));
}

async function runQuestion({ user, conversation, userMessage, history, assistantMessage = null }) {
  const contextualStartedAt = Date.now();
  const contextual = contextualizeQuestion({
    recentConversationHistory: history,
    currentQuestion: userMessage.content,
  });
  const contextualizationLatencyMs = Date.now() - contextualStartedAt;
  const startedAt = Date.now();

  try {
    const result = await askQuestion({
      user,
      courseId: String(conversation.courseId),
      question: userMessage.content,
      retrievalQuestion: contextual.standaloneQuestion,
      source: 'api',
      conversationHistory: history,
      conversationId: conversation._id,
      contextualization: contextual,
    });
    const runtime = {
      ...(result.runtime || {}),
      conversationLatency: {
        contextualizationLatencyMs,
        totalLatencyMs: Date.now() - contextualStartedAt,
      },
    };
    const sources = conversationSourcesFromCitations(result.citations);
    const payload = {
      conversationId: conversation._id,
      role: 'assistant',
      content: result.answer,
      status: 'completed',
      replyToMessageId: userMessage._id,
      errorCode: null,
      sources,
      standaloneQuestion: contextual.standaloneQuestion,
      runtime,
    };
    const savedAssistant = assistantMessage
      ? await Message.findByIdAndUpdate(assistantMessage._id, { $set: payload }, { new: true })
      : await Message.create(payload);
    await Conversation.findByIdAndUpdate(conversation._id, {
      $set: {
        updatedAt: new Date(),
        ...(conversation.title === 'New conversation'
          ? { title: String(userMessage.content).slice(0, 120) }
          : {}),
      },
    });

    const originalQuestionLog = summarizeTextForLog(userMessage.content);
    const standaloneQuestionLog = summarizeTextForLog(contextual.standaloneQuestion);
    console.info('[conversational-qa]', {
      conversationId: String(conversation._id),
      originalQuestionLength: originalQuestionLog.length,
      originalQuestionPreview: originalQuestionLog.preview,
      requiresContext: contextual.requiresContext,
      standaloneQuestionLength: standaloneQuestionLog.length,
      standaloneQuestionPreview: standaloneQuestionLog.preview,
      retrievalMode: result.runtime?.hierarchicalRetrieval?.retrievalMode || result.runtime?.searchBackendUsed,
      retrievedParentIds: result.runtime?.hierarchicalRetrieval?.retrievedParentIds || [],
      retrievedChunkIds: (result.matches || []).map((match) => match.chunkId).filter(Boolean),
      answerProvider: result.runtime?.answerProviderUsed,
      contextualizationLatencyMs,
      embeddingLatencyMs: result.runtime?.latency?.embeddingLatencyMs ?? null,
      retrievalLatencyMs: result.runtime?.latency?.retrievalLatencyMs ?? null,
      generationLatencyMs: result.runtime?.latency?.generationLatencyMs ?? null,
      totalLatencyMs: Date.now() - contextualStartedAt,
    });
    return { result, contextual, assistantMessage: savedAssistant };
  } catch (error) {
    const failedPayload = {
      conversationId: conversation._id,
      role: 'assistant',
      content: '回答產生失敗，請稍後重新產生。',
      status: 'failed',
      replyToMessageId: userMessage._id,
      errorCode: error?.code || 'INTERNAL_SERVER_ERROR',
      sources: [],
      standaloneQuestion: contextual.standaloneQuestion,
      runtime: {
        conversationLatency: {
          contextualizationLatencyMs,
          totalLatencyMs: Date.now() - contextualStartedAt,
        },
      },
    };
    const savedAssistant = assistantMessage
      ? await Message.findByIdAndUpdate(assistantMessage._id, { $set: failedPayload }, { new: true })
      : await Message.create(failedPayload);
    await Conversation.findByIdAndUpdate(conversation._id, { $set: { updatedAt: new Date() } });
    return { error, contextual, assistantMessage: savedAssistant };
  }
}

async function sendMessage({ user, conversationId, content }) {
  const conversation = await loadOwnedConversation({ user, conversationId });
  const question = String(content || '').trim();
  if (!question) throw new AppError('Message content is required.', 400, 'VALIDATION_ERROR');

  const existing = await Message.find({ conversationId }).sort({ createdAt: -1 })
    .limit(require('../config/env').maxConversationTurns * 2).lean();
  const history = historyFromMessages([...existing].reverse());
  const userMessage = await Message.create({
    conversationId, role: 'user', content: question, status: 'completed',
  });
  const execution = await runQuestion({ user, conversation, userMessage, history });
  const result = execution.result;
  const contextual = execution.contextual;
  const assistantMessage = execution.assistantMessage;

  return {
    conversationId: String(conversationId),
    userMessage: publicMessage(userMessage),
    assistantMessage: publicMessage(assistantMessage),
    answer: assistantMessage.content,
    sources: conversationSourcesFromCitations(result?.citations),
    standaloneQuestion: contextual.standaloneQuestion,
    requiresContext: contextual.requiresContext,
    runtime: result?.runtime || assistantMessage.runtime || {},
    failed: assistantMessage.status === 'failed',
  };
}

async function retryMessage({ user, conversationId, userMessageId }) {
  const conversation = await loadOwnedConversation({ user, conversationId });
  assertObjectId(userMessageId, 'message');
  const messages = await Message.find({ conversationId }).sort({ createdAt: 1 }).lean();
  const index = messages.findIndex((message) => String(message._id) === String(userMessageId));
  const userMessage = messages[index];
  if (!userMessage || userMessage.role !== 'user') {
    throw new AppError('User message not found.', 404, 'MESSAGE_NOT_FOUND');
  }
  const failedAssistant = messages.find((message) => (
    message.role === 'assistant'
    && message.status === 'failed'
    && String(message.replyToMessageId) === String(userMessage._id)
  ));
  if (!failedAssistant) {
    throw new AppError('Message is not retryable.', 409, 'MESSAGE_RETRY_NOT_ALLOWED');
  }
  const history = historyFromMessages(messages.slice(0, index));
  const execution = await runQuestion({
    user, conversation, userMessage, history, assistantMessage: failedAssistant,
  });
  return {
    conversationId: String(conversationId),
    userMessage: publicMessage(userMessage),
    assistantMessage: publicMessage(execution.assistantMessage),
    answer: execution.assistantMessage.content,
    sources: conversationSourcesFromCitations(execution.result?.citations),
    standaloneQuestion: execution.contextual.standaloneQuestion,
    requiresContext: execution.contextual.requiresContext,
    runtime: execution.result?.runtime || execution.assistantMessage.runtime || {},
    failed: execution.assistantMessage.status === 'failed',
  };
}

module.exports = {
  createConversation, listConversations, listMessages, sendMessage, retryMessage,
  loadOwnedConversation, historyFromMessages, conversationSourcesFromCitations,
};
