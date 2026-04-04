const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const { toPublicUser } = require('../utils/publicUser');

async function authenticate(req, res, next) {
  const authorization = req.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    return next(new AppError('Authentication required.', 401, 'UNAUTHORIZED'));
  }

  const token = authorization.replace('Bearer ', '').trim();

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.sub);

    if (!user || !user.isActive) {
      return next(new AppError('User is not available.', 401, 'UNAUTHORIZED'));
    }

    req.user = {
      id: String(user._id),
      ...toPublicUser(user),
    };

    return next();
  } catch (error) {
    return next(new AppError('Invalid or expired token.', 401, 'INVALID_TOKEN'));
  }
}

module.exports = {
  authenticate,
};
