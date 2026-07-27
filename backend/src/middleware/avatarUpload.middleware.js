const multer = require('multer');
const AppError = require('../utils/appError');

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_PARTS = 1;
const ALLOWED_DECLARED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AVATAR_BYTES,
    files: 1,
    fields: 0,
    // Busboy emits partsLimit when the current part count reaches the configured
    // value, and Multer treats that signal as an error. Setting N + 1 therefore
    // enforces at most N accepted parts while allowing the single avatar part.
    parts: MAX_AVATAR_PARTS + 1,
    fieldNameSize: 100,
    fieldSize: 1024,
    headerPairs: 50,
  },
  fileFilter(req, file, callback) {
    if (!ALLOWED_DECLARED_MIME_TYPES.has(file.mimetype)) {
      return callback(new AppError(
        'Only JPEG, PNG, or WebP avatars are allowed.',
        400,
        'INVALID_AVATAR_TYPE',
      ));
    }

    return callback(null, true);
  },
});

function uploadSingleAvatar(req, res, next) {
  avatarUpload.single('avatar')(req, res, (error) => {
    if (error instanceof AppError) {
      return next(error);
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(
        'Avatar must be at most 5 MiB.',
        413,
        'AVATAR_TOO_LARGE',
      ));
    }

    if (error instanceof multer.MulterError) {
      return next(new AppError(
        'Invalid avatar upload.',
        400,
        'UPLOAD_ERROR',
      ));
    }

    if (error) {
      return next(new AppError(
        'Invalid multipart upload.',
        400,
        'UPLOAD_ERROR',
      ));
    }

    return next();
  });
}

module.exports = {
  MAX_AVATAR_BYTES,
  uploadSingleAvatar,
};
