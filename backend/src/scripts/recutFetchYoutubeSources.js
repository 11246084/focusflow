// 過渡工具（2026-11-19）：VM 上沒有原片的影片，用 yt-dlp 從 YouTube 取回，讓 recut 能剪原音。
// 只處理有 youtubeVideoId、且 filePath 為空或檔案不在 VM 上的影片；不重跑語音辨識，
// 逐字稿與已凍結的證據不變。下載後比對長度，差超過 2 秒就不採用，避免時間點對不上。
// 預設只列出要處理的影片；加 --write 才下載並更新 Video.filePath。
// 用法：node src/scripts/recutFetchYoutubeSources.js (--course <courseId> | --course-title <課程名稱>)... [--write] [--cookies <file>] [--yt-dlp <path>]
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const mongoose = require('mongoose');
const Video = require('../models/video.model');
const Course = require('../models/course.model');
const VideoSegment = require('../models/videoSegment.model');
const { inspectLocalUploadFile } = require('../utils/localVideoSource');

const run = promisify(execFile);
const DURATION_TOLERANCE_SEC = 2;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function sourceMissing(video, inspect = inspectLocalUploadFile) {
  const filePath = video.filePath || video.file_path;
  if (!filePath) return true;
  try {
    const file = inspect(filePath);
    return !file.safe || !file.exists;
  } catch { return true; }
}

// 系統記錄的長度優先；沒有時以逐字稿最後一段的結束時間當下限。
function checkDuration({ downloadedSec, recordedSec, transcriptEndSec }) {
  if (!Number.isFinite(downloadedSec) || downloadedSec <= 0) return { ok: false, reason: 'downloaded duration unreadable' };
  if (Number.isFinite(recordedSec) && recordedSec > 0) {
    const diff = Math.abs(downloadedSec - recordedSec);
    return diff <= DURATION_TOLERANCE_SEC ? { ok: true } : { ok: false, reason: `duration differs by ${diff.toFixed(1)}s` };
  }
  if (Number.isFinite(transcriptEndSec) && downloadedSec + DURATION_TOLERANCE_SEC < transcriptEndSec) {
    return { ok: false, reason: `shorter than transcript (${downloadedSec.toFixed(1)}s < ${transcriptEndSec.toFixed(1)}s)` };
  }
  return { ok: true };
}

