const env = require('../config/env');
const User = require('../models/user.model');

// 依綁定狀態切換圖文選單（LINE 決策 LM）。
// 未綁定的人看到預設選單「連結帳號」（由 npm run line:rich-menu 設為預設）；
// 綁定成功時把「已綁定」四格選單指定給這個 LINE 使用者，解除綁定時取消指定，回到預設選單。
// 圖文選單只是入口，失敗不影響綁定或問答，所以這裡一律不丟例外，回傳是否成功。
const LINE_API_BASE = 'https://api.line.me/v2/bot';
const REQUEST_TIMEOUT_MS = 5000;

function isRichMenuConfigured() {
  return Boolean(env.lineChannelAccessToken && env.lineRichMenuBoundId);
}

async function callLine(method, path) {
  try {
    const response = await fetch(`${LINE_API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.lineChannelAccessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok && env.nodeEnv !== 'test') {
      console.warn(`[LINE] rich menu ${method} failed with ${response.status}.`);
    }
    return response.ok;
  } catch {
    if (env.nodeEnv !== 'test') console.warn(`[LINE] rich menu ${method} failed.`);
    return false;
  }
}

// 還沒加好友時 LINE 會拒絕指定；handleFollow 會在加好友時再指定一次。
async function linkBoundRichMenu(lineUserId) {
  if (!isRichMenuConfigured() || !lineUserId) return false;
  return callLine(
    'POST',
    `/user/${encodeURIComponent(lineUserId)}/richmenu/${encodeURIComponent(env.lineRichMenuBoundId)}`,
  );
}

async function unlinkRichMenu(lineUserId) {
  if (!isRichMenuConfigured() || !lineUserId) return false;
  return callLine('DELETE', `/user/${encodeURIComponent(lineUserId)}/richmenu`);
}

// 已綁定的使用者還沒拿到目前的「已綁定」選單時指定一次，並記在 User.lineRichMenuId。
// 涵蓋：綁定當下、綁定時還沒加好友、上線前就綁定的舊同學、選單重建換了 ID。
async function ensureBoundRichMenu(user) {
  if (!isRichMenuConfigured() || !user?.lineUserId) return false;
  if (user.lineRichMenuId === env.lineRichMenuBoundId) return true;
  const linked = await linkBoundRichMenu(user.lineUserId);
  if (linked) {
    await User.findOneAndUpdate(
      { _id: user._id, lineUserId: user.lineUserId },
      { $set: { lineRichMenuId: env.lineRichMenuBoundId } },
    );
  }
  return linked;
}

module.exports = {
  isRichMenuConfigured,
  linkBoundRichMenu,
  unlinkRichMenu,
  ensureBoundRichMenu,
};
