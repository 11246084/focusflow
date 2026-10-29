const env = require('../config/env');
// S1 尚未合併；集中在此處轉接，業務程式只呼叫 getSetting(key)。
function getSetting(key) {
  switch (key) {
    case 'recut.geminiModel': return { provider: 'gemini', model: process.env.RECUT_GEMINI_MODEL || env.geminiChatModel };
    case 'recut.initialCallLimit': return Number(process.env.RECUT_INITIAL_CALL_LIMIT || 5);
    case 'recut.modificationCallLimit': return Number(process.env.RECUT_MODIFICATION_CALL_LIMIT || 5);
    default: throw new TypeError(`Unknown recut setting: ${key}`);
  }
}
module.exports = { getSetting };
