const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  userAgent: { type: String, maxlength: 200, default: '' },
}, { collection: 'authSessions', autoIndex: false, autoCreate: false, versionKey: false });
schema.index({ userId: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('AuthSession', schema);
