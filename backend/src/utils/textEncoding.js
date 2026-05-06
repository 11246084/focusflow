/**
 * 偵測字串是否疑似在客戶端被 ASCII encode 破壞，常見來源是 PowerShell
 * Invoke-RestMethod / curl 預設用 ASCII encoding 送 UTF-8 中文，
 * 每個 UTF-8 byte 都被 fallback 替換成 '?'。
 *
 * 判斷條件：
 *   - 字串為非空純 ASCII（沒有任何中文/全形字元）
 *   - 至少含 4 個 '?' 且 '?' 佔比 ≥ 50%
 * 或：
 *   - 字串含 Unicode REPLACEMENT CHARACTER (U+FFFD)
 *
 * 不會誤判一般含問號的提問（如 "OpenCV 是什麼?"），因為這類字串含有
 * 非 ASCII 中文字元。
 */
function isLikelyEncodingDamaged(text) {
  if (text == null) return false;
  const str = String(text);
  if (!str) return false;
  if (str.includes('�')) return true;

  const isAsciiOnly = /^[\x00-\x7F]+$/.test(str);
  if (!isAsciiOnly) return false;

  const questionMarks = (str.match(/\?/g) || []).length;
  if (questionMarks < 4) return false;
  return questionMarks / str.length >= 0.5;
}

module.exports = {
  isLikelyEncodingDamaged,
};
