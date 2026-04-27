const mongoose = require('mongoose');

// 這個 Model 存放「帳號綁定用的一次性 Token」
// 流程：使用者在網頁系統申請 token → 複製貼到 LINE Bot → Bot 驗證 token 完成綁定
const lineBindTokenSchema = new mongoose.Schema({
  // 64 字元的隨機十六進位字串，使用者用這個字串完成 LINE 綁定
  token: {
    type: String,
    required: true,
    unique: true,    // 同一個 token 只能存在一次
  },
  // 這個 token 屬於哪個系統使用者
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // Token 的過期時間，由 service 層設定為「建立時間 + 10 分鐘」
  expiresAt: {
    type: Date,
    required: true,
  },
});

// TTL index：MongoDB 會定期掃描，自動刪除 expiresAt 已過期的文件
// expireAfterSeconds: 0 表示到了 expiresAt 那一刻就刪除，不額外等待
lineBindTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// 明確指定集合名稱為 line_bind_tokens（避免 Mongoose 自動轉為 linebindtokens）
module.exports = mongoose.model('LineBindToken', lineBindTokenSchema, 'line_bind_tokens');
