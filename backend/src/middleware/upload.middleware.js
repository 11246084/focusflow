const fs = require('fs');
const path = require('path');
const multer = require('multer');
const env = require('../config/env');
const AppError = require('../utils/appError');
const crypto = require('crypto');
const uploadStorage = require('../services/uploadStorage.service');

fs.mkdirSync(env.uploadDir, { recursive: true });

const storage = {
  _handleFile(req, file, cb) {
    const incoming = path.join(env.uploadDir, '.incoming');
    try {
      fs.mkdirSync(incoming, { recursive: true });
      const root = fs.realpathSync.native(env.uploadDir);
      const realIncoming = fs.realpathSync.native(incoming);
      if (realIncoming !== path.join(root, '.incoming') || fs.lstatSync(incoming).isSymbolicLink()) throw new Error('Unsafe incoming directory.');
      const originalName = decodeUploadFilename(file.originalname);
      file.originalname = originalName;
      const extension = path.extname(originalName);
      const baseName = path.basename(originalName, extension).replace(/[^a-zA-Z0-9-_]/g, '-');
      const filename = `${req.uploadReservation}--${crypto.randomUUID()}-${baseName}${extension}`;
      const target = path.join(realIncoming, filename);
      const output = fs.createWriteStream(target, { flags: 'wx' });
      let done = false;
      const complete = (error, info) => {
        if (done) return;
        done = true;
        req.removeListener('aborted', abort);
        req.removeListener('error', abort);
        if (error) {
          output.destroy();
          if (output.closed) fs.unlink(target, () => {});
          else output.once('close', () => fs.unlink(target, () => {}));
        }
        cb(error, info);
      };
      const abort = (error) => complete(error instanceof Error ? error : new Error('Upload aborted.'));
      req.once('aborted', abort);
      req.once('error', abort);
      file.stream.once('error', complete);
      output.once('error', complete);
      output.once('finish', () => complete(null, { destination: realIncoming, filename, path: target, size: output.bytesWritten }));
      file.stream.pipe(output);
    } catch (error) { cb(error); }
  },
  _removeFile(req, file, cb) { fs.unlink(file.path, (error) => cb(error && error.code !== 'ENOENT' ? error : null)); },
};

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

function guardedUpload(multerMiddleware, maxBytes, { idleMs = 10 * 60 * 1000, heartbeatMs = 10 * 60 * 1000 } = {}) {
  return async function uploadWithReservation(req, res, next) {
    if (req.headers['transfer-encoding']) return next(new AppError('Chunked uploads are not supported.', 400, 'INVALID_CONTENT_LENGTH'));
    const raw = req.headers['content-length'];
    if (raw === undefined) return next(new AppError('Content-Length is required.', 411, 'CONTENT_LENGTH_REQUIRED'));
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0) return next(new AppError('Invalid Content-Length.', 400, 'INVALID_CONTENT_LENGTH'));
    const length = Number(raw);
    if (length > maxBytes) return next(new AppError('Upload is too large.', 413, 'UPLOAD_TOO_LARGE'));
    let token;
    let disconnected = req.aborted || req.destroyed;
    const beforeReserveAbort = () => { disconnected = true; };
    req.once('aborted', beforeReserveAbort);
    req.once('error', beforeReserveAbort);
    try { token = await uploadStorage.reserve(length); }
    catch (error) {
      req.removeListener('aborted', beforeReserveAbort);
      req.removeListener('error', beforeReserveAbort);
      return next(error);
    }
    req.removeListener('aborted', beforeReserveAbort);
    req.removeListener('error', beforeReserveAbort);
    if (disconnected || req.aborted || req.destroyed) {
      try { await uploadStorage.release(token); } catch (error) { console.error('Failed to release aborted upload reservation.', error.message); }
      return next(new AppError('Upload aborted.', 400, 'UPLOAD_ABORTED'));
    }
    req.uploadReservation = token;
    let received = 0;
    let lastHeartbeat = Date.now();
    let failed = null;
    let finished = false;
    let heartbeatPromise = Promise.resolve();
    let idleTimer;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { failed = new AppError('Upload timed out.', 408, 'UPLOAD_IDLE_TIMEOUT'); req.destroy(failed); }, idleMs);
      idleTimer.unref();
    };
    const onData = (chunk) => {
      received += chunk.length;
      if (received > length) { failed = new AppError('Upload exceeded reservation.', 413, 'UPLOAD_TOO_LARGE'); req.destroy(failed); return; }
      resetIdle();
      if (Date.now() - lastHeartbeat >= heartbeatMs) {
        lastHeartbeat = Date.now();
        heartbeatPromise = heartbeatPromise.then(() => uploadStorage.heartbeat(token)).catch((error) => { failed = error; if (!finished) req.destroy(error); });
      }
    };
    let cleanupPromise;
    const cleanup = () => {
      if (!cleanupPromise) cleanupPromise = (async () => {
        clearTimeout(idleTimer);
        req.removeListener('data', onData);
        req.removeListener('aborted', onAbort);
        await heartbeatPromise;
        try { await uploadStorage.release(token); } catch (error) { console.error('Failed to release upload reservation.', error.message); }
      })();
      return cleanupPromise;
    };
    const onAbort = () => {
      failed = failed || new AppError('Upload aborted.', 400, 'UPLOAD_ABORTED');
      // Multer may never finish when the request vanished before its first file.
      void cleanup();
    };
    resetIdle();
    req.on('data', onData);
    req.once('aborted', onAbort);
    multerMiddleware(req, res, async (error) => {
      if (finished) return;
      finished = true;
      const files = req.file ? [req.file] : (req.files || []);
      const moved = [];
      try {
        await heartbeatPromise;
        if (error || failed) throw error || failed;
        for (const file of files) {
          const name = file.filename.slice(token.length + 2);
          const destination = path.join(env.uploadDir, name);
          await fs.promises.rename(file.path, destination);
          moved.push(destination);
          file.path = destination;
          file.filename = name;
          file.destination = env.uploadDir;
        }
        await cleanup();
        return next();
      } catch (err) {
        cleanupUploadedFiles(files);
        for (const file of moved) { try { await fs.promises.unlink(file); } catch { /* best effort */ } }
        await cleanup();
        if (err.code === 'ENOSPC') return next(new AppError('Insufficient upload storage.', 507, 'UPLOAD_STORAGE_LOW'));
        return next(err);
      }
    });
  };
}

module.exports = {
  uploadSingleVideo: guardedUpload(upload.single('video'), 500 * 1024 * 1024 + 1024 * 1024),
  uploadVideoBatch: guardedUpload(upload.array('videos', 10), 10 * 500 * 1024 * 1024 + 1024 * 1024),
  validateVideoBatchMetadata,
  decodeUploadFilename,
  guardedUpload,
};
