const env = require('../config/env');
// S1 尚未合併；集中在此處轉接，業務程式只呼叫 getSetting(key)。
function getSetting(key) {
  switch (key) {
    case 'recut.geminiModel': return { provider: 'gemini', model: process.env.RECUT_GEMINI_MODEL || env.geminiChatModel };
    // 初次產生預設 8 次（2026-11-19 由 5 調高，recut 決策第 18 項）：配圖卡常差一點點就用完額度。
    case 'recut.initialCallLimit': return Number(process.env.RECUT_INITIAL_CALL_LIMIT || 8);
    case 'recut.modificationCallLimit': return Number(process.env.RECUT_MODIFICATION_CALL_LIMIT || 5);
    default: throw new TypeError(`Unknown recut setting: ${key}`);
  }
}
module.exports = { getSetting };
