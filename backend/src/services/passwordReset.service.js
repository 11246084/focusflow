const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const AuthSession = require('../models/authSession.model');
const AppError = require('../utils/appError');
const mailer = require('./mailer.service');
const { assertPassword } = require('../utils/passwordPolicy');
const { versionOf } = require('./authTokens.service');
const { versionFilter } = require('./pendingVerification.service');
const { TTL_MS, hashCode, createCode, equalHash, reserveMail, sendCode } = require('./verificationMail.service');
const MAX_ATTEMPTS = 5;
const invalidCodeError = () => new AppError('The verification code is invalid or has expired.', 400, 'PASSWORD_RESET_CODE_INVALID');
const normalizeEmail = (email) => typeof email === 'string' ? email.trim().toLowerCase() : '';

async function requestPasswordReset({ email, now = new Date() }) {
  if (!mailer.isMailConfigured()) throw new AppError('Password reset by email is not enabled.', 503, 'PASSWORD_RESET_UNAVAILABLE');
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new AppError('A valid email is required.', 400, 'VALIDATION_ERROR');
  const user = await User.findOne({ email: normalized });
  // Keep account existence private; the UI counts its own requests for unknown
  // accounts, while the server enforces the persisted budget for actual users.
  if (!user || user.isActive === false) return { remainingResends: 5 };
  const budget = await reserveMail(user._id, 'passwordResetMail', now);
  const code = createCode();
  const previous = user.passwordReset;
  const ongoing = previous && new Date(previous.expiresAt).getTime() > now.getTime();
  const reset = { codeHash: hashCode(user._id, code),
    expiresAt: ongoing ? previous.expiresAt : new Date(now.getTime() + TTL_MS),
    attempts: ongoing ? previous.attempts : 0, requestedAt: now };
  const updated = await User.findOneAndUpdate({ _id: user._id, ...versionFilter(versionOf(user)),
    isActive: { $ne: false }, 'passwordReset.codeHash': previous?.codeHash || null,
    ...(ongoing ? { 'passwordReset.expiresAt': { $gt: now }, 'passwordReset.attempts': { $lt: MAX_ATTEMPTS } } : {}),
  }, { $set: ongoing ? {
    'passwordReset.codeHash': reset.codeHash, 'passwordReset.requestedAt': now,
  } : { passwordReset: reset } }, { new: true });
  if (!updated) throw invalidCodeError();
  try { await sendCode(user, code, 'password_reset', reset.expiresAt); }
  catch {
    await User.findOneAndUpdate({ _id: user._id, ...versionFilter(versionOf(user)), 'passwordReset.codeHash': reset.codeHash },
      { $set: ongoing ? { 'passwordReset.codeHash': previous.codeHash, 'passwordReset.requestedAt': previous.requestedAt }
        : { passwordReset: previous || null } });
    throw new AppError('驗證信寄送失敗，請稍後再試', 502, 'PASSWORD_RESET_EMAIL_FAILED');
  }
  return { remainingResends: budget.remainingResends };
}
async function confirmPasswordReset({ email, code, newPassword, now = new Date() }) {
  await assertPassword(newPassword);
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) throw invalidCodeError();
  const user = await User.findOne({ email: normalizeEmail(email) });
  const reset = user?.passwordReset;
  if (!user || user.isActive === false || !reset?.codeHash
    || new Date(reset.expiresAt).getTime() <= now.getTime() || reset.attempts >= MAX_ATTEMPTS) throw invalidCodeError();
  const claimed = await User.findOneAndUpdate({ _id: user._id, ...versionFilter(versionOf(user)), isActive: { $ne: false }, 'passwordReset.codeHash': reset.codeHash,
    'passwordReset.expiresAt': { $gt: now }, 'passwordReset.attempts': { $lt: 5 } },
    { $inc: { 'passwordReset.attempts': 1 } }, { new: true });
  if (!claimed || !equalHash(reset.codeHash, hashCode(user._id, code.trim()))) throw invalidCodeError();
  await assertPassword(newPassword, user.passwordHash);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await User.findOneAndUpdate({ _id: user._id, ...versionFilter(versionOf(user)), isActive: { $ne: false }, 'passwordReset.codeHash': reset.codeHash,
    'passwordReset.expiresAt': { $gt: new Date() } },
    { $set: { passwordHash, passwordReset: null, pendingVerification: null,
      trustedDevices: [], mustChangePassword: false, emailVerifiedAt: now, passwordResetMail: { resendCount: -1, blockedUntil: null } },
      $inc: { tokenVersion: 1 } }, { new: true });
  if (!updated) throw invalidCodeError();
  await AuthSession.deleteMany({ userId: user._id });
}
module.exports = { requestPasswordReset, confirmPasswordReset, MAX_ATTEMPTS };
