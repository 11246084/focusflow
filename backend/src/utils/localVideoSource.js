const fs = require('fs');
const path = require('path');

// 重新處理只能讀 UPLOAD_DIR 內的本機原片；清理後 filePath 為 null，
// 影片回傳的 sourceAvailable 與 retry 前的檢查共用這個判斷。
function isLocalVideoSourceAvailable(filePath) {
  if (!filePath) return false;
  // bridgeScope.service 會引用本檔；呼叫時才載入 env，避免只引用 bridgeScope 的
  // 模組在測試 harness 設定環境變數之前就把 env 快取下來。
  const env = require('../config/env');
  const uploadDir = path.resolve(env.uploadDir);
  const resolvedPath = path.resolve(String(filePath));
  const relative = path.relative(uploadDir, resolvedPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  try {
    return fs.statSync(resolvedPath).isFile();
  } catch {
    return false;
  }
}

module.exports = { isLocalVideoSourceAvailable };
