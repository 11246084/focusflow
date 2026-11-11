const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const { normalizeRecutAsrResult } = require('./recutAsrNormalization.service');
const os = require('node:os');
const path = require('node:path');
const env = require('../config/env');
const { inspectLocalUploadFile } = require('../utils/localVideoSource');
const AppError = require('../utils/appError');
const execute = promisify(execFile);
let asrTail = Promise.resolve();
function serialAsr(action) {
  const result = asrTail.then(action, action);
  asrTail = result.catch(() => {}); return result;
}
async function hashLocalSource(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function createRecutMediaTools({ run = execute, hashSource = hashLocalSource, resolveSource = (file) => {
  const source = inspectLocalUploadFile(file);
  if (!source.safe || !source.exists) throw new AppError('本機原片不存在或不在允許目錄內。', 422, 'RECUT_SOURCE_UNAVAILABLE');
  return source.localPath;
} } = {}) {
  const ffmpeg = env.recutFfmpeg; const ffprobe = env.recutFfprobe;
  const call = (binary, args, extra = {}) => run(binary, args, { timeout: 600000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...extra });
  const inputArgs = (file, w) => ['-nostdin', '-v', 'error', '-xerror', '-ss', String(w.startSec), '-t', String(w.endSec - w.startSec), '-protocol_whitelist', 'file,pipe', '-i', resolveSource(file)];
  return {
    probe: async (file) => {
      try { return JSON.parse((await call(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', resolveSource(file)])).stdout); }
      catch (error) { if (error.code === 'RECUT_SOURCE_UNAVAILABLE') throw error; throw new AppError('原片資訊無法讀取。', 422, 'RECUT_SOURCE_UNDECODABLE'); }
    },
    decode: (file, w) => call(ffmpeg, [...inputArgs(file, w), '-map', '0:a:0', '-f', 'null', '-']),
    measure: async (file, w) => {
      const args = inputArgs(file, w); args[2] = 'info';
      const { stderr } = await call(ffmpeg, [...args, '-map', '0:a:0', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
      const raw = [...String(stderr).matchAll(/\{[^{}]*"input_i"[^{}]*\}/g)].at(-1)?.[0];
      if (!raw) throw new AppError('原片音量量測結果無法讀取。', 422, 'RECUT_SOURCE_AUDIO_INVALID');
      const measured = JSON.parse(raw);
      return { integratedLufs: Number(measured.input_i), truePeakDbtp: Number(measured.input_tp) };
    },
    transcribe: (file, w) => serialAsr(async () => {
      const root = path.resolve(os.tmpdir()); const directory = await fs.mkdtemp(path.join(root, 'focusflow-recut-'));
      try {
        const wav = path.join(directory, 'window.wav'); const output = path.join(directory, 'words.json');
        await call(ffmpeg, [...inputArgs(file, w), '-vn', '-ac', '1', '-ar', '16000', wav]);
        await call(env.recutPython, ['-I', path.resolve(__dirname, '../../../short_render/src/align/transcribe_words.py'), wav, output, env.recutAsrModel],
          { env: { ...process.env, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } });
        const raw = JSON.parse(await fs.readFile(output, 'utf8'));
        const normalized = normalizeRecutAsrResult(raw, w, { boundaryCut: true });
        return { ...normalized, sourceSha256: await hashSource(resolveSource(file)),
          asrProvenance: { ...normalized.asrProvenance, boundaryEvidence: {
            kind: 'ffmpeg-extracted-window', startSec: w.startSec, endSec: w.endSec, durationSec: w.endSec - w.startSec,
          } } };
      } finally {
        const relative = path.relative(root, directory);
        if (path.isAbsolute(relative) || relative.startsWith('..') || !relative.startsWith('focusflow-recut-')) throw new Error('Unsafe recut temp directory.');
        await fs.rm(directory, { recursive: true, force: true });
      }
    }),
  };
}
module.exports = { createRecutMediaTools };
