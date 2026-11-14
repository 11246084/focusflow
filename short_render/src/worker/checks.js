'use strict';

// Decision 62; keep these values aligned with backend recutRenderChecks.service.
const LIMITS = Object.freeze({ durationToleranceSec: 0.5, blackMaxSec: 0.5, silenceMaxSec: 2,
  silenceNoiseDb: -50, blackPixelThreshold: 0.05, targetLufs: -16, lufsTolerance: 2, maxTruePeakDbtp: -1.5 });
function classifyChecks(checks, expected) {
  const fixed = [], intermittent = [];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!checks || checks.videoTracks !== 1 || checks.audioTracks !== 1 || checks.width !== expected.width
    || checks.height !== expected.height || checks.fps !== expected.fps || !finite(checks.durationSec)
    || Math.abs(checks.durationSec - expected.durationSec) > LIMITS.durationToleranceSec) fixed.push('tracks_or_specification');
  if (!finite(checks?.blackMaxSec) || checks.blackMaxSec < 0 || checks.blackMaxSec >= LIMITS.blackMaxSec) intermittent.push('black_frames');
  if (checks?.fontLoaded !== true) intermittent.push('font_not_loaded');
  if (!finite(checks?.silenceMaxSec) || checks.silenceMaxSec < 0 || checks.silenceMaxSec >= LIMITS.silenceMaxSec) fixed.push('silence');
  if (!finite(checks?.integratedLufs) || Math.abs(checks.integratedLufs - LIMITS.targetLufs) > LIMITS.lufsTolerance
    || !finite(checks?.truePeakDbtp) || checks.truePeakDbtp > LIMITS.maxTruePeakDbtp) fixed.push('loudness');
  return { valid: !fixed.length && !intermittent.length, retryable: !fixed.length && !!intermittent.length, issues: [...fixed, ...intermittent] };
}

// FFmpeg 把極短的時長印成科學記號（例如 silence_duration: 8.33333e-05）；只抓 [\d.]+ 會把 0.00008 秒讀成 8.3 秒，
// 讓正常的語句間隙被誤判成長靜音。數字一律連同指數一起解析。
const NUMBER = '(\\d+(?:\\.\\d*)?(?:[eE][-+]?\\d+)?)';
function maxDuration(stderr, label) {
  return Math.max(0, ...Array.from(stderr.matchAll(new RegExp(`${label}:\\s*${NUMBER}`, 'g')), (m) => Number(m[1])));
}
async function inspectResult({ filePath, fontLoaded, runCommand, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', signal }) {
  const probe = await runCommand(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], { signal });
  const media = JSON.parse(probe.stdout);
  const videos = media.streams.filter((s) => s.codec_type === 'video'), audios = media.streams.filter((s) => s.codec_type === 'audio');
  const video = videos[0] || {}, rate = String(video.avg_frame_rate || '').split('/').map(Number);
  const analysis = await runCommand(ffmpeg, ['-hide_banner', '-nostats', '-i', filePath,
    '-vf', `blackdetect=d=0:pix_th=${LIMITS.blackPixelThreshold}`,
    '-af', `silencedetect=n=${LIMITS.silenceNoiseDb}dB:d=0,loudnorm=I=${LIMITS.targetLufs}:TP=${LIMITS.maxTruePeakDbtp}:print_format=json`,
    '-f', 'null', '-'], { signal });
  const loudnessBlocks = analysis.stderr.match(/\{\s*"input_i"[\s\S]*?\}/g);
  if (!loudnessBlocks?.length) throw Object.assign(new Error('Missing loudness measurements.'), { code: 'RECUT_RENDER_CHECK_FAILED' });
  const loudness = JSON.parse(loudnessBlocks.at(-1));
  const durationSec = Number(media.format?.duration);
  let silenceMaxSec = maxDuration(analysis.stderr, 'silence_duration');
  // Some FFmpeg builds omit a final silence_end when input ends in silence.
  const events = Array.from(analysis.stderr.matchAll(new RegExp(`silence_(start|end):\\s*${NUMBER}`, 'g')));
  if (events.at(-1)?.[1] === 'start') silenceMaxSec = Math.max(silenceMaxSec, durationSec - Number(events.at(-1)[2]));
  return { videoTracks: videos.length, audioTracks: audios.length, width: video.width, height: video.height,
    fps: rate[0] / rate[1], durationSec, blackMaxSec: maxDuration(analysis.stderr, 'black_duration'), silenceMaxSec,
    integratedLufs: Number(loudness.input_i), truePeakDbtp: Number(loudness.input_tp), fontLoaded: fontLoaded === true };
}
module.exports = { LIMITS, classifyChecks, inspectResult };
