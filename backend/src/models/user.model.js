const mongoose = require('mongoose');
const { USER_ROLE_VALUES, USER_ROLES } = require('../constants/enums');

// Persist only server-controlled avatar metadata; the image bytes remain in private filesystem storage.
const avatarSchema = new mongoose.Schema(
  {
    filename: {
      type: String,
      required: true,
      trim: true,
      match: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i,
    },
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
