const multer = require('multer');
const AppError = require('../utils/appError');

// Bug-report screenshots: memory storage (bytes end up in MongoDB, same as avatars),
// small per-file cap, and at most a handful per report.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_FILES = 3;
const ALLOWED_DECLARED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const feedbackUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_BYTES,
    files: MAX_ATTACHMENT_FILES,
  },
  fileFilter(req, file, callback) {
    if (!ALLOWED_DECLARED_MIME_TYPES.has(file.mimetype)) {
      return callback(new AppError(
        'Only JPEG, PNG, or WebP attachments are allowed.',
        400,
        'INVALID_FEEDBACK_ATTACHMENT_TYPE',
      ));
    }

    return callback(null, true);
  },
});

function uploadFeedbackAttachments(req, res, next) {
  feedbackUpload.array('attachments', MAX_ATTACHMENT_FILES)(req, res, (error) => {
    if (error instanceof AppError) {
      return next(error);
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(
        'Each attachment must be at most 10 MiB.',
        413,
        'FEEDBACK_ATTACHMENT_TOO_LARGE',
      ));
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT') {
      return next(new AppError(
        'At most 3 attachments are allowed per report.',
        400,
        'FEEDBACK_ATTACHMENT_LIMIT_EXCEEDED',
      ));
    }

    if (error instanceof multer.MulterError) {
      return next(new AppError('Invalid attachment upload.', 400, 'UPLOAD_ERROR'));
    }

    if (error) {
      return next(new AppError('Invalid multipart upload.', 400, 'UPLOAD_ERROR'));
    }

    return next();
  });
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES,
  uploadFeedbackAttachments,
};
