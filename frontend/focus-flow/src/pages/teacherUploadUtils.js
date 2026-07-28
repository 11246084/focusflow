export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const ACCEPTED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv']);

export function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function titleFromFilename(filename) {
  return String(filename || '').replace(/\.[^.]+$/, '');
}

export function validateVideoFile(file, maxBytes = MAX_VIDEO_BYTES) {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ACCEPTED_VIDEO_EXTENSIONS.has(extension)) {
    return '請選擇 MP4、MOV 或 MKV 影片。';
  }
  if (file.size > maxBytes) {
    return `「${file.name}」超過單支 500 MB 限制。`;
  }
  return '';
}

export function mergeSelectedFiles(current, incoming, maxBytes = MAX_VIDEO_BYTES) {
  const merged = new Map(current.map((file) => [fileKey(file), file]));
  const errors = [];
  Array.from(incoming || []).forEach((file) => {
    const error = validateVideoFile(file, maxBytes);
    if (error) {
      errors.push(error);
      return;
    }
    merged.set(fileKey(file), file);
  });
  return { files: [...merged.values()], errors };
}

export function isTerminalStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'skipped';
}
