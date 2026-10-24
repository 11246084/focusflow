const bcrypt = require('bcryptjs');
const AppError = require('../utils/appError');
const { createLoginThrottle } = require('./loginThrottle.service');
const { signStepUpToken, verifyToken, versionOf } = require('./authTokens.service');
const { audit } = require('./adminAudit.service');
const { assertBrowser, readCookie } = require('../utils/authCookies');
const throttle = createLoginThrottle();

async function stepUp(user, session, password) {
  if (user.role !== 'admin') throw new AppError('Admin required.', 403, 'FORBIDDEN');
  const key = String(user._id);
  throttle.assertAllowed(key);
  if (typeof password !== 'string' || !await bcrypt.compare(password, user.passwordHash)) {
    await audit(user._id, 'step_up', 'failure', 'invalid_password');
    throw throttle.fail(key);
  }
  throttle.success(key);
  await audit(user._id, 'step_up', 'success');
  return signStepUpToken(user, session);
}
function assertStepUp(req) {
  assertBrowser(req);
  let token;
  try { token = verifyToken(readCookie(req, 'stepup')); }
  catch { throw new AppError('Please re-enter your password.', 403, 'STEP_UP_REQUIRED'); }
  const { account, payload } = req.auth;
  if (account.role !== 'admin' || token.typ !== 'step_up' || token.scope !== 'admin:sensitive'
    || token.sub !== String(account._id) || token.ver !== versionOf(account)
    || token.sid !== payload.sid || !Number.isInteger(token.exp) || token.exp > payload.exp) {
    throw new AppError('Please re-enter your password.', 403, 'STEP_UP_REQUIRED');
  }
}
module.exports = { stepUp, assertStepUp, throttle };
