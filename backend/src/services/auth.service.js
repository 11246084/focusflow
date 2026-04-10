const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const { toPublicUser } = require('../utils/publicUser');
const { recordUsage } = require('./usageLog.service');
const { USAGE_LOG_EVENTS } = require('../constants/enums');

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

  const token = jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
    },
    env.jwtSecret,
    {
      expiresIn: env.jwtExpiresIn,
    },
  );

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
  getCurrentUser,
};
