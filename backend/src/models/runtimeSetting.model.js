const mongoose = require('mongoose');

// 管理員可在執行期切換的設定，一個 key 一份文件。環境變數仍是總開關，
// 這裡只存「在允許範圍內」的選擇；第一批只有 YouTube 上傳、恢復、清理三個開關。
const runtimeSettingChangeSchema = new mongoose.Schema(
  {
    from: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    to: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // 帳號日後被刪或改名時，紀錄仍看得出當時是誰操作。
    changedByEmail: {
      type: String,
      default: null,
      trim: true,
    },
    changedAt: {
      type: Date,
      required: true,
    },
  },
  { _id: false },
);

const runtimeSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    // null 代表「尚未設定」，由各設定自行決定預設行為。
    value: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // 只保留最近 RUNTIME_SETTING_HISTORY_LIMIT 筆，寫入時以 $slice 截斷。
    history: {
      type: [runtimeSettingChangeSchema],
      default: [],
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('RuntimeSetting', runtimeSettingSchema);
