const crypto = require('crypto');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const mailer = require('./mailer.service');

const TTL_MS = 600000;
const hashCode = (userId, code) => crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
const createCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
function equalHash(left, right) {
  const a = Buffer.from(left || '', 'hex'); const b = Buffer.from(right || '', 'hex');
  return a.length === 32 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function mailLimitError(until) {
  const error = new AppError('Email temporarily paused. Please try again later.', 429, 'VERIFICATION_MAIL_PAUSED');
  error.publicDetails = { remainingResends: 0, retryAfterSec: Math.max(1, Math.ceil((until - Date.now()) / 1000)) };
  return error;
}
// Separate pending/reset budgets, each persisted on the account rather than on
// a replaceable pending credential. CAS also limits concurrent resends.
async function reserveMail(userId, field = 'verificationMail', now = new Date()) {
  for (let tries = 0; tries < 10; tries += 1) {
    // lean is essential: Mongoose supplies defaults for legacy documents, but
    // CAS predicates must describe the fields actually persisted in MongoDB.
    const user = await User.findById(userId).lean();
    const state = user?.[field];
    if (!user) throw new AppError('Account unavailable.', 401, 'UNAUTHORIZED');
    const until = state?.blockedUntil && new Date(state.blockedUntil).getTime();
    if (until > now.getTime()) throw mailLimitError(until);
    const previous = state?.resendCount;
    const count = until && until <= now.getTime() ? 0 : (previous ?? -1) + 1;
    const next = { resendCount: count, blockedUntil: count >= 5 ? new Date(now.getTime() + TTL_MS) : null };
    const updated = await User.findOneAndUpdate({ _id: userId,
      [`${field}.resendCount`]: previous ?? null,
      [`${field}.blockedUntil`]: state?.blockedUntil ?? null,
    }, { $set: { [field]: next } }, { new: true });
    if (updated) return { remainingResends: Math.max(0, 5 - count), ...next };
  }
  throw new AppError('Email request busy. Please retry.', 503, 'AUTH_UNAVAILABLE');
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function buildVerificationMail({ code, purpose, expiresAt, now = new Date() }) {
  const title = purpose === 'password_reset' ? '密碼重設' : '登入與信箱驗證';
  const expiry = new Date(expiresAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const loginTime = now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const text = `FocusFlow ${title}\n\n驗證碼：${code}\n有效至：${expiry}（台灣時間）\n操作時間：${loginTime}（台灣時間）\n如果不是你本人操作，請立即修改密碼\n收不到嗎？請檢查垃圾郵件匣`;
  // Original markup informed by Postmark's table/inline-CSS email guidance:
  // https://github.com/ActiveCampaign/postmark-templates (no template code copied).
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f5f7;color:#182c38;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px"><tr><td style="padding:32px"><p style="font-size:20px;font-weight:bold;color:#177d80;margin:0 0 24px">FocusFlow</p><h1 style="font-size:24px;margin:0 0 16px">${title}</h1><p>請在驗證畫面輸入以下 6 碼：</p><p style="font-size:40px;font-weight:bold;letter-spacing:6px;margin:24px 0">${escapeHtml(code)}</p><p style="font-size:14px">有效至：${escapeHtml(expiry)}（台灣時間）</p><p style="font-size:14px">操作時間：${escapeHtml(loginTime)}（台灣時間）</p><p style="font-size:14px">如果不是你本人操作，請立即修改密碼</p><p style="font-size:13px;color:#566574">請勿把驗證碼提供給他人。</p></td></tr></table></td></tr></table></body></html>`;
  return { subject: `${code} — FocusFlow ${title}驗證碼`, text, html };
}
async function sendCode(user, code, purpose, expiresAt) {
  if (!mailer.isMailConfigured()) throw new AppError('驗證信寄送失敗，請稍後再試', 503, 'VERIFICATION_EMAIL_FAILED');
  try { await mailer.sendMail({ to: user.email, ...buildVerificationMail({ code, purpose, expiresAt }) }); }
  catch { throw new AppError('驗證信寄送失敗，請稍後再試', 502, 'VERIFICATION_EMAIL_FAILED'); }
}
module.exports = { TTL_MS, hashCode, createCode, equalHash, reserveMail, sendCode, buildVerificationMail };
