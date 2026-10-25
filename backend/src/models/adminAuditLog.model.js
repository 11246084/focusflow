const mongoose = require('mongoose');

// Append-only through the service; never persist request bodies or credentials.
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  event: { type: String, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
  result: { type: String, enum: ['success', 'failure'], required: true },
  reason: { type: String, default: null },
}, { collection: 'adminAuditLogs', autoCreate: false, autoIndex: false, versionKey: false });
module.exports = mongoose.model('AdminAuditLog', schema);
