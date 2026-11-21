const env = require('../config/env');
// S1 尚未合併；集中在此處轉接，業務程式只呼叫 getSetting(key)。
function getSetting(key) {
  switch (key) {
    case 'recut.geminiModel': return { provider: 'gemini', model: process.env.RECUT_GEMINI_MODEL || env.geminiChatModel };
    // 初次產生預設 30 次（2026-11-19 由 5 調為 8、2026-11-21 再調為 30，recut 決策第 93、99 項）：佈展試用量大，避免配圖卡修正用完額度。
    case 'recut.initialCallLimit': return Number(process.env.RECUT_INITIAL_CALL_LIMIT || 30);
    case 'recut.modificationCallLimit': return Number(process.env.RECUT_MODIFICATION_CALL_LIMIT || 5);
    default: throw new TypeError(`Unknown recut setting: ${key}`);
  }
}
module.exports = { getSetting };
