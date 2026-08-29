const fs = require('fs');
const path = require('path');
const AppError = require('../utils/appError');

const ISO_BMFF_EXTENSIONS = new Set(['.mp4', '.mov']);
const MATROSKA_EXTENSIONS = new Set(['.mkv']);
const EBML_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

function invalidMedia(message, details = undefined) {
  return new AppError(message, 400, 'INVALID_MEDIA_CONTAINER', details);
}

function inspectIsoBmff(filePath, fileSize) {
  const descriptor = fs.openSync(filePath, 'r');
  const boxes = new Set();
  let offset = 0;
  try {
    while (offset + 8 <= fileSize) {
      const header = Buffer.alloc(16);
      const bytesRead = fs.readSync(descriptor, header, 0, 16, offset);
      if (bytesRead < 8) break;
      const type = header.toString('ascii', 4, 8);
      let headerSize = 8;
      let boxSize = header.readUInt32BE(0);
      if (boxSize === 1) {
        if (bytesRead < 16) throw invalidMedia('The MP4 container has an incomplete box header.');
        const extendedSize = header.readBigUInt64BE(8);
        if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw invalidMedia('The MP4 container contains an unsupported box size.');
        }
        boxSize = Number(extendedSize);
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = fileSize - offset;
      }
      if (boxSize < headerSize || offset + boxSize > fileSize) {
        throw invalidMedia('The MP4 container is truncated or has an invalid box size.');
      }
      boxes.add(type);
      offset += boxSize;
    }
  } finally {
    fs.closeSync(descriptor);
  }

  const missingBoxes = ['ftyp', 'mdat', 'moov'].filter((box) => !boxes.has(box));
  if (missingBoxes.length) {
    const missing = missingBoxes.join(', ');
    throw invalidMedia(
      `The MP4 container is incomplete (missing ${missing}). Please replace or re-export the source video.`,
      { missingBoxes },
    );
  }
  return { container: 'iso-bmff', boxes: [...boxes] };
}

function inspectMatroska(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(4);
  try {
    fs.readSync(descriptor, header, 0, 4, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (!header.equals(EBML_SIGNATURE)) {
    throw invalidMedia('The MKV container has an invalid EBML header.');
  }
  return { container: 'matroska' };
}

function assertMediaIntegrity(filePath, originalName = filePath) {
  const resolvedPath = path.resolve(String(filePath || ''));
  let stats;
  try {
    stats = fs.statSync(resolvedPath);
  } catch {
    throw invalidMedia('The uploaded video file is unavailable.');
  }
  if (!stats.isFile() || stats.size < 8) {
    throw invalidMedia('The uploaded video file is empty or incomplete.');
  }

  const extension = path.extname(String(originalName || resolvedPath)).toLowerCase();
  if (ISO_BMFF_EXTENSIONS.has(extension)) return inspectIsoBmff(resolvedPath, stats.size);
  if (MATROSKA_EXTENSIONS.has(extension)) return inspectMatroska(resolvedPath);
  throw invalidMedia('The uploaded video container is not supported.');
}

module.exports = { assertMediaIntegrity };
