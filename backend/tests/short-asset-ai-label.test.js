const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { ids, newObjectId, resetStore, store } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const publishService = require('../src/services/shortAssetPublish.service');
const label = require('../src/services/shortAssetAiLabel.service');

// 數位分身成品上傳 YouTube 前由系統壓上 AI 揭露標示（短影片決策 UX-28）。
const ENV_KEYS = ['uploadDir', 'youtubeUploadEnabled', 'youtubeUploadAccessToken', 'youtubeUploadMaxAttempts',
  'shortScriptAutomationEnabled', 'shortAssetAiLabelEnabled'];

let tempRoot; let savedEnv; let savedFetch; let restoreRenderer;

function response(payload, headers = {}) {
  return { ok: true, status: 200, json: async () => payload, headers: { get: (key) => headers[String(key).toLowerCase()] || null } };
}

// 記下實際送到 YouTube 的檔案內容。
function fakeYouTube() {
  const uploaded = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes('uploadType=resumable')) return response({}, { location: 'https://upload.test/short' });
    if (String(url) === 'https://upload.test/short') {
      const chunks = []; for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
      uploaded.push(Buffer.concat(chunks).toString());
      return response({ id: 'short-youtube-id', status: { privacyStatus: 'unlisted', uploadStatus: 'processed', embeddable: true } });
    }
    if (String(url).includes('/youtube/v3/videos')) {
      return response({ items: [{ id: 'short-youtube-id', status: { privacyStatus: 'unlisted', uploadStatus: 'processed', embeddable: true } }] });
    }
    throw new Error(`Unexpected fake fetch: ${url}`);
  };
  return { fetchImpl, uploaded };
}

function addAsset(overrides = {}) {
  const id = newObjectId();
  const filePath = path.join(tempRoot, `${id}.mp4`);
  fs.writeFileSync(filePath, 'original video');
  const asset = { _id: id, courseId: ids.teacherCourse, title: '數位分身短片', description: '', filePath,
    status: 'draft', reviewStatus: 'pending', generationVersion: 1,
    disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true },
    youtubeUpload: { status: null, attemptCount: 0 }, ...overrides };
  store.shortAssets.push(asset);
  return asset;
}

