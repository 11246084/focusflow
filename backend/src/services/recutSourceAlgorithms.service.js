'use strict';
const C = require('../constants/recutSource');
const AppError = require('../utils/appError');
const round = (v) => Math.round(v * 1000) / 1000;
function fail(message = '找不到同一支影片內的連續 2～3 分鐘視窗。', code = 'RECUT_WINDOW_NOT_FOUND') {
  throw new AppError(message, 422, code);
}
function validTime(s) { return Number.isFinite(s?.startSec) && Number.isFinite(s?.endSec) && s.startSec >= 0 && s.endSec > s.startSec; }
const chunkId = (s) => String(s.chunkId || s.segmentId || s._id || '');

function expandContinuousWindow({ hits, segments, frozenAt = new Date() }) {
  if (!Array.isArray(hits) || !hits.length || hits.some((h) => !h.videoId || !validTime(h))) fail();
  const videoIds = new Set(hits.map((h) => String(h.videoId)));
  if (videoIds.size !== 1) fail('命中分散在不同影片，無法建立連續視窗。');
  const videoId = [...videoIds][0];
  const ordered = [...new Map(segments.filter((s) => String(s.videoId) === videoId && validTime(s)).map((s) => [chunkId(s), s])).values()]
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  if (hits.some((h) => !ordered.some((s) => chunkId(s) === chunkId(h)))) fail();
  const firstHit = Math.min(...hits.map((h) => h.startSec));
  const lastHit = Math.max(...hits.map((h) => h.endSec));
  if (lastHit - firstHit > C.MAX_WINDOW_SEC) fail('同一影片的命中相距超過三分鐘。');
  const candidates = [];
  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i].startSec;
    if (start > firstHit || start < lastHit - C.MAX_WINDOW_SEC) continue;
    let covered = start;
    for (let j = i; j < ordered.length; j++) {
      if (ordered[j].startSec - covered > C.MAX_SEGMENT_GAP_SEC) break;
      covered = Math.max(covered, ordered[j].endSec);
      const duration = covered - start;
      if (duration > C.MAX_WINDOW_SEC) break;
      if (duration >= C.MIN_WINDOW_SEC && covered >= lastHit) {
        candidates.push({ startSec: start, endSec: covered,
          score: [Math.abs(duration - C.TARGET_WINDOW_SEC), Math.abs((start + covered) - (firstHit + lastHit)), start] });
      }
    }
  }
  candidates.sort((a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || a.score[2] - b.score[2]);
  if (!candidates.length) fail();
  const { startSec, endSec } = candidates[0];
  return { videoId, startSec, endSec, frozenAt, hitChunkIds: [...new Set(hits.map(chunkId))],
    hitRanges: hits.map((h) => ({ chunkId: chunkId(h), startSec: h.startSec, endSec: h.endSec })),
    segments: ordered.filter((s) => s.startSec < endSec && s.endSec > startSec)
      .map((s) => ({ chunkId: chunkId(s), startSec: s.startSec, endSec: s.endSec, rawText: s.transcript || s.text || s.rawText || '' })) };
}

function inspectProbe(probe, window) {
  const audio = probe?.streams?.find((s) => s.codec_type === 'audio');
  if (!audio) fail('原片沒有聲音軌。', 'RECUT_SOURCE_NO_AUDIO');
  const duration = Number(probe.format?.duration);
  const audioDuration = audio.duration == null ? duration : Number(audio.duration);
  if (!Number.isFinite(duration) || duration < window.endSec || !Number.isFinite(audioDuration) || audioDuration < window.endSec) {
    fail('原片或聲音軌長度不足，無法涵蓋整個視窗。', 'RECUT_SOURCE_TOO_SHORT');
  }
  return { audioTrack: true, windowDuration: true, durationSec: duration };
}
function calculateFixedGain({ integratedLufs, truePeakDbtp }) {
  if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDbtp)) fail('原片音量量測無效或沒有可用聲音。', 'RECUT_SOURCE_AUDIO_INVALID');
  const fixedGainDb = Math.min(C.TARGET_LUFS - integratedLufs, C.PEAK_LIMIT_DBTP - truePeakDbtp);
  if (C.TARGET_LUFS - (integratedLufs + fixedGainDb) >= C.MAX_LOUDNESS_SHORTFALL_LU - 1e-9) {
    fail('原片音量過低，受峰值上限限制而無法達到目標。', 'RECUT_SOURCE_TOO_QUIET');
  }
  return { integratedLufs, truePeakDbtp, fixedGainDb: round(fixedGainDb), targetLufs: C.TARGET_LUFS, peakLimitDbtp: C.PEAK_LIMIT_DBTP };
}
function splitSentences(rawWords, window) {
  if (!Array.isArray(rawWords) || !rawWords.length) fail('視窗辨識沒有可用逐字時間。', 'RECUT_ASR_INVALID');
  const sentences = []; let current = []; let previousEnd = window.startSec;
  const flush = () => {
    if (!current.length) return;
    const startSec = current[0].startSec; const endSec = current.at(-1).endSec;
    const overlaps = (r) => r.startSec < endSec && r.endSec > startSec;
    sentences.push({ id: `s${sentences.length + 1}`, startSec, endSec,
      text: current.map((w) => w.text).join(''), words: current,
      retrievalHit: window.hitRanges.some(overlaps), chunkIds: window.segments.filter(overlaps).map((s) => s.chunkId) });
    current = [];
  };
  for (const raw of rawWords) {
    const word = { text: String(raw.w ?? '').trim(), startSec: round(raw.s + window.startSec), endSec: round(raw.e + window.startSec) };
    if (!word.text || !Number.isFinite(raw.s) || !Number.isFinite(raw.e) || word.startSec < previousEnd - 0.001
      || word.endSec <= word.startSec || word.endSec > window.endSec + 0.001 || word.endSec - word.startSec > C.MAX_SENTENCE_SEC) {
      fail('視窗逐字時間無效，或單一字詞超過八秒，無法可靠切句。', 'RECUT_ASR_INVALID');
    }
    // 四捨五入的一毫秒誤差吸附前一個字尾，不讓句子互相重疊。
    word.startSec = Math.max(word.startSec, previousEnd);
    if (current.length && (word.startSec - previousEnd >= C.SENTENCE_PAUSE_SEC - 1e-9
      || word.endSec - current[0].startSec > C.MAX_SENTENCE_SEC)) flush();
    current.push(word); previousEnd = word.endSec;
    if (/[，。！？；、,.!?;:]$/u.test(word.text)) flush();
  }
  flush(); return sentences;
}

module.exports = { expandContinuousWindow, inspectProbe, calculateFixedGain, splitSentences };
