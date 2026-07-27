const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const authService = require('../services/auth.service');
const avatarService = require('../services/avatar.service');
const { USER_ROLE_VALUES } = require('../constants/enums');

const login = asyncHandler(async (req, res) => {
  const {
    email: rawEmail,
    password,
    role: rawRole,
  } = req.body || {};

  if (rawEmail == null || password == null || rawRole == null) {
    throw new AppError('Email, password, and role are required.', 400, 'VALIDATION_ERROR');
  }

  if (
    typeof rawEmail !== 'string'
    || typeof password !== 'string'
    || typeof rawRole !== 'string'
  ) {
    throw new AppError(
      'Email, password, and role must be strings.',
      400,
      'VALIDATION_ERROR',
    );
  }

  const email = rawEmail.trim().toLowerCase();
  const role = rawRole.trim().toLowerCase();

  if (!email || !password || !role) {
    throw new AppError('Email, password, and role are required.', 400, 'VALIDATION_ERROR');
  }

  if (!USER_ROLE_VALUES.includes(role)) {
    throw new AppError(
      'Role must be one of: student, teacher, admin.',
      400,
      'VALIDATION_ERROR',
    );
  }

  const result = await authService.login({ email, password, role });

  return sendSuccess(res, {
    message: 'Login successful.',
    data: result,
  });
});

const register = asyncHandler(async (req, res) => {
  // Normalize non-object JSON bodies here so the service returns contract errors instead of destructuring failures.
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const { name, email, password, role } = body;

  const result = await authService.register({ name, email, password, role });

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Registration successful.',
    data: result,
  });
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(req.user.id);

  return sendSuccess(res, {
    message: 'Current user fetched successfully.',
    data: {
      user,
    },
  });
});

const updateAvatar = asyncHandler(async (req, res) => {
  const result = await avatarService.replaceCurrentUserAvatar({
    userId: req.user.id,
    file: req.file,
  });

  return sendSuccess(res, {
    message: 'Avatar updated successfully.',
    data: result,
  });
});

const getAvatar = asyncHandler(async (req, res) => {
  const avatar = await avatarService.getCurrentUserAvatar(req.user.id);

  // Avatars are authenticated private responses, so browsers must not reuse them as public assets.
  res.set({
    'Content-Type': avatar.mimeType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=0, must-revalidate',
  });
  return res.status(200).send(avatar.buffer);
});

module.exports = {
  login,
  register,
  me,
  updateAvatar,
  getAvatar,
};
