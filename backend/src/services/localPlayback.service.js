const path = require('path');
const env = require('../config/env');
const AppError = require('../utils/appError');
const { inspectLocalUploadFile } = require('../utils/localVideoSource');

function resolvePlaybackSource(video) {
  const source = video.videoSource || video.video_source || video.sourceType;
  const remoteState = video.youtubeUpload?.remoteState;
  if (remoteState === 'ready' || (source === 'youtube' && remoteState == null)) return { type: 'youtube' };
  if (!env.localPlaybackEnabled || video.localPlayback?.compatible === false || video.metadataOnly) return { type: 'unavailable' };
  try {
    const file = inspectLocalUploadFile(video.filePath || video.file_path);
    if (file.safe && file.exists) return { type: 'local', path: file.realPath };
  } catch { /* missing or inaccessible files are unavailable */ }
  return { type: 'unavailable' };
}

// This is deliberately an API presentation transform, never a persistence or bridge transform.
function presentVideo(video) {
  if (!video) return video;
  const result = { ...video };
  const source = resolvePlaybackSource(result);
  const localUrl = `/api/v1/videos/${encodeURIComponent(String(result._id))}/source`;
  for (const key of ['sourceUrl', 'videoUrl', 'video_url']) {
    if (typeof result[key] === 'string' && result[key].startsWith('/uploads/')) {
      result[key] = source.type === 'local' ? localUrl : null;
    }
  }
  if (result.youtubeUpload?.remoteState && source.type !== 'youtube') {
    // 保留 DB 與問答的原始 YouTube 引用，只覆寫影片 API 的播放欄位。
    result.videoUrl = source.type === 'local' ? localUrl : null;
    result.video_url = result.videoUrl;
    result.sourceUrl = result.videoUrl;
    result.videoSource = source.type === 'local' ? 'upload' : null;
    result.video_source = result.videoSource;
  }
  result.playbackSource = { type: source.type };
  return result;
}

function authorizeSource({ video, metadataOnly }, user) {
  if (!env.localPlaybackEnabled) throw new AppError('Local playback is unavailable.', 409, 'LOCAL_PLAYBACK_UNAVAILABLE');
  if (metadataOnly || video.localPlayback?.compatible === false) throw new AppError('Local playback is unavailable.', 409, 'LOCAL_PLAYBACK_UNAVAILABLE');
  if (resolvePlaybackSource(video).type === 'youtube' && user.role !== 'teacher' && user.role !== 'admin') {
    throw new AppError('Local playback is unavailable.', 409, 'LOCAL_PLAYBACK_UNAVAILABLE');
  }
  try {
    const file = inspectLocalUploadFile(video.filePath || video.file_path);
    if (file.safe && file.exists && !path.relative(env.uploadDir, file.localPath).split(path.sep).includes('.incoming')) return file.realPath;
  } catch { /* do not reveal filesystem details */ }
  throw new AppError('Local playback is unavailable.', 409, 'LOCAL_PLAYBACK_UNAVAILABLE');
}

function accelEnabled() { return Boolean(env.mediaAccelRedirectEnabled); }
function accelPath(file) {
  const fs = require('fs');
  const root = fs.realpathSync.native(env.uploadDir);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new AppError('Invalid local source.', 409, 'LOCAL_PLAYBACK_UNAVAILABLE');
  const prefix = env.mediaAccelRedirectPrefix || '/_protected-uploads/';
  return `${prefix}${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
}
module.exports = { resolvePlaybackSource, presentVideo, authorizeSource, accelEnabled, accelPath };
