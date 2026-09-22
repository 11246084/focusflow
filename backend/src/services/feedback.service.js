const Feedback = require('../models/feedback.model');
const FeedbackAttachment = require('../models/feedbackAttachment.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { detectImageMimeType } = require('../utils/imageSignature');
const {
  USER_ROLES,
  FEEDBACK_CATEGORY_VALUES,
  FEEDBACK_STATUS_VALUES,
  FEEDBACK_SEVERITY_VALUES,
} = require('../constants/enums');

async function createFeedback({
  user, category, severity, description, pageContext, courseVideoName, files,
}) {
  if (!FEEDBACK_CATEGORY_VALUES.includes(category)) {
    throw new AppError('Invalid feedback category.', 400, 'VALIDATION_ERROR');
  }

  if (!FEEDBACK_SEVERITY_VALUES.includes(severity)) {
    throw new AppError('Invalid feedback severity.', 400, 'VALIDATION_ERROR');
  }

  const trimmedDescription = String(description || '').trim();
  if (!trimmedDescription) {
    throw new AppError('Description is required.', 400, 'VALIDATION_ERROR');
  }

  const trimmedPageContext = pageContext ? String(pageContext).trim().slice(0, 200) : null;
  const trimmedCourseVideoName = courseVideoName ? String(courseVideoName).trim().slice(0, 200) : null;

  const attachmentsMeta = [];
  for (const file of files || []) {
    const actualMimeType = detectImageMimeType(file.buffer);
    if (!actualMimeType || actualMimeType !== file.mimetype) {
      throw new AppError(
        'Attachment content does not match an allowed image type.',
        400,
        'INVALID_FEEDBACK_ATTACHMENT_TYPE',
      );
    }

    // Feedback is created after every attachment is validated, so a rejected file
    // never leaves an orphaned FeedbackAttachment document behind.
    attachmentsMeta.push({
      data: file.buffer,
      mimeType: actualMimeType,
      size: file.buffer.length,
      originalName: file.originalname || '',
    });
  }

  let feedback = await Feedback.create({
    userId: user.id,
    role: user.role,
    category,
    severity,
    description: trimmedDescription,
    pageContext: trimmedPageContext,
    courseVideoName: trimmedCourseVideoName,
    attachments: [],
  });

  const savedAttachments = [];
  for (const meta of attachmentsMeta) {
    const attachment = await FeedbackAttachment.create({
      feedbackId: feedback._id,
      data: meta.data,
      mimeType: meta.mimeType,
      size: meta.size,
      originalName: meta.originalName,
    });
    savedAttachments.push({
      attachmentId: attachment._id,
      mimeType: attachment.mimeType,
      size: attachment.size,
      originalName: attachment.originalName,
    });
  }

  if (savedAttachments.length) {
    feedback = await Feedback.findByIdAndUpdate(
      feedback._id,
      { attachments: savedAttachments },
      { new: true },
    );
  }

  return toFeedbackSummary(feedback);
}

async function listFeedback({
  status, category, severity, page = 1, limit = 20,
} = {}) {
  const query = {};
  if (status) {
    if (!FEEDBACK_STATUS_VALUES.includes(status)) {
      throw new AppError('Invalid feedback status.', 400, 'VALIDATION_ERROR');
    }
    query.status = status;
  }
  if (category) {
    if (!FEEDBACK_CATEGORY_VALUES.includes(category)) {
      throw new AppError('Invalid feedback category.', 400, 'VALIDATION_ERROR');
    }
    query.category = category;
  }
  if (severity) {
    if (!FEEDBACK_SEVERITY_VALUES.includes(severity)) {
      throw new AppError('Invalid feedback severity.', 400, 'VALIDATION_ERROR');
    }
    query.severity = severity;
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

  const items = await Feedback.find(query)
    .sort({ createdAt: -1 })
    .populate('userId', 'name email role')
    .lean();

  const total = items.length;
  const paged = items.slice((safePage - 1) * safeLimit, safePage * safeLimit);

  return {
    items: paged.map(toFeedbackListItem),
    meta: { total, page: safePage, limit: safeLimit },
  };
}

async function updateFeedbackStatus({ feedbackId, status, adminNote }) {
  assertObjectId(feedbackId, 'feedback');

  if (status !== undefined && !FEEDBACK_STATUS_VALUES.includes(status)) {
    throw new AppError('Invalid feedback status.', 400, 'VALIDATION_ERROR');
  }

  const update = {};
  if (status !== undefined) update.status = status;
  if (adminNote !== undefined) update.adminNote = String(adminNote || '').trim() || null;

  if (Object.keys(update).length === 0) {
    throw new AppError('No fields to update.', 400, 'VALIDATION_ERROR');
  }

  const feedback = await Feedback.findByIdAndUpdate(feedbackId, update, { new: true });
  if (!feedback) {
    throw new AppError('Feedback not found.', 404, 'FEEDBACK_NOT_FOUND');
  }

  return toFeedbackListItem(feedback);
}

async function getFeedbackAttachment({ feedbackId, attachmentId, requestingUser }) {
  assertObjectId(feedbackId, 'feedback');
  assertObjectId(attachmentId, 'feedback attachment');

  const feedback = await Feedback.findById(feedbackId).lean();
  if (!feedback) {
    throw new AppError('Feedback not found.', 404, 'FEEDBACK_NOT_FOUND');
  }

  const isOwner = String(feedback.userId) === String(requestingUser.id);
  const isAdmin = requestingUser.role === USER_ROLES.ADMIN;
  if (!isOwner && !isAdmin) {
    throw new AppError('You do not have permission to view this attachment.', 403, 'FORBIDDEN');
  }

  const attachment = await FeedbackAttachment.findOne({ _id: attachmentId, feedbackId });
  if (!attachment) {
    throw new AppError('Feedback attachment not found.', 404, 'FEEDBACK_ATTACHMENT_NOT_FOUND');
  }

  return {
    buffer: Buffer.from(attachment.data),
    mimeType: attachment.mimeType,
  };
}

function toFeedbackSummary(feedback) {
  return {
    id: String(feedback._id),
    category: feedback.category,
    severity: feedback.severity,
    description: feedback.description,
    pageContext: feedback.pageContext,
    courseVideoName: feedback.courseVideoName || null,
    status: feedback.status,
    attachments: (feedback.attachments || []).map((attachment) => ({
      attachmentId: String(attachment.attachmentId),
      mimeType: attachment.mimeType,
      size: attachment.size,
      originalName: attachment.originalName,
    })),
    createdAt: feedback.createdAt,
  };
}

function toFeedbackListItem(feedback) {
  // Only a populated query hands us a full user doc (has .name); an unpopulated
  // update result still carries userId as a bare ObjectId, so fall back to it.
  const submitter = feedback.userId && typeof feedback.userId === 'object' && 'name' in feedback.userId
    ? feedback.userId
    : null;

  return {
    id: String(feedback._id),
    category: feedback.category,
    severity: feedback.severity,
    description: feedback.description,
    pageContext: feedback.pageContext,
    courseVideoName: feedback.courseVideoName || null,
    status: feedback.status,
    adminNote: feedback.adminNote || null,
    submitter: submitter
      ? { id: String(submitter._id), name: submitter.name, email: submitter.email, role: submitter.role }
      : { id: String(feedback.userId), name: '—', email: '—', role: feedback.role },
    attachments: (feedback.attachments || []).map((attachment) => ({
      attachmentId: String(attachment.attachmentId),
      mimeType: attachment.mimeType,
      size: attachment.size,
      originalName: attachment.originalName,
    })),
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
  };
}

module.exports = {
  createFeedback,
  listFeedback,
  updateFeedbackStatus,
  getFeedbackAttachment,
};
