const env = require('../config/env');
const AppError = require('../utils/appError');

// 登入失敗次數限制：同一個 Email 在時間窗內連續輸錯達上限就暫時鎖定，擋掉暴力猜密碼。
// 以 Email 為單位而不是 IP：正式環境經 nginx 反向代理，後端看到的來源 IP 都是 localhost。
// 狀態存在記憶體，後端重啟會歸零；目前後端是單一 process（pm2 fork），不影響正確性。
// 不存在的 Email 也照樣計數，讓回應與存在的帳號一致，避免洩漏帳號是否存在。

const MAX_TRACKED_KEYS = 10000;
const attempts = new Map();

function getSettings() {
  return {
    maxFailures: env.loginMaxFailedAttempts,
    windowMs: env.loginFailureWindowMinutes * 60 * 1000,
    lockMs: env.loginLockMinutes * 60 * 1000,
  };
}

function keyFor(email) {
  return String(email || '').trim().toLowerCase();
}

function pruneExpired(now) {
  if (attempts.size < MAX_TRACKED_KEYS) return;
  const { windowMs } = getSettings();
  for (const [key, entry] of attempts) {
    const expired = entry.lockedUntil <= now && (entry.failures.at(-1) || 0) + windowMs <= now;
    if (expired) attempts.delete(key);
  }
}

// 回傳給前端的資訊（剩餘次數、鎖定時間）對存在與不存在的帳號都一樣，
// 不會洩漏帳號是否存在，因此放在 publicDetails 讓 production 也能顯示提醒。
function buildLockedError(lockedUntil, now) {
  const error = new AppError(
    'Too many failed login attempts. Please try again later.',
    429,
    'TOO_MANY_LOGIN_ATTEMPTS',
  );
  error.publicDetails = {
    retryAfterSec: Math.ceil((lockedUntil - now) / 1000),
    lockMinutes: env.loginLockMinutes,
  };
  return error;
}

function assertLoginAllowed(email, now = Date.now()) {
  const { maxFailures } = getSettings();
  if (maxFailures <= 0) return;

  const entry = attempts.get(keyFor(email));
  if (entry && entry.lockedUntil > now) {
    throw buildLockedError(entry.lockedUntil, now);
  }
}

// 記錄一次失敗並回傳要拋出的錯誤：還沒到上限時是帶剩餘次數的 INVALID_CREDENTIALS，
// 這次剛好達到上限時直接回鎖定錯誤，讓使用者立刻知道已被鎖定。
function buildLoginFailureError(email, now = Date.now()) {
  const invalid = new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  const { maxFailures } = getSettings();
  if (maxFailures <= 0) return invalid;

  const entry = recordLoginFailure(email, now);
  if (entry.lockedUntil > now) {
    return buildLockedError(entry.lockedUntil, now);
  }
  invalid.publicDetails = {
    remainingAttempts: Math.max(0, maxFailures - entry.failures.length),
    maxAttempts: maxFailures,
    lockMinutes: env.loginLockMinutes,
  };
  return invalid;
}

function recordLoginFailure(email, now = Date.now()) {
  const { maxFailures, windowMs, lockMs } = getSettings();
  if (maxFailures <= 0) return null;

  pruneExpired(now);
  const key = keyFor(email);
  const entry = attempts.get(key) || { failures: [], lockedUntil: 0 };
  entry.failures = entry.failures.filter((time) => time > now - windowMs);
  entry.failures.push(now);

  if (entry.failures.length >= maxFailures) {
    entry.lockedUntil = now + lockMs;
    entry.failures = [];
  }
  attempts.set(key, entry);
  return entry;
}

function recordLoginSuccess(email) {
  attempts.delete(keyFor(email));
}

function resetLoginThrottleForTests() {
  attempts.clear();
}

module.exports = {
  assertLoginAllowed,
  buildLoginFailureError,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginThrottleForTests,
};
