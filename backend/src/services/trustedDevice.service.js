const crypto = require('crypto');
const User = require('../models/user.model');
const { versionOf } = require('./authTokens.service');
const { audit } = require('./adminAudit.service');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function useTrustedDevice(user, value) {
  if (user.role !== 'admin' || user.mustChangePassword !== false || !/^[a-f0-9]{64}$/.test(value || '')) return false;
  const digest = hash(value);
  const trusted = (user.trustedDevices || []).some((device) => device.hash === digest
    && device.tokenVersion === versionOf(user) && new Date(device.expiresAt).getTime() > Date.now());
  if (trusted) await audit(user._id, 'trusted_device_use', 'success');
  return trusted;
}
async function createTrustedDevice(user, userAgent) {
  if (user.role !== 'admin') return null;
  const value = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  const { versionFilter } = require('./pendingVerification.service');
  const updated = await User.findOneAndUpdate({ _id: user._id, ...versionFilter(versionOf(user)), role: 'admin', isActive: true },
    { $push: { trustedDevices: { $each: [{ hash: hash(value), createdAt: new Date(), expiresAt,
      userAgent: String(userAgent || '').slice(0, 200), tokenVersion: versionOf(user) }], $slice: -5 } } }, { new: true });
  if (!updated) return null;
  await audit(user._id, 'trusted_device_create', 'success');
  return { value, exp: Math.floor(expiresAt.getTime() / 1000) };
}
module.exports = { useTrustedDevice, createTrustedDevice };
