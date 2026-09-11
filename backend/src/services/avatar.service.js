const Avatar = require('../models/avatar.model');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { toPublicUser } = require('../utils/publicUser');

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// Trust file signatures rather than the client-declared MIME type before persisting bytes.
function detectAvatarMimeType(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }

  if (
    buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

async function replaceCurrentUserAvatar({ userId, file }) {
  assertObjectId(userId, 'user');

  if (!file?.buffer?.length) {
    throw new AppError('Avatar file is required.', 400, 'AVATAR_REQUIRED');
  }

  const actualMimeType = detectAvatarMimeType(file.buffer);
  if (!actualMimeType || actualMimeType !== file.mimetype) {
    throw new AppError(
      'Avatar content does not match an allowed image type.',
      400,
      'INVALID_AVATAR_FILE',
    );
  }

  const existingUser = await User.findById(userId);
  if (!existingUser) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  const updatedAt = new Date();

  try {
    // The avatar document carries its own mimeType, so concurrent uploads resolve as
    // last-writer-wins without the bytes and the served Content-Type ever disagreeing.
    await Avatar.findOneAndUpdate(
      { userId },
      {
        $set: {
          data: file.buffer,
          mimeType: actualMimeType,
          size: file.buffer.length,
          updatedAt,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
  } catch {
    throw new AppError('Avatar storage failed.', 500, 'AVATAR_STORAGE_ERROR');
  }

  // User keeps only presence metadata for toPublicUser; the bytes stay in avatars.
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        avatar: {
          mimeType: actualMimeType,
          updatedAt,
        },
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );
  if (!updatedUser) {
    throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
  }

  return {
    user: toPublicUser(updatedUser),
    avatar: {
      mimeType: actualMimeType,
      updatedAt,
    },
  };
}

async function getCurrentUserAvatar(userId) {
  assertObjectId(userId, 'user');

  const avatar = await Avatar.findOne({ userId });
  if (!avatar?.data?.length) {
    throw new AppError('Avatar not found.', 404, 'AVATAR_NOT_FOUND');
  }

  return {
    buffer: Buffer.from(avatar.data),
    mimeType: avatar.mimeType,
  };
}

module.exports = {
  detectAvatarMimeType,
  replaceCurrentUserAvatar,
  getCurrentUserAvatar,
};
