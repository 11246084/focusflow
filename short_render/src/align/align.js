'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  run, ffmpegBinary, pythonBinary, readJson, writeJson,
} = require('../util');

const WINDOW_PADDING_SECONDS = 3;
const SILENCE_FILTER = 'silencedetect=noise=-33dB:d=0.18';
const round3 = (value) => Math.round(value * 1000) / 1000;

function parseSilences(stderr, offset) {
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((match) => Number(match[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((match) => Number(match[1]));
  return starts.map((start, index) => [start + offset, (ends[index] ?? start) + offset]).filter(([start, end]) => end >= start);
}

/** 該 clip 引用的 chunk 時間範圍，前後各加一點緩衝，當作要對齊的原片視窗。 */
function windowFor(clip, evidenceById) {
  const chunks = clip.chunkIds.map((id) => evidenceById.get(String(id))).filter(Boolean);
  const starts = chunks.map((chunk) => chunk.startSec).filter(Number.isFinite);
  const ends = chunks.map((chunk) => chunk.endSec).filter(Number.isFinite);
  if (!starts.length || !ends.length) {
    throw new Error(`clip "${clip.id}" cites chunks without startSec/endSec; cannot choose an alignment window`);
  }
  return {
    start: Math.max(0, Math.min(...starts) - WINDOW_PADDING_SECONDS),
    end: Math.max(...ends) + WINDOW_PADDING_SECONDS,
  };
}

/**
 * 對每個 clip 的視窗跑字詞對齊與靜音偵測。結果快取在 cacheDir，同一視窗不重跑 ASR；
 * 沒有快取的視窗會合併成一次 Python 呼叫（模型只載入一次）。
 *
 * @returns {{wordsByClip: object, silencesByClip: object, windows: object}}
 */
async function alignClips(plan, evidence, {
  sourcePath, cacheDir, model = process.env.SHORT_RENDER_ASR_MODEL || 'small', log = () => {},
}) {
  const evidenceById = new Map(evidence.map((item) => [String(item.chunkId), item]));
  fs.mkdirSync(cacheDir, { recursive: true });

  const wordsByClip = {};
  const silencesByClip = {};
  const windows = {};
  const pending = [];
  const clipsByKey = new Map();

  for (const clip of plan.clips) {
    const window = windowFor(clip, evidenceById);
    windows[clip.id] = window;
    // 引用同一組 chunk 的 clip 視窗相同：只轉錄一次、共用結果，
    // 否則同一段音訊會因為取樣差異得到不同的字詞，錨點就對不上。
    const key = crypto.createHash('sha1')
      .update(`${path.resolve(sourcePath)}|${model}|${window.start.toFixed(2)}|${window.end.toFixed(2)}`)
      .digest('hex')
      .slice(0, 12);
    const cacheFile = path.join(cacheDir, `align-${key}.json`);

    if (!clipsByKey.has(key)) clipsByKey.set(key, []);
    clipsByKey.get(key).push(clip.id);
    if (clipsByKey.get(key).length > 1) continue;

    if (fs.existsSync(cacheFile)) {
      const cached = readJson(cacheFile);
      wordsByClip[clip.id] = cached.words;
      silencesByClip[clip.id] = cached.silences;
      log(`  ${clip.id}: cached (${cached.words.length} words)`);
    } else {
      pending.push({
        clip, window, key, cacheFile, wav: path.join(cacheDir, `win-${key}.wav`), wordsFile: path.join(cacheDir, `words-${key}.json`),
      });
    }
  }

  if (pending.length) {
    for (const job of pending) {
      await run(ffmpegBinary(), [
        '-v', 'error', '-y', '-ss', String(job.window.start), '-to', String(job.window.end), '-i', sourcePath,
        '-vn', '-ac', '1', '-ar', '16000', job.wav,
      ]);
    }

    const manifest = path.join(cacheDir, 'batch-jobs.json');
    writeJson(manifest, pending.map((job) => ({ wav: job.wav, out: job.wordsFile })));
    const seconds = Math.round(pending.reduce((sum, job) => sum + job.window.end - job.window.start, 0));
    log(`  transcribing ${pending.length} window(s), ${seconds}s of audio in one batch...`);
    await run(pythonBinary(), ['-I', path.join(__dirname, 'transcribe_words.py'), '--batch', manifest, model], {
      env: { ...process.env, PYTHONUTF8: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' },
    });
    fs.rmSync(manifest, { force: true });

    for (const job of pending) {
      const words = readJson(job.wordsFile).map((word) => ({
        w: word.w, s: round3(word.s + job.window.start), e: round3(word.e + job.window.start),
      }));
      const { stderr } = await run(ffmpegBinary(), ['-hide_banner', '-i', job.wav, '-af', SILENCE_FILTER, '-f', 'null', '-']);
      const silences = parseSilences(stderr, job.window.start);

      writeJson(job.cacheFile, { window: job.window, words, silences });
      fs.rmSync(job.wav, { force: true });
      fs.rmSync(job.wordsFile, { force: true });
      wordsByClip[job.clip.id] = words;
      silencesByClip[job.clip.id] = silences;
    }
  }

  // 共用視窗的其餘 clip 取同一份結果
  for (const ids of clipsByKey.values()) {
    for (const id of ids.slice(1)) {
      wordsByClip[id] = wordsByClip[ids[0]];
      silencesByClip[id] = silencesByClip[ids[0]];
    }
  }

  return { wordsByClip, silencesByClip, windows };
}

module.exports = { alignClips, parseSilences, windowFor };
