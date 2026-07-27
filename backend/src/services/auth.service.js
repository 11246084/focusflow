const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const { toPublicUser } = require('../utils/publicUser');
const { recordUsage } = require('./usageLog.service');
const {
  USAGE_LOG_EVENTS,
  USER_ROLES,
  USER_ROLE_VALUES,
} = require('../constants/enums');

const SELF_REGISTER_ROLES = new Set([USER_ROLES.STUDENT, USER_ROLES.TEACHER]);
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

function signToken(user) {
  return jwt.sign(
    { sub: String(user._id) },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}

async function register({ name, email, password, role }) {
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
    });
  } catch (error) {
    // The pre-check gives fast feedback; the unique index remains authoritative when registrations race.
    if (error?.code === 11000) {
      throw buildDuplicateUserError(error);
    }
    throw error;
  }

  const token = signToken(user);

  await recordUsage({
    userId: user._id,
    event: USAGE_LOG_EVENTS.LOGIN,
    metadata: { role: user.role, via: 'register' },
  });

  return {
    token,
    user: toPublicUser(user),
  };
}

async function login({ email, password, role }) {
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

  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }

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

  const token = signToken(user);

  await recordUsage({
    userId: user._id,
    event: USAGE_LOG_EVENTS.LOGIN,
    metadata: {
      role: user.role,
    },
  });

  return {
    token,
    user: toPublicUser(user),
  };
}

async function getCurrentUser(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  return toPublicUser(user);
}

module.exports = {
  login,
  register,
  getCurrentUser,
};