function createMediaTools({ ytDlp = 'yt-dlp', cookies = null, extraArgs = [], ffmpeg, ffprobe } = {}) {
  return {
    download: async (youtubeVideoId, outputPath) => {
      const args = ['--no-playlist', '--no-progress', '--quiet', '--no-warnings',
        '-f', 'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4]/b', '--merge-output-format', 'mp4', '-o', outputPath];
      if (ffmpeg && ffmpeg !== 'ffmpeg') args.push('--ffmpeg-location', ffmpeg);
      if (cookies) args.push('--cookies', cookies);
      args.push(...extraArgs);
      args.push(`https://www.youtube.com/watch?v=${youtubeVideoId}`);
      await run(ytDlp, args, { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    },
    probeDuration: async (file) => {
      const { stdout } = await run(ffprobe || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file],
        { timeout: 60000, windowsHide: true });
      return Number(JSON.parse(stdout).format?.duration);
    },
  };
}

async function transcriptEnd(video) {
  const ids = [String(video._id), video.videoId, video.video_id].filter(Boolean);
  const last = await VideoSegment.find({ videoId: { $in: ids } }).sort({ endSec: -1 }).limit(1).lean();
  return Number(last[0]?.endSec);
}

async function fetchYoutubeSources({ courseIds, write = false, uploadDir, media, inspect = inspectLocalUploadFile, log = () => {} }) {
  const videos = await Video.find({ courseId: { $in: courseIds.map((id) => new mongoose.Types.ObjectId(id)) } }).lean();
  const items = [];
  for (const video of videos) {
    const item = { videoId: String(video._id), title: video.title || '', youtubeVideoId: video.youtubeVideoId || null,
      previousFilePath: video.filePath || video.file_path || null };
    items.push(item);
    if (!sourceMissing(video, inspect)) { item.result = 'source present'; continue; }
    if (!YOUTUBE_ID.test(item.youtubeVideoId || '')) { item.result = 'skipped: no youtubeVideoId'; continue; }
    if (!write) { item.result = 'would fetch'; continue; }

    const finalPath = path.join(uploadDir, `youtube-source-${item.videoId}.mp4`);
    const partPath = `${finalPath}.part.mp4`;
    try {
      log(`fetching ${item.videoId} (${item.youtubeVideoId})`);
      fs.rmSync(partPath, { force: true });
      await media.download(item.youtubeVideoId, partPath);
      const downloadedSec = await media.probeDuration(partPath);
      const check = checkDuration({ downloadedSec, recordedSec: Number(video.durationSec ?? video.duration_sec),
        transcriptEndSec: await transcriptEnd(video) });
      item.downloadedSec = downloadedSec;
      if (!check.ok) { fs.rmSync(partPath, { force: true }); item.result = `rejected: ${check.reason}`; continue; }
      fs.renameSync(partPath, finalPath);
      // 條件更新：處理期間 filePath 被其他流程改過就不覆蓋。
      const updated = await Video.findOneAndUpdate({ _id: video._id, filePath: video.filePath ?? null },
        { $set: { filePath: finalPath, fileName: path.basename(finalPath) } }, { new: true });
      if (!updated) { fs.rmSync(finalPath, { force: true }); item.result = 'skipped: video changed during fetch'; continue; }
      item.result = 'fetched';
    } catch (error) {
      fs.rmSync(partPath, { force: true });
      item.result = `failed: ${String(error.stderr || error.message || error).trim().split('\n').pop().slice(0, 300)}`;
    }
  }
  return { write, count: items.length, fetched: items.filter((i) => i.result === 'fetched').length, items };
}

function parseArgs(argv) {
  const options = { courseIds: [], courseTitles: [], write: argv.includes('--write'), cookies: null, ytDlp: process.env.YTDLP_PATH || 'yt-dlp' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--course') options.courseIds.push(argv[++i]);
    if (argv[i] === '--course-title') options.courseTitles.push(argv[++i]);
    if (argv[i] === '--cookies') options.cookies = argv[++i];
    if (argv[i] === '--yt-dlp') options.ytDlp = argv[++i];
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if ((!options.courseIds.length && !options.courseTitles.length) || options.courseIds.some((id) => !mongoose.isValidObjectId(id))) {
    console.error('Usage: (--course <courseId> | --course-title <title>)... [--write] [--cookies <file>] [--yt-dlp <path>]');
    process.exitCode = 1; return;
  }
  const env = require('../config/env');
  await mongoose.connect(env.mongodbUri, { autoIndex: false, autoCreate: false });
  try {
    for (const title of options.courseTitles) {
      const courses = await Course.find({ title }).select('_id').lean();
      if (courses.length !== 1) throw new Error(`Course title "${title}" matched ${courses.length} courses; use --course <id>.`);
      options.courseIds.push(String(courses[0]._id));
    }
    // 例：YTDLP_EXTRA_ARGS='--js-runtimes node'（新版 yt-dlp 解 YouTube 需要 JavaScript runtime）。
    const extraArgs = String(process.env.YTDLP_EXTRA_ARGS || '').split(/\s+/).filter(Boolean);
    const media = createMediaTools({ ytDlp: options.ytDlp, cookies: options.cookies, extraArgs, ffmpeg: env.recutFfmpeg, ffprobe: env.recutFfprobe });
    const report = await fetchYoutubeSources({ courseIds: options.courseIds, write: options.write, uploadDir: env.uploadDir,
      media, log: (line) => console.error(line) });
    console.log(JSON.stringify(report, null, 2));
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch((error) => { console.error('Unable to fetch YouTube sources:', error.message); process.exitCode = 1; });
module.exports = { fetchYoutubeSources, checkDuration, sourceMissing, parseArgs };
