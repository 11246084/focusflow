const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resetStore, store, ids } = require('./helpers/backendTestHarness');
const { fetchYoutubeSources, checkDuration, parseArgs } = require('../src/scripts/recutFetchYoutubeSources');

const missing = () => ({ safe: true, exists: false });
const youtubeId = 'abcdefghijk';

describe('recut 過渡工具：從 YouTube 取回缺少的原片', () => {
  let dir;
  beforeEach(() => {
    resetStore();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-source-'));
    const video = store.videos.find((v) => String(v._id) === ids.teacherVideo);
    Object.assign(video, { youtubeVideoId: youtubeId, filePath: '/old/machine/a.mp4', durationSec: 600 });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const media = (durationSec, calls = []) => ({
    download: async (id, out) => { calls.push(id); fs.writeFileSync(out, 'fake'); },
    probeDuration: async () => durationSec,
  });
  const video = () => store.videos.find((v) => String(v._id) === ids.teacherVideo);

  it('預設只列出要取回的影片，不下載也不改資料', async () => {
    const calls = [];
    const report = await fetchYoutubeSources({ courseIds: [ids.teacherCourse], uploadDir: dir, media: media(600, calls), inspect: missing });
    assert.equal(report.items[0].result, 'would fetch'); assert.equal(calls.length, 0);
    assert.equal(video().filePath, '/old/machine/a.mp4');
  });
  it('加 --write 時下載到上傳目錄並更新 filePath', async () => {
    const report = await fetchYoutubeSources({ courseIds: [ids.teacherCourse], write: true, uploadDir: dir, media: media(601), inspect: missing });
    assert.equal(report.fetched, 1);
    assert.equal(video().filePath, path.join(dir, `youtube-source-${ids.teacherVideo}.mp4`));
    assert.ok(fs.existsSync(video().filePath));
  });
  it('長度差超過 2 秒不採用，刪掉下載檔、資料不變', async () => {
    const report = await fetchYoutubeSources({ courseIds: [ids.teacherCourse], write: true, uploadDir: dir, media: media(560), inspect: missing });
    assert.match(report.items[0].result, /^rejected/); assert.equal(video().filePath, '/old/machine/a.mp4');
    assert.deepEqual(fs.readdirSync(dir), []);
  });
  it('原片還在就略過', async () => {
    const calls = [];
    const report = await fetchYoutubeSources({ courseIds: [ids.teacherCourse], write: true, uploadDir: dir,
      media: media(600, calls), inspect: () => ({ safe: true, exists: true }) });
    assert.equal(report.items[0].result, 'source present'); assert.equal(calls.length, 0);
  });
  it('下載失敗記錄原因並清掉暫存檔', async () => {
    const failing = { download: async (id, out) => { fs.writeFileSync(out, 'partial'); throw Object.assign(new Error('x'), { stderr: 'ERROR: Sign in to confirm' }); },
      probeDuration: async () => 600 };
    const report = await fetchYoutubeSources({ courseIds: [ids.teacherCourse], write: true, uploadDir: dir, media: failing, inspect: missing });
    assert.equal(report.items[0].result, 'failed: ERROR: Sign in to confirm'); assert.deepEqual(fs.readdirSync(dir), []);
  });
  it('沒有記錄長度時，比逐字稿最後時間還短就不採用', () => {
    assert.equal(checkDuration({ downloadedSec: 100, transcriptEndSec: 300 }).ok, false);
    assert.equal(checkDuration({ downloadedSec: 299, transcriptEndSec: 300 }).ok, true);
  });
  it('參數解析：可重複 --course，預設不寫入', () => {
    const options = parseArgs(['--course', 'a', '--course', 'b', '--cookies', 'c.txt']);
    assert.deepEqual(options.courseIds, ['a', 'b']); assert.equal(options.write, false); assert.equal(options.cookies, 'c.txt');
  });
});
