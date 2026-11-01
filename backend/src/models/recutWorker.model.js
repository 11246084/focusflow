const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  keyHash: { type: String, required: true, select: false },
  isActive: { type: Boolean, default: true }, accepting: { type: Boolean, default: true },
  activeJobId: { type: Schema.Types.ObjectId, ref: 'RecutRenderJob', default: null },
  reservedAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, lastSeenAt: Date,
}, { timestamps: true });
module.exports = mongoose.model('RecutWorker', schema);
