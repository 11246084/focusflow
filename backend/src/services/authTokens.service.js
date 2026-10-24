const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AuthSession = require('../models/authSession.model');
const User = require('../models/user.model');
const AppError = require('../utils/appError');

const unavailable = () => new AppError('Authentication storage unavailable.', 503, 'AUTH_UNAVAILABLE');
const versionOf = (user) => user.tokenVersion ?? 0;
const subjectOf = (user) => String(user._id || user.id);
const sessionLifetime = (user) => user.role === 'admin' ? 12 * 3600 : 7 * 86400;

async function issueSession(user, { expiresIn = sessionLifetime(user), userAgent = '' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  // Public callers use seconds; deployment probes may retain the existing '5m' notation.
  const seconds = typeof expiresIn === 'number' ? expiresIn
    : ({ '5m': 300, '12h': 43200, '7d': 604800 })[expiresIn];
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > sessionLifetime(user)) throw unavailable();
  const sid = crypto.randomBytes(16).toString('hex');
  try {
    await AuthSession.create({ _id: sid, userId: subjectOf(user), createdAt: new Date(),
      expiresAt: new Date((now + seconds) * 1000), userAgent: String(userAgent).slice(0, 200) });
    const excess = await AuthSession.find({ userId: subjectOf(user) })
      .sort({ createdAt: -1, _id: -1 }).skip(20).select('_id').lean();
    if (excess.length) await AuthSession.deleteMany({ _id: { $in: excess.map((item) => item._id) } });
    const token = jwt.sign({ sub: subjectOf(user), typ: 'session', ver: versionOf(user), sid,
      iat: now, exp: now + seconds }, env.jwtSecret, { algorithm: 'HS256' });
    return { token, sid, exp: now + seconds };
  } catch {
    throw unavailable();
  }
}

function signPendingToken(user, state) {
  return jwt.sign({ sub: subjectOf(user), typ: 'pending', purpose: state.purpose,
    ver: versionOf(user), jti: state.jti, exp: Math.floor(new Date(state.expiresAt).getTime() / 1000) },
  env.jwtSecret, { algorithm: 'HS256' });
}
function signStepUpToken(user, session) {
  return jwt.sign({ sub: subjectOf(user), typ: 'step_up', scope: 'admin:sensitive',
    ver: versionOf(user), sid: session.sid,
    exp: Math.min(Math.floor(Date.now() / 1000) + 300, session.exp) }, env.jwtSecret, { algorithm: 'HS256' });
}
function verifyToken(token, options = {}) {
  return jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'], ...options });
}
async function revokeAll(userId, update = {}) {
  try {
    const user = await User.findByIdAndUpdate(userId, {
      ...update, $inc: { ...update.$inc, tokenVersion: 1 },
      $set: { ...update.$set, trustedDevices: [], pendingVerification: null },
    }, { new: true });
    if (!user) throw unavailable();
    await AuthSession.deleteMany({ userId });
    return user;
  } catch { throw unavailable(); }
}
module.exports = { issueSession, signPendingToken, signStepUpToken, verifyToken, versionOf,
  sessionLifetime, unavailable, revokeAll };
