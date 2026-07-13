const mongoose = require('mongoose');

// FAQ 快取：同課程重複（或語意高度相似）的問題直接回快取答案，
// 跳過 query embedding / 向量搜尋 / LLM 生成，節省 token 與延遲。
// matches / clip 保留 QA 回應的完整形狀（含 jumpUrl 等 enrichment 欄位），
// 因此使用 Mixed 儲存快照，而不是重複定義子 schema。
const faqSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    question: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedQuestion: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
    },
    matches: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    clip: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    questionEmbedding: {
      type: [Number],
      default: [],
    },
    hitCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastHitAt: {
      type: Date,
      default: null,
    },
    lastAnsweredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'faqs',
  },
);

faqSchema.index({ courseId: 1, normalizedQuestion: 1 }, { unique: true });
faqSchema.index({ courseId: 1, hitCount: -1 });

module.exports = mongoose.model('Faq', faqSchema);
