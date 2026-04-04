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
    const extension = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, extension).replace(/[^a-zA-Z0-9-_]/g, '-');
    cb(null, `${Date.now()}-${baseName}${extension}`);
  },
});

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
};
