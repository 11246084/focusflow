const mongoose = require('mongoose');

const sourceSchema = new mongoose.Schema(
  {
    videoId: { type: String, default: null, trim: true },
    chunkId: { type: String, default: null, trim: true },
    segmentId: { type: String, default: null, trim: true },
    parentIds: { type: [String], default: [] },
    startSec: { type: Number, default: null, min: 0 },
    endSec: { type: Number, default: null, min: 0 },
    videoTitle: { type: String, default: null, trim: true },
    transcript: { type: String, default: '', trim: true },
    score: { type: Number, default: null },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'completed',
      index: true,
    },
    replyToMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
      index: true,
    },
    errorCode: { type: String, default: null, trim: true },
    sources: { type: [sourceSchema], default: [] },
    standaloneQuestion: { type: String, default: null, trim: true },
    runtime: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'messages' },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ conversationId: 1, replyToMessageId: 1 });

module.exports = mongoose.model('Message', messageSchema);
