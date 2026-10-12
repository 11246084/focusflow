const mongoose = require('mongoose');

// 國家教育研究院愛學網教學影片清單（政府資料開放平臺資料集 6318，
// 政府資料開放授權條款－第1版）。只供「延伸學習」推薦使用，由
// scripts/importOpenEduVideos.js 批次匯入，與課程影片 videos 完全分開。
const openEduVideoSchema = new mongoose.Schema(
  {
    // 資料集內的 NO 欄位，重複匯入時用來 upsert。
    sourceNo: { type: String, required: true, trim: true, unique: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    keywords: { type: [String], default: [] },
    learningField: { type: String, default: '', trim: true },
    learningStage: { type: String, default: '', trim: true },
    videoUrl: { type: String, required: true, trim: true },
    source: { type: String, default: '國家教育研究院愛學網', trim: true },
    importedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'open_edu_videos' },
);

module.exports = mongoose.model('OpenEduVideo', openEduVideoSchema);
