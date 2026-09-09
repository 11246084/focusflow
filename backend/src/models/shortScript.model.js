const mongoose = require('mongoose');
const {
  SHORT_SCRIPT_STATUSES,
  SHORT_SCRIPT_STATUS_VALUES,
  SHORT_SCRIPT_FEEDBACK_TYPE_VALUES,
} = require('../constants/enums');

// 凍結的證據片段（規格書附錄 C）。
// 這是快照，不是參照：來源影片被刪除、重新處理或自課程移除，都不影響已凍結的內容。
// rawText 存未修飾的 STT 原文，不得自動糾錯後覆蓋——糾錯會引入幻覺，
// 也會讓引用無法比對回原始片段。
const evidenceSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    chunkId: { type: String, required: true, trim: true },
    videoId: { type: String, default: null, trim: true },
    videoTitle: { type: String, default: null, trim: true },
    startSec: { type: Number, default: null },
    endSec: { type: Number, default: null },
    rawText: { type: String, default: '' },
    // 這一筆是檢索直接命中，還是鄰接擴展補進來的（規格書 C.1）。
    // 兩者在 basedOn 引用時地位相同，但診斷時需要分得出來。
    expandedFrom: { type: String, default: null, trim: true },
  },
  { _id: false },
);

// 候選主題合併前的原始問句（規格書 DR-14：來源為 questions，不是 faqs）。
const sourceQuestionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    askCount: { type: Number, default: 0, min: 0 },
    // 提問人數是比次數更可靠的需求訊號（DR-17）。
    uniqueAskerCount: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const versionSchema = new mongoose.Schema(
  {
    versionNo: { type: Number, required: true, min: 1 },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    generatedAt: { type: Date, default: null },
    feedback: { type: String, default: null, trim: true },
    feedbackType: { type: String, enum: [...SHORT_SCRIPT_FEEDBACK_TYPE_VALUES, null], default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    // retrieval 類回饋會重新凍結證據，這裡標記該版本用的是哪一次的證據
    evidenceFrozenAt: { type: Date, default: null },
    // 這一版的回饋是來自「成品影片被退回」而非腳本本身的審核（規格書 DR-20）。
    // 兩者都寫進 feedback，但來源不同：診斷生成品質時必須分得出來，
    // 否則會把「影片做出來才發現的問題」誤算成腳本階段就該攔下的問題。
    rejectedAsAsset: { type: Boolean, default: false },
  },
  { _id: false },
);

const shortScriptSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    topic: { type: String, required: true, trim: true },
    // 候選分群的代表題正規化文字。自動選題以此排除已 approved / dismissed 的主題，
    // 因此同一課程內不得重複（見下方 unique 複合索引）。
    topicKey: { type: String, required: true, trim: true },
    sourceQuestions: { type: [sourceQuestionSchema], default: [] },
    // 為什麼選這一題（規格書 R-04）：教師必須能追溯排名依據。
    selectionReason: { type: mongoose.Schema.Types.Mixed, default: null },
    evidence: { type: [evidenceSchema], default: [] },
    evidenceFrozenAt: { type: Date, default: null },
    versions: { type: [versionSchema], default: [] },
    status: {
      type: String,
      enum: SHORT_SCRIPT_STATUS_VALUES,
      default: SHORT_SCRIPT_STATUSES.EVIDENCE_READY,
      index: true,
    },
    dismissReason: { type: String, default: null, trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

shortScriptSchema.index({ courseId: 1, status: 1, createdAt: -1 });
shortScriptSchema.index({ courseId: 1, topicKey: 1 }, { unique: true });

module.exports = mongoose.model('ShortScript', shortScriptSchema);
