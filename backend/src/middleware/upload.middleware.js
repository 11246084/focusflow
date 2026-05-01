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

module.exports = {
  uploadSingleVideo: upload.single('video'),
  decodeUploadFilename,
};
