const mongoose = require('mongoose');
const { USER_ROLE_VALUES, USER_ROLES } = require('../constants/enums');

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
    lineUserId: {
      type: String,
      default: null,
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
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('User', userSchema);
