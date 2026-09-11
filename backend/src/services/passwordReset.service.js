const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const mailer = require('./mailer.service');

// Forgot-password flow: email a 6-digit code, then accept it once to set a new
// password. Only a hash of the code is stored; responses for unknown emails are
// identical to known ones so the endpoint cannot be used to enumerate accounts.

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function hashCode(userId, code) {
  return crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

function invalidCodeError() {
  return new AppError(
    'The verification code is invalid or has expired.',
    400,
    'PASSWORD_RESET_CODE_INVALID',
  );
}

async function requestPasswordReset({ email, now = new Date() }) {
  if (!mailer.isMailConfigured()) {
    throw new AppError('Password reset by email is not enabled.', 503, 'PASSWORD_RESET_UNAVAILABLE');
  }

  const normalizedEmail = normalizeEmail(email);
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new AppError('A valid email is required.', 400, 'VALIDATION_ERROR');
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (!user || user.isActive === false) return;

  // Throttle per account so the button cannot be used to flood a mailbox.
  const lastRequestedAt = user.passwordReset?.requestedAt ? new Date(user.passwordReset.requestedAt) : null;
  if (lastRequestedAt && now.getTime() - lastRequestedAt.getTime() < RESEND_INTERVAL_MS) return;

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await User.findByIdAndUpdate(user._id, {
    $set: {
      passwordReset: {
        codeHash: hashCode(user._id, code),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        attempts: 0,
        requestedAt: now,
      },
    },
  });

  try {
    await mailer.sendMail({
      to: normalizedEmail,
      subject: 'FocusFlow 密碼重設驗證碼',
      text: [
        `${user.name || ''} 您好：`,
        '',
        `您的 FocusFlow 密碼重設驗證碼是：${code}`,
        '驗證碼 10 分鐘內有效，請勿提供給他人。',
        '',
        '如果不是您本人申請，請忽略這封信，您的密碼不會被更改。',
      ].join('\n'),
    });
  } catch (error) {
    // A code the user never received must not stay valid.
    await User.findByIdAndUpdate(user._id, { $set: { passwordReset: null } });
    console.error('[passwordReset] failed to send verification email', { message: error.message });
    throw new AppError('Failed to send the verification email.', 502, 'PASSWORD_RESET_EMAIL_FAILED');
  }
}

async function confirmPasswordReset({ email, code, newPassword, now = new Date() }) {
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    throw new AppError('New password must be at least 8 characters.', 400, 'VALIDATION_ERROR');
  }
  const normalizedCode = typeof code === 'string' ? code.trim() : '';
  if (!/^\d{6}$/.test(normalizedCode)) throw invalidCodeError();

  const user = await User.findOne({ email: normalizeEmail(email) });
  const reset = user?.passwordReset;
  if (
    !user
    || user.isActive === false
    || !reset?.codeHash
    || new Date(reset.expiresAt).getTime() <= now.getTime()
    || (reset.attempts || 0) >= MAX_ATTEMPTS
  ) {
    throw invalidCodeError();
  }

  const expected = Buffer.from(reset.codeHash, 'hex');
  const actual = Buffer.from(hashCode(user._id, normalizedCode), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    await User.findByIdAndUpdate(user._id, {
      $set: { passwordReset: { ...reset, attempts: (reset.attempts || 0) + 1 } },
    });
    throw invalidCodeError();
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await User.findByIdAndUpdate(user._id, { $set: { passwordHash, passwordReset: null } });
}

module.exports = {
  requestPasswordReset,
  confirmPasswordReset,
  MAX_ATTEMPTS,
};
