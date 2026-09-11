const mongoose = require('mongoose');

// Avatar bytes live in their own collection so User reads (every authenticated
// request, aggregates, $lookup) never carry image payloads. One document per user.
const avatarSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    data: {
      type: Buffer,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
      enum: ['image/jpeg', 'image/png', 'image/webp'],
    },
    size: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  {
    timestamps: true,
    collection: 'avatars',
  },
);

module.exports = mongoose.model('Avatar', avatarSchema);