describe('數位分身成品由系統壓 AI 標示（UX-28）', () => {
  beforeEach(() => {
    resetStore();
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    savedFetch = global.fetch; global.fetch = fakeYouTube().fetchImpl;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-ai-label-'));
    Object.assign(env, { uploadDir: tempRoot, youtubeUploadEnabled: true, youtubeUploadAccessToken: 'test-token',
      youtubeUploadMaxAttempts: 3, shortScriptAutomationEnabled: false, shortAssetAiLabelEnabled: true });
  });
  afterEach(() => {
    restoreRenderer?.(); restoreRenderer = null;
    Object.assign(env, savedEnv); global.fetch = savedFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('上傳的是壓過標示的檔案，原檔不動，暫存檔傳完刪除', async () => {
    const outputs = [];
    restoreRenderer = label.setAiLabelRendererForTest(async (input, output) => {
      outputs.push(output); fs.writeFileSync(output, `labeled:${fs.readFileSync(input, 'utf8')}`);
    });
    const asset = addAsset(); const fake = fakeYouTube();
    await publishService.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl: fake.fetchImpl });
    assert.deepEqual(fake.uploaded, ['labeled:original video']);
    assert.equal(fs.readFileSync(asset.filePath, 'utf8'), 'original video');
    assert.equal(outputs.length, 1);
    assert.equal(fs.existsSync(outputs[0]), false);
    assert.equal(asset.youtubeUpload.status, 'uploaded');
  });

  it('原片剪輯的成品不壓標示', async () => {
    let calls = 0;
    restoreRenderer = label.setAiLabelRendererForTest(async () => { calls += 1; });
    const asset = addAsset({ recutVersionId: newObjectId() }); const fake = fakeYouTube();
    await publishService.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl: fake.fetchImpl }).catch(() => null);
    assert.equal(calls, 0);
  });

  it('壓標示失敗時不送出影片，記成可安全重試', async () => {
    restoreRenderer = label.setAiLabelRendererForTest(async () => { throw new Error('ffmpeg exited 1'); });
    const asset = addAsset(); const fake = fakeYouTube();
    await assert.rejects(publishService.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl: fake.fetchImpl }),
      (error) => error.code === 'SHORT_ASSET_AI_LABEL_FAILED');
    assert.deepEqual(fake.uploaded, []);
    assert.equal(asset.youtubeUpload.status, 'failed');
    assert.equal(asset.youtubeUpload.retrySafe, true);
    assert.deepEqual(fs.readdirSync(tempRoot), [path.basename(asset.filePath)]);
  });

  it('關閉開關時上傳原檔', async () => {
    env.shortAssetAiLabelEnabled = false;
    let calls = 0;
    restoreRenderer = label.setAiLabelRendererForTest(async () => { calls += 1; });
    const asset = addAsset(); const fake = fakeYouTube();
    await publishService.uploadShortAssetToYouTube({ assetId: asset._id, fetchImpl: fake.fetchImpl });
    assert.equal(calls, 0);
    assert.deepEqual(fake.uploaded, ['original video']);
  });

  it('標示固定在右上角，位置與字級依影片高度縮放', () => {
    const filter = label.buildLabelFilter(String.raw`C:\Windows\Fonts\NotoSansTC-VF.ttf`, 960);
    assert.ok(filter.includes(String.raw`fontfile='C\:/Windows/Fonts/NotoSansTC-VF.ttf'`));
    assert.match(filter, /text='AI 合成影像・經本人授權'/);
    assert.match(filter, /fontsize=15:/);
    assert.match(filter, /x=w-tw-19:y=19$/);
  });

  it('找不到單一語系字型檔時改用 fontconfig 的繁中字型名稱', () => {
    const saved = env.shortAssetAiLabelFont;
    env.shortAssetAiLabelFont = 'Noto Sans CJK TC Medium';
    try {
      assert.deepEqual(label.resolveLabelFont(), { family: 'Noto Sans CJK TC Medium' });
      assert.ok(label.buildLabelFilter(label.resolveLabelFont()).startsWith("drawtext=font='Noto Sans CJK TC Medium'"));
    } finally { env.shortAssetAiLabelFont = saved; }
  });
});

// 本機有 FFmpeg 與字型時，用真的 FFmpeg 壓一支一秒的測試影片；沒有就略過，不假裝驗證過。
function realToolsAvailable() {
  try { execFileSync(env.recutFfmpeg, ['-version'], { stdio: 'ignore' }); return Boolean(label.resolveLabelFont().fontfile); }
  catch { return false; }
}

describe('真 FFmpeg 壓 AI 標示', { skip: !realToolsAvailable() && '本機沒有 FFmpeg 或 Noto Sans TC 字型' }, () => {
  let dir; let saved;
  beforeEach(() => { saved = env.shortAssetAiLabelEnabled; env.shortAssetAiLabelEnabled = true; dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-ai-label-real-')); });
  afterEach(() => { env.shortAssetAiLabelEnabled = saved; fs.rmSync(dir, { recursive: true, force: true }); });

  it('輸出可播放的 MP4，保留聲音與長度', async () => {
    const input = path.join(dir, 'avatar.mp4');
    execFileSync(env.recutFfmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=1080x1920:d=1:r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
    const output = await label.burnAiLabel(input, { attemptId: 'real' });
    const probe = JSON.parse(execFileSync(env.recutFfprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', output]).toString());
    assert.deepEqual(probe.streams.map((stream) => stream.codec_type).sort(), ['audio', 'video']);
    const video = probe.streams.find((stream) => stream.codec_type === 'video');
    assert.equal(video.width, 1080); assert.equal(video.height, 1920);
    assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.2);
  });
});
