const bcrypt = require('bcryptjs');
const { issueSession, unavailable } = require('./authTokens.service');
const AuthSession = require('../models/authSession.model');
const { assertPassword } = require('../utils/passwordPolicy');
const { requiredPurpose } = require('./authSettings.service');
const pending = require('./pendingVerification.service');
const { useTrustedDevice } = require('./trustedDevice.service');
const { audit } = require('./adminAudit.service');
const env = require('../config/env');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const { toPublicUser } = require('../utils/publicUser');
const { recordUsage } = require('./usageLog.service');
const {
  assertLoginAllowed,
  buildLoginFailureError,
  recordLoginSuccess,
} = require('./loginThrottle.service');
const {
  USAGE_LOG_EVENTS,
  USER_ROLES,
  USER_ROLE_VALUES,
} = require('../constants/enums');

// Teacher accounts are provisioned by an admin; open teacher sign-up let anyone
// create courses, upload videos and spend the AI budget.
const SELF_REGISTER_ROLES = new Set([USER_ROLES.STUDENT]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getDuplicateKeyFields(error) {
  const fields = new Set();

  for (const source of [error?.keyPattern, error?.keyValue]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }

    for (const field of Object.keys(source)) {
      fields.add(field);
    }
  }

  return fields;
}

function buildDuplicateUserError(error) {
  const duplicateFields = getDuplicateKeyFields(error);

  if (duplicateFields.size === 1 && duplicateFields.has('email')) {
    return new AppError(
      'Email is already registered.',
      409,
      'DUPLICATE_RESOURCE',
    );
  }

  if (duplicateFields.size === 1 && duplicateFields.has('lineUserId')) {
    return new AppError(
      'LINE account is already linked to another user.',
      409,
      'LINE_ACCOUNT_ALREADY_LINKED',
    );
  }

  return new AppError(
    'Account information conflicts with an existing user.',
    409,
    'DUPLICATE_RESOURCE',
  );
}

async function completeLogin(user, { browser = false, userAgent = '', trustedDevice = '' } = {}) {
  let purpose = await requiredPurpose(user);
  if (purpose === 'admin_2fa' && await useTrustedDevice(user, trustedDevice)) purpose = null;
  if (purpose) {
    if (!browser) throw new AppError('Email verification required.', 403, 'VERIFICATION_REQUIRED');
    return pending.begin(user, purpose);
  }
  return { ...await issueSession(user, { userAgent }), user: toPublicUser(user) };
}

