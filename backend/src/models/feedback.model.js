const mongoose = require('mongoose');
const {
  USER_ROLE_VALUES,
  FEEDBACK_CATEGORY_VALUES,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_VALUES,
  FEEDBACK_SEVERITY_VALUES,
} = require('../constants/enums');

const feedbackAttachmentMetaSchema = new mongoose.Schema(
  {
    attachmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeedbackAttachment', required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    originalName: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const feedbackSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: USER_ROLE_VALUES, required: true },
    category: { type: String, enum: FEEDBACK_CATEGORY_VALUES, required: true },
    severity: { type: String, enum: FEEDBACK_SEVERITY_VALUES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    pageContext: { type: String, trim: true, default: null },
    courseVideoName: { type: String, trim: true, maxlength: 200, default: null },
    attachments: { type: [feedbackAttachmentMetaSchema], default: [] },
    status: { type: String, enum: FEEDBACK_STATUS_VALUES, default: FEEDBACK_STATUSES.OPEN },
    adminNote: { type: String, trim: true, default: null },
  },
  { timestamps: true, collection: 'feedbacks' },
);

feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ userId: 1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
