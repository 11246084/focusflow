const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const authService = require('../services/auth.service');
const avatarService = require('../services/avatar.service');
const passwordResetService = require('../services/passwordReset.service');
const { USER_ROLE_VALUES } = require('../constants/enums');
const { requestCredential } = require('../middleware/auth.middleware');
const { verifyToken, revokeAll } = require('../services/authTokens.service');
const { revokeCurrent } = require('../services/authSession.service');
const pending = require('../services/pendingVerification.service');
const { createTrustedDevice } = require('../services/trustedDevice.service');
const { toPublicUser } = require('../utils/publicUser');
const cookies = require('../utils/authCookies');
const stepUpService = require('../services/stepUp.service');

function respondBrowser(req, res, result, statusCode = 200) {
  if (result.requiresVerification) {
    cookies.clearSessionCookies(res);
    cookies.setAuthCookie(req, res, 'pending', result.pendingToken, result.exp);
    const { requiresVerification, purpose, maskedEmail, codeVerified, remainingResends } = result;
    return sendSuccess(res, { statusCode, data: { requiresVerification, purpose, maskedEmail, codeVerified, remainingResends } });
  }
  cookies.clearAuthCookie(res, 'pending');
  cookies.clearAuthCookie(res, 'stepup');
  cookies.setAuthCookie(req, res, 'session', result.token, result.exp);
  const user = result.user?._id ? toPublicUser(result.user) : result.user;
  return sendSuccess(res, { statusCode, message: statusCode === 201 ? 'Registration successful.' : 'Login successful.', data: { user } });
}

const login = asyncHandler(async (req, res) => {
  const browser = req.path === '/session';
  if (browser) cookies.assertBrowser(req);
  else if (['origin', 'sec-fetch-site', 'sec-fetch-dest'].some((key) => Object.hasOwn(req.headers, key))) {
    throw new AppError('Use the browser session endpoint.', 403, 'BROWSER_LOGIN_REJECTED');
  }
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

  const result = await authService.login({ email, password, role }, {
    browser, userAgent: req.headers['user-agent'], trustedDevice: cookies.readCookie(req, 'trusted'),
  });
  if (browser) return respondBrowser(req, res, result);

  return sendSuccess(res, {
    message: 'Login successful.',
    data: { token: result.token, user: result.user },
  });
});

const register = asyncHandler(async (req, res) => {
  cookies.assertBrowser(req);
  // Normalize non-object JSON bodies here so the service returns contract errors instead of destructuring failures.
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const { name, email, password, role } = body;

  const result = await authService.register({ name, email, password, role }, { browser: true, userAgent: req.headers['user-agent'] });
  return respondBrowser(req, res, result, 201);
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

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const result = await authService.changePassword({ userId: req.user.id, currentPassword, newPassword, userAgent: req.headers['user-agent'] });
  if (req.auth.transport === 'cookie') {
    cookies.clearAuthCookie(res, 'trusted');
    return respondBrowser(req, res, result);
  }
  return sendSuccess(res, { data: { token: result.token, user: result.user } });
});

const updateMe = asyncHandler(async (req, res) => {
  const { name, email, currentPassword } = req.body || {};
  const user = await authService.updateProfile({ userId: req.user.id, name, email, currentPassword });

  return sendSuccess(res, { message: 'Profile updated successfully.', data: { user } });
});

// Same response whether or not the email exists, to avoid account enumeration.
const requestPasswordReset = asyncHandler(async (req, res) => {
  if (Object.hasOwn(req.headers, 'origin') || req.headers.cookie) cookies.assertCsrf(req);
  const data = await passwordResetService.requestPasswordReset({ email: req.body?.email });
  return sendSuccess(res, {
    message: 'If the email is registered, a verification code has been sent.',
    data,
  });
});

const logout = asyncHandler(async (req, res) => {
  const credential = requestCredential(req);
  if (credential.transport === 'cookie') cookies.assertCsrf(req);
  await revokeCurrent(credential);
  if (credential.transport === 'cookie') cookies.clearSessionCookies(res);
  return res.sendStatus(204);
});
const logoutAll = asyncHandler(async (req, res) => {
  await revokeAll(req.user.id);
  if (req.auth.transport === 'cookie') {
    cookies.clearSessionCookies(res);
    cookies.clearAuthCookie(res, 'pending');
    cookies.clearAuthCookie(res, 'trusted');
  }
  return res.sendStatus(204);
});
const stepUp = asyncHandler(async (req, res) => {
  cookies.assertBrowser(req);
  const token = await stepUpService.stepUp(req.auth.account, req.auth.payload, req.body?.password);
  cookies.setAuthCookie(req, res, 'stepup', token, verifyToken(token).exp);
  return res.sendStatus(204);
});
async function trustIfRequested(req, res, result) {
  if (req.body?.trustDevice !== undefined && typeof req.body.trustDevice !== 'boolean') {
    throw new AppError('trustDevice must be a boolean.', 400, 'VALIDATION_ERROR');
  }
  if (req.body?.trustDevice && !result.requiresVerification) {
    const trusted = await createTrustedDevice(result.user, req.headers['user-agent']);
    if (trusted) cookies.setAuthCookie(req, res, 'trusted', trusted.value, trusted.exp);
  }
}
const verifyPending = asyncHandler(async (req, res) => {
  cookies.assertBrowser(req);
  if (req.body?.trustDevice !== undefined && typeof req.body.trustDevice !== 'boolean') throw new AppError('trustDevice must be a boolean.', 400, 'VALIDATION_ERROR');
  const result = await pending.verify({ token: cookies.readCookie(req, 'pending'), code: req.body?.code, userAgent: req.headers['user-agent'] });
  await trustIfRequested(req, res, result);
  return respondBrowser(req, res, result);
});
const resendPending = asyncHandler(async (req, res) => {
  cookies.assertBrowser(req);
  return respondBrowser(req, res, await pending.resend({ token: cookies.readCookie(req, 'pending') }));
});
const pendingPassword = asyncHandler(async (req, res) => {
  cookies.assertBrowser(req);
  if (req.body?.trustDevice !== undefined && typeof req.body.trustDevice !== 'boolean') throw new AppError('trustDevice must be a boolean.', 400, 'VALIDATION_ERROR');
  const result = await pending.setPassword({ token: cookies.readCookie(req, 'pending'), newPassword: req.body?.newPassword, userAgent: req.headers['user-agent'] });
  cookies.clearAuthCookie(res, 'trusted');
  await trustIfRequested(req, res, result);
  return respondBrowser(req, res, result);
});
const cancelPending = asyncHandler(async (req, res) => {
  cookies.assertBrowser(req);
  await pending.cancel(cookies.readCookie(req, 'pending'));
  cookies.clearAuthCookie(res, 'pending');
  return res.sendStatus(204);
});

const confirmPasswordReset = asyncHandler(async (req, res) => {
  if (Object.hasOwn(req.headers, 'origin') || req.headers.cookie) cookies.assertCsrf(req);
  const { email, code, newPassword } = req.body || {};
  await passwordResetService.confirmPasswordReset({ email, code, newPassword });
  return sendSuccess(res, { message: 'Password has been reset.' });
});

module.exports = {
  logout, logoutAll, stepUp, verifyPending, resendPending, pendingPassword, cancelPending,
  requestPasswordReset,
  confirmPasswordReset,
  login,
  register,
  me,
  updateMe,
  changePassword,
  updateAvatar,
  getAvatar,
};
