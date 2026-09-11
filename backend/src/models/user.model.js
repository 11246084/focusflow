const mongoose = require('mongoose');
const { USER_ROLE_VALUES, USER_ROLES } = require('../constants/enums');

// Presence metadata only; the image bytes live in the avatars collection (avatar.model.js).
const avatarSchema = new mongoose.Schema(
  {
    mimeType: {
      type: String,
      required: true,
      enum: ['image/jpeg', 'image/png', 'image/webp'],
    },
    updatedAt: {
      type: Date,
      required: true,
    },
  },
  {
    _id: false,
  },
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: USER_ROLE_VALUES,
      default: USER_ROLES.STUDENT,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    avatar: {
      type: avatarSchema,
      default: null,
    },
    // Optional values must be omitted, not stored as null: unique+sparse still indexes explicit null values.
    lineUserId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    lineBindAt: {
      type: Date,
      default: null,
    },
    activeCourseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      default: null,
    },
    lineConversationState: {
      type: String,
      default: 'idle',
    },
    // Pending forgot-password code; only a hash is stored (see passwordReset.service).
    passwordReset: {
      type: new mongoose.Schema(
        {
          codeHash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
          attempts: { type: Number, default: 0 },
          requestedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    lineConversationHistory: {
      type: [
        {
          role: { type: String, enum: ['user', 'model'] },
          content: { type: String },
          _id: false,
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('User', userSchema);
