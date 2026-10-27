const mongoose = require('mongoose');
const { Schema } = mongoose;
const wordSchema = new Schema({
  text: { type: String, required: true, trim: true },
  startSec: { type: Number, required: true, min: 0 }, endSec: { type: Number, required: true, min: 0 },
}, { _id: false });
const sentenceSchema = new Schema({
  id: { type: String, required: true, trim: true, match: /^s[1-9]\d*$/ },
  startSec: { type: Number, required: true, min: 0 }, endSec: { type: Number, required: true, min: 0 },
  text: { type: String, required: true, trim: true }, words: { type: [wordSchema], required: true },
  retrievalHit: { type: Boolean, required: true }, chunkIds: { type: [String], default: [] },
}, { _id: false });
const schema = new Schema({
  scriptId: { type: Schema.Types.ObjectId, ref: 'ShortScript', required: true, index: true },
  videoId: { type: Schema.Types.ObjectId, ref: 'Video', required: true },
  startSec: { type: Number, required: true, min: 0 }, endSec: { type: Number, required: true, min: 0 },
  frozenAt: { type: Date, required: true }, hitChunkIds: { type: [String], required: true },
  // 全部時間均為原片絕對秒數，RC2 不得把視窗相對時間直接存入。
  sentences: { type: [sentenceSchema], default: [] },
  sourceCheck: {
    passed: { type: Boolean, default: false }, results: { type: Schema.Types.Mixed, default: null },
    checkedAt: { type: Date, default: null },
  },
  audio: {
    integratedLufs: Number, truePeakDbtp: Number, fixedGainDb: Number,
    targetLufs: { type: Number, default: -16 }, peakLimitDbtp: { type: Number, default: -1.5 },
  },
}, { timestamps: true });
module.exports = mongoose.model('RecutSource', schema);
