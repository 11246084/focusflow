const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    title: { type: String, default: 'New conversation', trim: true, maxlength: 120 },
  },
  { timestamps: true, collection: 'conversations' },
);

conversationSchema.index({ userId: 1, courseId: 1, updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
