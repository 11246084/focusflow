const User = require('../models/user.model');
const AuthSession = require('../models/authSession.model');
const AppError = require('../utils/appError');
const { toPublicUser } = require('../utils/publicUser');
const { verifyToken, versionOf, unavailable } = require('../services/authTokens.service');
const { readCookie, assertCsrf } = require('../utils/authCookies');

function requestCredential(req) {
  if (Object.hasOwn(req.headers, 'authorization')) {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization);
    return { transport: 'bearer', token: match?.[1] || '' };
  }
  return { transport: 'cookie', token: readCookie(req, 'session') };
}
async function authenticate(req, res, next) {
  const credential = requestCredential(req);
  if (!credential.token) return next(new AppError('Authentication required.', 401, 'UNAUTHORIZED'));
  let payload;
  try {
    payload = verifyToken(credential.token);
    if (payload.typ !== 'session' || !Number.isInteger(payload.ver) || !/^[a-f0-9]{32}$/.test(payload.sid)
      || typeof payload.sub !== 'string' || !Number.isInteger(payload.exp)) throw new Error();
  } catch { return next(new AppError('Invalid or expired token.', 401, 'INVALID_TOKEN')); }
  try {
    const user = await User.findById(payload.sub);
    const session = await AuthSession.findOne({ _id: payload.sid, userId: payload.sub, expiresAt: { $gt: new Date() } });
    if (!user || user.isActive === false || payload.ver !== versionOf(user) || !session) {
      return next(new AppError('User session is not available.', 401, 'UNAUTHORIZED'));
    }
    req.auth = { ...credential, payload, account: user };
    req.user = { id: String(user._id), ...toPublicUser(user) };
  } catch { return next(unavailable()); }
  try {
    if (credential.transport === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) assertCsrf(req);
    return next();
  } catch (error) { return next(error); }
}
module.exports = { authenticate, requestCredential };
