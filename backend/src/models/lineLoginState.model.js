const mongoose = require('mongoose');

// LINE Login 每次「連結 LINE」的一次性紀錄：開始時建立，回呼時取出並刪除。
// _id 是 state 的 SHA-256 雜湊，state 原文只出現在授權網址；資料庫外洩也拿不到可用的 state。
// 這裡不存 LINE 的 access token 或 refresh token。
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // 發起流程的登入 session（authSessions._id）；登出或換 session 後流程即失效
  sid: { type: String, required: true },
  nonce: { type: String, required: true },
  codeVerifier: { type: String, required: true },
  // 從「詢問助教」進來時才有；完成時仍要重新檢查修課權限
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: undefined },
  // 學生已在網頁確認「將取代目前的 LINE」；只由 start 寫入，complete 不接受用戶端再指定
  replaceExisting: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
}, { collection: 'lineLoginStates', autoIndex: false, autoCreate: false, versionKey: false });

schema.index({ userId: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('LineLoginState', schema);