async function register({ name, email, password, role }, options = {}) {
  const trimmedName = String(name || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const rawPassword = typeof password === 'string' ? password : '';
  const targetRole = role ? String(role).trim().toLowerCase() : USER_ROLES.STUDENT;

  if (typeof name !== 'string' || !trimmedName) {
    throw new AppError('Name is required.', 400, 'VALIDATION_ERROR');
  }
  if (typeof email !== 'string' || !normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
    throw new AppError('A valid email is required.', 400, 'VALIDATION_ERROR');
  }
  if (typeof password !== 'string' || rawPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters.', 400, 'VALIDATION_ERROR');
  }
  await assertPassword(password);
  if (role != null && typeof role !== 'string') {
    throw new AppError('Role is not open for self-registration.', 400, 'VALIDATION_ERROR');
  }
  if (!SELF_REGISTER_ROLES.has(targetRole)) {
    throw new AppError('Role is not open for self-registration.', 400, 'VALIDATION_ERROR');
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new AppError('Email is already registered.', 409, 'DUPLICATE_RESOURCE');
  }

  const passwordHash = await bcrypt.hash(rawPassword, 10);

  let user;
  try {
    user = await User.create({
      name: trimmedName,
      email: normalizedEmail,
      passwordHash,
      role: targetRole,
      mustChangePassword: false,
      tokenVersion: 0,
    });
  } catch (error) {
    // The pre-check gives fast feedback; the unique index remains authoritative when registrations race.
    if (error?.code === 11000) {
      throw buildDuplicateUserError(error);
    }
    throw error;
  }

  const result = await completeLogin(user, options);

  await recordUsage({
    userId: user._id,
    event: USAGE_LOG_EVENTS.LOGIN,
    metadata: { role: user.role, via: 'register' },
  });

  return result;
}

async function login({ email, password, role }, options = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const requestedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';

  // Reject malformed role selectors before account lookup so they remain validation errors.
  if (!USER_ROLE_VALUES.includes(requestedRole)) {
    throw new AppError(
      'Role must be one of: student, teacher, admin.',
      400,
      'VALIDATION_ERROR',
    );
  }

  // 連續輸錯被鎖定時，連帳號都不查，直接拒絕。
  assertLoginAllowed(normalizedEmail);

  const user = await User.findOne({ email: normalizedEmail });

  // 失敗時回傳剩餘次數，讓前端提醒「再錯幾次會被鎖定」；達上限時直接回鎖定錯誤。
  if (!user) {
    if (requestedRole === USER_ROLES.ADMIN) await audit(null, 'admin_login', 'failure', 'invalid_credentials');
    throw buildLoginFailureError(normalizedEmail);
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    if (user.role === USER_ROLES.ADMIN) await audit(user._id, 'admin_login', 'failure', 'invalid_credentials');
    throw buildLoginFailureError(normalizedEmail);
  }

  recordLoginSuccess(normalizedEmail);

  if (!user.isActive) {
    throw new AppError('User is inactive.', 403, 'USER_INACTIVE');
  }

  // Compare account role only after credential checks to avoid exposing role membership to unauthenticated callers.
  if (user.role !== requestedRole) {
    throw new AppError(
      'Account type does not match the selected role.',
      403,
      'ROLE_MISMATCH',
    );
  }

  const result = await completeLogin(user, options);
  if (user.role === USER_ROLES.ADMIN) await audit(user._id, 'admin_login', 'success');

  await recordUsage({
    userId: user._id,
    event: USAGE_LOG_EVENTS.LOGIN,
    metadata: {
      role: user.role,
    },
  });

  return result;
}

async function getCurrentUser(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  return toPublicUser(user);
}

// Passwords are only ever persisted as bcrypt hashes; the current password is
// required so a stolen/left-open session cannot silently take over the account.
async function changePassword({ userId, currentPassword, newPassword, userAgent }) {
  if (typeof currentPassword !== 'string' || !currentPassword) {
    throw new AppError('Current password is required.', 400, 'VALIDATION_ERROR');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    throw new AppError('New password must be at least 8 characters.', 400, 'VALIDATION_ERROR');
  }
  if (newPassword === currentPassword) {
    throw new AppError('New password must differ from the current password.', 400, 'VALIDATION_ERROR');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    throw new AppError('Current password is incorrect.', 400, 'CURRENT_PASSWORD_INCORRECT');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await assertPassword(newPassword, user.passwordHash);
  try {
    const updated = await User.findByIdAndUpdate(user._id, {
      $set: { passwordHash, trustedDevices: [], pendingVerification: null, mustChangePassword: false },
      $inc: { tokenVersion: 1 },
    }, { new: true });
    const session = await issueSession(updated, { userAgent });
    await AuthSession.deleteMany({ userId: user._id, _id: { $ne: session.sid } });
    return { ...session, user: toPublicUser(updated) };
  } catch { throw unavailable(); }
}

// Email is the login identifier, so changing it requires the current password;
// a name-only change does not.
async function updateProfile({ userId, name, email, currentPassword }) {
  if (name === undefined && email === undefined) {
    throw new AppError('No fields to update.', 400, 'VALIDATION_ERROR');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const update = {};
  if (name !== undefined) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      throw new AppError('Name is required.', 400, 'VALIDATION_ERROR');
    }
    update.name = trimmedName;
  }

  if (email !== undefined) {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      throw new AppError('A valid email is required.', 400, 'VALIDATION_ERROR');
    }
    if (normalizedEmail !== user.email) {
      if (typeof currentPassword !== 'string' || !currentPassword) {
        throw new AppError('Current password is required to change email.', 400, 'VALIDATION_ERROR');
      }
      if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
        throw new AppError('Current password is incorrect.', 400, 'CURRENT_PASSWORD_INCORRECT');
      }
      const existing = await User.findOne({ email: normalizedEmail });
      if (existing && String(existing._id) !== String(user._id)) {
        throw new AppError('Email is already registered.', 409, 'DUPLICATE_RESOURCE');
      }
      update.email = normalizedEmail;
    }
  }

  let updated = user;
  if (Object.keys(update).length) {
    try {
      updated = await User.findByIdAndUpdate(user._id, { $set: update }, { new: true });
    } catch (error) {
      // The unique index stays authoritative when two users claim the same email concurrently.
      if (error?.code === 11000) {
        throw buildDuplicateUserError(error);
      }
      throw error;
    }
  }

  return toPublicUser(updated);
}

module.exports = {
  login,
  register,
  getCurrentUser,
  changePassword,
  updateProfile,
};
