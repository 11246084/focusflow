const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const env = require('../src/config/env');
const playback = require('../src/services/localPlayback.service');

test('local playback protects the file, encodes its path and limits YouTube preview', () => {
  const oldDir = env.uploadDir;
  const oldEnabled = env.localPlaybackEnabled;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-playback-'));
  try {
    env.uploadDir = dir;
    env.localPlaybackEnabled = true;
    const file = path.join(dir, '中文 space.mp4');
    fs.writeFileSync(file, 'content');
    const video = { _id: '123', videoSource: 'upload', filePath: file, videoUrl: '/uploads/old.mp4', sourceUrl: '/uploads/old.mp4', video_url: '/uploads/old.mp4' };
    assert.equal(playback.resolvePlaybackSource(video).type, 'local');
    assert.equal(playback.presentVideo(video).video_url, '/api/v1/videos/123/source');
    assert.equal(video.videoUrl, '/uploads/old.mp4');
    assert.equal(playback.accelPath(file), '/_protected-uploads/%E4%B8%AD%E6%96%87%20space.mp4');
    assert.equal(playback.authorizeSource({ video }, { role: 'student' }), fs.realpathSync(file));
    video.videoSource = 'youtube';
    assert.throws(() => playback.authorizeSource({ video }, { role: 'student' }), { statusCode: 409 });
    assert.equal(playback.authorizeSource({ video }, { role: 'teacher' }), fs.realpathSync(file));
    video.videoSource = 'upload';
    video.localPlayback = { compatible: false };
    assert.throws(() => playback.authorizeSource({ video }, { role: 'teacher' }), { statusCode: 409 });
    env.localPlaybackEnabled = false;
    assert.equal(playback.resolvePlaybackSource(video).type, 'unavailable');
  } finally {
    env.uploadDir = oldDir;
    env.localPlaybackEnabled = oldEnabled;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('symlink pointing outside and traversal paths are not served', (t) => {
  const oldDir = env.uploadDir; const oldEnabled = env.localPlaybackEnabled;
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-path-'));
  const root = path.join(parent, 'uploads'); fs.mkdirSync(root); const outside = path.join(parent, 'secret.mp4'); fs.writeFileSync(outside, 'secret');
  try {
    env.uploadDir = root; env.localPlaybackEnabled = true;
    assert.throws(() => playback.authorizeSource({ video: { filePath: path.join(root, '..', 'secret.mp4'), videoSource: 'upload' } }, { role: 'student' }), { statusCode: 409 });
    try { fs.symlinkSync(outside, path.join(root, 'link.mp4'), 'file'); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('OS disallows file symlink creation'); return; } throw error; }
    assert.throws(() => playback.authorizeSource({ video: { filePath: path.join(root, 'link.mp4'), videoSource: 'upload' } }, { role: 'student' }), { statusCode: 409 });
  } finally { env.uploadDir = oldDir; env.localPlaybackEnabled = oldEnabled; fs.rmSync(parent, { recursive: true, force: true }); }
});
test('directory junction into an outside location is refused', (t) => {
  const oldDir = env.uploadDir; const oldEnabled = env.localPlaybackEnabled;
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-junction-'));
  const root = path.join(parent, 'uploads'); const outside = path.join(parent, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'video.mp4'), 'secret');
  try {
    env.uploadDir = root; env.localPlaybackEnabled = true;
    try { fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('OS disallows directory link creation'); return; } throw error; }
    assert.throws(() => playback.authorizeSource({ video: { filePath: path.join(root, 'link', 'video.mp4'), videoSource: 'upload' } }, { role: 'student' }), { statusCode: 409 });
  } finally { env.uploadDir = oldDir; env.localPlaybackEnabled = oldEnabled; fs.rmSync(parent, { recursive: true, force: true }); }
});

test('blocked 的舊 YouTube 來源改用原片，缺檔則顯示 unavailable，不改原始引用', () => {
  const old = { uploadDir: env.uploadDir, localPlaybackEnabled: env.localPlaybackEnabled };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-blocked-playback-'));
  try {
    env.uploadDir = root; env.localPlaybackEnabled = true;
    const filePath = path.join(root, 'original.mp4'); fs.writeFileSync(filePath, 'media');
    const original = { _id: 'id', videoSource: 'youtube', filePath, videoUrl: 'https://www.youtube.com/watch?v=blocked001', sourceUrl: 'original-citation', youtubeUpload: { remoteState: 'blocked' } };
    assert.equal(playback.resolvePlaybackSource(original).type, 'local');
    const shown = playback.presentVideo(original);
    assert.equal(shown.videoUrl, '/api/v1/videos/id/source');
    assert.equal(shown.playbackSource.type, 'local');
    assert.equal(original.sourceUrl, 'original-citation');
    fs.unlinkSync(filePath);
    assert.equal(playback.presentVideo(original).playbackSource.type, 'unavailable');
    assert.equal(playback.presentVideo(original).videoUrl, null);
  } finally { Object.assign(env, old); fs.rmSync(root, { recursive: true, force: true }); }
});
