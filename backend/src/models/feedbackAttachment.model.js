const mongoose = require('mongoose');

const feedbackAttachmentSchema = new mongoose.Schema(
  {
    feedbackId: { type: mongoose.Schema.Types.ObjectId, ref: 'Feedback', required: true },
    data: { type: Buffer, required: true },
    mimeType: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp'] },
    size: { type: Number, required: true, min: 1 },
    originalName: { type: String, trim: true, default: '' },
  },
  { timestamps: true, collection: 'feedbackattachments' },
);

feedbackAttachmentSchema.index({ feedbackId: 1 });

module.exports = mongoose.model('FeedbackAttachment', feedbackAttachmentSchema);
