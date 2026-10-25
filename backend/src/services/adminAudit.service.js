const AdminAuditLog = require('../models/adminAuditLog.model');
const { unavailable } = require('./authTokens.service');

async function audit(userId, event, result, reason = null) {
  try { await AdminAuditLog.create({ userId, event, result, reason, createdAt: new Date() }); }
  catch { throw unavailable(); }
}
module.exports = { audit };
