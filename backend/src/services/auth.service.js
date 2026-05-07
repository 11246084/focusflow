const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const { toPublicUser } = require('../utils/publicUser');
const { recordUsage } = require('./usageLog.service');
const { USAGE_LOG_EVENTS, USER_ROLES } = require('../constants/enums');

const SELF_REGISTER_ROLES = new Set([USER_ROLES.STUDENT, USER_ROLES.TEACHER]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const rawPassword = String(password || '');
  const targetRole = role ? String(role).trim().toLowerCase() : USER_ROLES.STUDENT;

  if (!trimmedName) {
    throw new AppError('Name is required.', 400, 'VALIDATION_ERROR');
  }
  if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
    throw new AppError('A valid email is required.', 400, 'VALIDATION_ERROR');
  }
  if (rawPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters.', 400, 'VALIDATION_ERROR');
  }
  if (!SELF_REGISTER_ROLES.has(targetRole)) {
    throw new AppError('Role is not open for self-registration.', 400, 'VALIDATION_ERROR');
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new AppError('Email is already registered.', 409, 'DUPLICATE_RESOURCE');
  }

  const passwordHash = await bcrypt.hash(rawPassword, 10);

  const user = await User.create({
    name: trimmedName,
    email: normalizedEmail,
    passwordHash,
    role: targetRole,
  });

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

async function login({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    throw new AppError('User is inactive.', 403, 'USER_INACTIVE');
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
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
