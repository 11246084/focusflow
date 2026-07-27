const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const env = require('../config/env');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { assertObjectId } = require('../utils/objectId');
const { toPublicUser } = require('../utils/publicUser');

const MIME_TO_EXTENSION = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const SERVER_AVATAR_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

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

function getAvatarDirectory() {
  return path.resolve(env.avatarUploadDir);
}

function resolveStoredAvatarPath(filename, avatarDirectory) {
  // Accept only server-generated basenames so stored metadata cannot become a traversal path.
  if (
    typeof filename !== 'string'
    || !filename
    || !SERVER_AVATAR_FILENAME.test(filename)
    || path.basename(filename) !== filename
  ) {
    return null;
  }

  const candidate = path.resolve(avatarDirectory, filename);
  const relative = path.relative(avatarDirectory, candidate);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return candidate;
}

async function ensurePrivateAvatarDirectory() {
  const configuredAvatarDirectory = getAvatarDirectory();

  try {
    env.assertPrivateAvatarUploadDir(env.uploadDir, configuredAvatarDirectory);
  } catch {
    throw new AppError(
      'Avatar storage is not safely configured.',
      500,
      'AVATAR_STORAGE_CONFIG_ERROR',
    );
  }

  let avatarDirectory;
  let publicUploadDirectory;

  try {
    await fs.mkdir(configuredAvatarDirectory, { recursive: true });
    avatarDirectory = await fs.realpath(configuredAvatarDirectory);

    try {
      publicUploadDirectory = await fs.realpath(env.uploadDir);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      publicUploadDirectory = path.resolve(env.uploadDir);
    }
  } catch {
    throw new AppError(
      'Avatar storage failed.',
      500,
      'AVATAR_STORAGE_ERROR',
    );
  }

  // Re-check resolved paths after directory creation to catch symlink-based public-storage escapes.
  try {
    env.assertPrivateAvatarUploadDir(publicUploadDirectory, avatarDirectory);
  } catch {
    throw new AppError(
      'Avatar storage is not safely configured.',
      500,
      'AVATAR_STORAGE_CONFIG_ERROR',
    );
  }

  return avatarDirectory;
}

async function removeStoredAvatar(filename, reason = 'cleanup') {
  try {
    const avatarDirectory = await ensurePrivateAvatarDirectory();
    const target = resolveStoredAvatarPath(filename, avatarDirectory);
    if (!target) {
      return false;
    }

    await fs.unlink(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    logger.warn('avatar.cleanup_failed', {
      reason,
      filename: typeof filename === 'string' ? filename : null,
      errorCode: error?.code || 'UNKNOWN',
    });
    return false;
  }
}

async function storeAvatarFile(buffer, mimeType) {
  const extension = MIME_TO_EXTENSION[mimeType];
  const id = crypto.randomUUID();
  const filename = `${id}.${extension}`;
  let finalPath;
  let temporaryPath;

  try {
    const avatarDirectory = await ensurePrivateAvatarDirectory();
    finalPath = path.resolve(avatarDirectory, filename);
    temporaryPath = path.resolve(avatarDirectory, `.${id}.tmp`);
    await fs.writeFile(temporaryPath, buffer, {
      flag: 'wx',
      mode: 0o600,
    });
    await fs.rename(temporaryPath, finalPath);
  } catch (error) {
    await Promise.allSettled([
      temporaryPath ? fs.unlink(temporaryPath) : Promise.resolve(),
      finalPath ? fs.unlink(finalPath) : Promise.resolve(),
    ]);

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      'Avatar storage failed.',
      500,
      'AVATAR_STORAGE_ERROR',
    );
  }

  return {
    filename,
  };
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

  const previousFilename = existingUser.avatar?.filename || null;
  const previousUpdatedAt = existingUser.avatar?.updatedAt || null;
  const storedFile = await storeAvatarFile(file.buffer, actualMimeType);
  const updatedAt = new Date();
  let updatedUser;

  try {
    const compareAndSwapFilter = previousFilename
      ? {
        _id: userId,
        'avatar.filename': previousFilename,
        'avatar.updatedAt': previousUpdatedAt,
      }
      : {
        _id: userId,
        avatar: null,
      };

    // Compare-and-swap prevents concurrent uploads from silently overwriting newer avatar metadata.
    updatedUser = await User.findOneAndUpdate(
      compareAndSwapFilter,
      {
        $set: {
          avatar: {
            filename: storedFile.filename,
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
      throw new AppError(
        'Avatar changed during upload. Please try again.',
        409,
        'AVATAR_UPDATE_CONFLICT',
      );
    }
  } catch (error) {
    await removeStoredAvatar(storedFile.filename, 'update_failed');
    throw error;
  }

  if (previousFilename && previousFilename !== storedFile.filename) {
    // Delete the prior file only after MongoDB points at the replacement.
    await removeStoredAvatar(previousFilename, 'replaced');
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

  const user = await User.findById(userId);
  const filename = user?.avatar?.filename;
  const mimeType = user?.avatar?.mimeType;
  if (!user || !MIME_TO_EXTENSION[mimeType]) {
    throw new AppError('Avatar not found.', 404, 'AVATAR_NOT_FOUND');
  }

  try {
    const avatarDirectory = await ensurePrivateAvatarDirectory();
    const target = resolveStoredAvatarPath(filename, avatarDirectory);
    if (!target) {
      throw new AppError('Avatar not found.', 404, 'AVATAR_NOT_FOUND');
    }

    return {
      buffer: await fs.readFile(target),
      mimeType,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (error?.code === 'ENOENT') {
      throw new AppError('Avatar not found.', 404, 'AVATAR_NOT_FOUND');
    }
    throw new AppError('Avatar storage failed.', 500, 'AVATAR_STORAGE_ERROR');
  }
}

module.exports = {
  detectAvatarMimeType,
  ensurePrivateAvatarDirectory,
  replaceCurrentUserAvatar,
  getCurrentUserAvatar,
};
