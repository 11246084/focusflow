const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const AuthSession = require('../models/authSession.model');
const AppError = require('../utils/appError');
const { assertPassword } = require('../utils/passwordPolicy');
const { signPendingToken, verifyToken, versionOf, issueSession } = require('./authTokens.service');
const { TTL_MS, hashCode, createCode, equalHash, reserveMail, sendCode } = require('./verificationMail.service');
const { audit } = require('./adminAudit.service');

const invalid = () => new AppError('Verification is invalid or expired.', 401, 'PENDING_INVALID');
const maskedEmail = (email) => String(email).replace(/^(.).*(@.*)$/, '$1***$2');
function resultFor(user, state, remainingResends) {
  return { pendingToken: signPendingToken(user, state), exp: Math.floor(new Date(state.expiresAt).getTime() / 1000),
    requiresVerification: true, purpose: state.purpose, maskedEmail: maskedEmail(user.email),
    codeVerified: Boolean(state.codeVerifiedAt), remainingResends };
}
async function begin(user, purpose, { skipEmail = false } = {}) {
  const budget = skipEmail ? { remainingResends: 5 } : await reserveMail(user._id);
  const code = createCode();
  const state = { jti: crypto.randomBytes(16).toString('hex'), purpose, codeHash: hashCode(user._id, code),
    expiresAt: new Date(Date.now() + TTL_MS), attempts: 0, resendCount: 0, requestedAt: new Date(),
    codeVerifiedAt: skipEmail ? new Date() : null };
  await User.findByIdAndUpdate(user._id, { $set: { pendingVerification: state } });
  if (skipEmail) return resultFor(user, state, budget.remainingResends);
  try { await sendCode(user, code, purpose, state.expiresAt); }
  catch (error) {
    await User.findOneAndUpdate({ _id: user._id, 'pendingVerification.jti': state.jti }, { $set: { pendingVerification: null } });
    if (user.role === 'admin') await audit(user._id, 'verification_mail', 'failure', 'mail_failed');
    throw error;
  }
  return resultFor(user, state, budget.remainingResends);
}
async function readPending(token) {
  let payload;
  try { payload = verifyToken(token); } catch { throw invalid(); }
  if (payload.typ !== 'pending' || typeof payload.jti !== 'string' || !Number.isInteger(payload.ver)) throw invalid();
  const user = await User.findById(payload.sub);
  const state = user?.pendingVerification;
  if (!user || user.isActive === false || versionOf(user) !== payload.ver || !state
    || state.jti !== payload.jti || state.purpose !== payload.purpose
    || new Date(state.expiresAt).getTime() <= Date.now() || state.attempts >= 5) throw invalid();
  return { user, state: { ...(state.toObject ? state.toObject() : state) }, payload };
}
async function verify({ token, code, userAgent }) {
  const { user, state, payload } = await readPending(token);
  if (state.codeVerifiedAt || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalid();
  const claimed = await User.findOneAndUpdate({ _id: user._id, ...versionFilter(payload.ver),
    'pendingVerification.jti': state.jti, 'pendingVerification.codeHash': state.codeHash,
    'pendingVerification.attempts': { $lt: 5 }, 'pendingVerification.expiresAt': { $gt: new Date() },
    'pendingVerification.codeVerifiedAt': null,
  }, { $inc: { 'pendingVerification.attempts': 1 } }, { new: true });
  // Legacy users without persisted tokenVersion are version zero; the predicate
  // is normalized by versionFilter below for all atomic pending transitions.
  if (!claimed) throw invalid();
  if (!equalHash(state.codeHash, hashCode(user._id, code))) {
    await User.findOneAndUpdate({ _id: user._id, 'pendingVerification.jti': state.jti,
      'pendingVerification.attempts': { $gte: 5 } }, { $set: { pendingVerification: null } });
    if (user.role === 'admin') await audit(user._id, 'verification', 'failure', 'invalid_code');
    throw invalid();
  }
  const next = state.purpose === 'first_login' ? { ...state, jti: crypto.randomBytes(16).toString('hex'),
    codeVerifiedAt: new Date(), expiresAt: new Date(Date.now() + TTL_MS) } : null;
  const consumed = await User.findOneAndUpdate({ _id: user._id, ...versionFilter(payload.ver),
    'pendingVerification.jti': state.jti, 'pendingVerification.codeHash': state.codeHash,
    'pendingVerification.codeVerifiedAt': null,
    'pendingVerification.expiresAt': { $gt: new Date() } }, { $set: { pendingVerification: next,
    ...(next ? {} : { emailVerifiedAt: new Date(), verificationMail: { resendCount: -1, blockedUntil: null } }) } }, { new: true });
  if (!consumed) throw invalid();
  if (user.role === 'admin') await audit(user._id, 'verification', 'success');
  if (next) return resultFor(consumed, next, Math.max(0, 5 - (user.verificationMail?.resendCount || 0)));
  return { user: consumed, ...await issueSession(consumed, { userAgent }) };
}
function versionFilter(ver) { return ver === 0 ? { $or: [{ tokenVersion: 0 }, { tokenVersion: { $exists: false } }] } : { tokenVersion: ver }; }
async function resend({ token }) {
  const { user, state } = await readPending(token);
  if (state.codeVerifiedAt) throw invalid();
  const budget = await reserveMail(user._id);
  const code = createCode();
  const codeHash = hashCode(user._id, code);
  const updated = await User.findOneAndUpdate({ _id: user._id, ...versionFilter(versionOf(user)),
    'pendingVerification.jti': state.jti, 'pendingVerification.codeHash': state.codeHash,
    'pendingVerification.attempts': { $lt: 5 },
    'pendingVerification.codeVerifiedAt': null,
    'pendingVerification.expiresAt': { $gt: new Date() } }, {
    // A verification may claim an attempt after readPending. Never replace
    // that counter with the older snapshot while rotating the code.
    $set: { 'pendingVerification.codeHash': codeHash, 'pendingVerification.requestedAt': new Date() },
    $inc: { 'pendingVerification.resendCount': 1 },
  }, { new: true });
  if (!updated) throw invalid();
  try { await sendCode(user, code, state.purpose, state.expiresAt); }
  catch (error) {
    await User.findOneAndUpdate({ _id: user._id, 'pendingVerification.jti': state.jti,
      'pendingVerification.codeHash': codeHash }, { $set: { 'pendingVerification.codeHash': state.codeHash } });
    if (user.role === 'admin') await audit(user._id, 'verification_mail', 'failure', 'mail_failed');
    throw error;
  }
  return resultFor(updated, updated.pendingVerification, budget.remainingResends);
}
async function setPassword({ token, newPassword, userAgent }) {
  const { user, state, payload } = await readPending(token);
  if (state.purpose !== 'first_login' || !state.codeVerifiedAt) throw invalid();
  await assertPassword(newPassword, user.passwordHash);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await User.findOneAndUpdate({ _id: user._id, ...versionFilter(payload.ver),
    'pendingVerification.jti': state.jti, 'pendingVerification.codeVerifiedAt': { $ne: null },
    'pendingVerification.expiresAt': { $gt: new Date() } }, {
    $set: { passwordHash, mustChangePassword: false,
      emailVerifiedAt: new Date(), pendingVerification: null, trustedDevices: [], verificationMail: { resendCount: -1, blockedUntil: null } },
    $inc: { tokenVersion: 1 },
  }, { new: true });
  if (!updated) throw invalid();
  await AuthSession.deleteMany({ userId: user._id });
  return { user: updated, ...await issueSession(updated, { userAgent }) };
}
async function cancel(token) {
  try {
    const { user, state } = await readPending(token);
    await User.findOneAndUpdate({ _id: user._id, 'pendingVerification.jti': state.jti }, { $set: { pendingVerification: null } });
  } catch (error) { if (error.code !== 'PENDING_INVALID') throw error; }
}
module.exports = { begin, verify, resend, setPassword, cancel, readPending, versionFilter };
