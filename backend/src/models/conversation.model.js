const mongoose = require('mongoose');

const DEFAULT_CONVERSATION_TITLE = '新對話';
// 2026-09-18 前建立的對話預設標題是英文，仍視為「尚未命名」。
const LEGACY_DEFAULT_CONVERSATION_TITLES = ['New conversation'];

const conversationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    title: { type: String, default: DEFAULT_CONVERSATION_TITLE, trim: true, maxlength: 120 },
  },
  { timestamps: true, collection: 'conversations' },
);

conversationSchema.index({ userId: 1, courseId: 1, updatedAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

function isDefaultConversationTitle(title) {
  return title === DEFAULT_CONVERSATION_TITLE || LEGACY_DEFAULT_CONVERSATION_TITLES.includes(title);
}

module.exports = Conversation;
module.exports.DEFAULT_CONVERSATION_TITLE = DEFAULT_CONVERSATION_TITLE;
module.exports.isDefaultConversationTitle = isDefaultConversationTitle;
