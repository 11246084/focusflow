const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const authService = require('../services/auth.service');

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required.', 400, 'VALIDATION_ERROR');
  }

  const result = await authService.login({ email, password });

  return sendSuccess(res, {
    message: 'Login successful.',
    data: result,
  });
});

const register = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

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

module.exports = {
  login,
  register,
  me,
};
