const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const feedbackService = require('../services/feedback.service');

const createFeedback = asyncHandler(async (req, res) => {
  const { category, severity, description, pageContext, courseVideoName } = req.body || {};
  const feedback = await feedbackService.createFeedback({
    user: req.user,
    category,
    severity,
    description,
    pageContext,
    courseVideoName,
    files: req.files,
  });
  return sendSuccess(res, { statusCode: 201, message: 'Feedback submitted.', data: feedback });
});

const getAttachment = asyncHandler(async (req, res) => {
  const { feedbackId, attachmentId } = req.params;
  const attachment = await feedbackService.getFeedbackAttachment({
    feedbackId,
    attachmentId,
    requestingUser: req.user,
  });

  // Attachments may contain screen captures of a student's own session, so they must
  // stay behind auth and never be cached as a public/shareable asset.
  res.set({
    'Content-Type': attachment.mimeType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=0, must-revalidate',
  });
  return res.status(200).send(attachment.buffer);
});

module.exports = {
  createFeedback,
  getAttachment,
};
