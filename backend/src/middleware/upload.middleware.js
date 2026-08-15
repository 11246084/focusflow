const fs = require('fs');
const path = require('path');
const multer = require('multer');
const env = require('../config/env');
const AppError = require('../utils/appError');

fs.mkdirSync(env.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, env.uploadDir);
  },
  filename(req, file, cb) {
    const originalName = decodeUploadFilename(file.originalname);
    file.originalname = originalName;
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension).replace(/[^a-zA-Z0-9-_]/g, '-');
    cb(null, `${Date.now()}-${baseName}${extension}`);
  },
});

function decodeUploadFilename(filename) {
  const raw = String(filename || '').trim();

  if (!raw) {
    return 'upload';
  }

  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? raw : decoded;
  } catch {
    return raw;
  }
}

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 500,
  },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('video/')) {
      return cb(new AppError('Only video uploads are allowed.', 400, 'INVALID_FILE_TYPE'));
    }

    return cb(null, true);
  },
});

function cleanupUploadedFiles(files) {
  for (const file of files || []) {
    try {
      if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch {
      // Best-effort cleanup after request validation fails.
    }
  }
}

function validateVideoBatchMetadata(req, res, next) {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    return next(new AppError('At least one video file is required.', 400, 'VIDEO_BATCH_FILES_REQUIRED'));
  }
  const rawTitles = req.body?.titles;
  if (rawTitles === undefined || rawTitles === null || rawTitles === '') {
    req.videoBatchTitles = [];
    return next();
  }
  let titles;
  try {
    titles = JSON.parse(rawTitles);
  } catch {
    cleanupUploadedFiles(files);
    return next(new AppError('titles must be a JSON array.', 400, 'VALIDATION_ERROR'));
  }
  if (!Array.isArray(titles) || titles.length !== files.length || titles.some((title) => typeof title !== 'string')) {
    cleanupUploadedFiles(files);
    return next(new AppError('titles must contain one string per video.', 400, 'VALIDATION_ERROR'));
  }
  req.videoBatchTitles = titles;
  return next();
}

module.exports = {
  uploadSingleVideo: upload.single('video'),
  uploadVideoBatch: upload.array('videos', 10),
  validateVideoBatchMetadata,
  decodeUploadFilename,
};
