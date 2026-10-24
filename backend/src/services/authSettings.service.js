const env = require('../config/env');
const RuntimeSetting = require('../models/runtimeSetting.model');

async function enabled(key, environmentValue) {
  if (!environmentValue) return false;
  if (!env.systemSettingsDbEnabled) return true;
  // Default on, including a failed settings read. A database failure must never
  // silently disable a verification requirement.
  try {
    const setting = await RuntimeSetting.findOne({ key }).lean();
    return setting?.value !== false;
  } catch { return true; }
}
async function requiredPurpose(user) {
  if (env.nodeEnv !== 'production') return null;
  if (user.mustChangePassword !== false) return 'first_login';
  if (user.role === 'admin') {
    return await enabled('auth.adminEmail2faEnabled', env.adminEmail2faEnabled) ? 'admin_2fa' : null;
  }
  return !user.emailVerifiedAt && await enabled('auth.emailVerificationEnabled', env.emailVerificationEnabled)
    ? 'email_verify' : null;
}
module.exports = { enabled, requiredPurpose };
