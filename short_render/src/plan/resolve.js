'use strict';

const { LIMITS } = require('./constants');
const { issue } = require('./schema');
const { normalizeText, normalizeWords, levenshtein } = require('./text');

const SNAP_MAX_DISTANCE = 0.9;
const PAD_IN = 0.1;
const PAD_OUT = 0.2;
const EXACT_PAD_IN = 0.05;
const EXACT_PAD_OUT = 0.04;
const FUZZY_MIN_SCORE = 0.75;

const round = (value) => Math.round(value * 1000) / 1000;

/**
 * 在字詞序列裡找錨點。先找完全相同（正規化後），找不到才退到模糊比對。
 * 模糊比對的存在是因為 LLM 看到的是證據（tiny 模型的逐字稿），
 * 對齊用的是品質較好的 ASR，兩邊的錯字不會一樣。
 *
 * @param {{w: string, s: number, e: number}[]} words
 * @param {{text: string, nth?: number}} anchor
 * @param {{from?: number, to?: number}} range  字詞索引範圍（含）
 * @returns {{startWord: number, endWord: number, exact: boolean, score: number} | null}
 */
function locateAnchor(words, anchor, { from = 0, to = words.length - 1 } = {}) {
  const normalized = normalizeWords(words.slice(from, to + 1));
  const { chars } = normalized;
  // 字詞索引要加回切片的起點
  const startOwner = (position) => normalized.startWord[position] + from;
  const endOwner = (position) => normalized.endWord[position] + from;

  const target = normalizeText(anchor.text);
  if (!target) return null;
  const targetLength = [...target].length;

  const matches = [];
  for (let position = 0; position + targetLength <= chars.length; position += 1) {
    if (chars.slice(position, position + targetLength).join('') === target) {
      matches.push(position);
    }
  }

  const nth = anchor.nth || 1;
  if (matches.length >= nth) {
    const position = matches[nth - 1];
    return {
      startWord: startOwner(position),
      endWord: endOwner(position + targetLength - 1),
      exact: true,
      score: 1,
    };
  }
  if (matches.length > 0) {
    // 要求第 n 次出現但只有更少次：寧可失敗，也不要悄悄換成別處。
    return null;
  }

  let best = null;
  for (const length of [targetLength - 2, targetLength - 1, targetLength, targetLength + 1, targetLength + 2]) {
    if (length < 2) continue;
    for (let position = 0; position + length <= chars.length; position += 1) {
      const candidate = chars.slice(position, position + length).join('');
      const distance = levenshtein(candidate, target);
      const score = 1 - distance / Math.max(length, targetLength);
      if (!best || score > best.score) {
        best = { position, length, score, distance };
      }
    }
  }
  // 短錨點（如「大語言模型」被聽成「大野模型」）換算成比例會太嚴，
  // 所以長度 >= 5 的錨點允許最多 2 個字的差異。
  const acceptable = best && (best.score >= FUZZY_MIN_SCORE || (best.distance <= 2 && targetLength >= 5));
  if (!acceptable) return null;

  return {
    startWord: startOwner(best.position),
    endWord: endOwner(best.position + best.length - 1),
    exact: false,
    score: round(best.score),
  };
}

// Whisper 的字詞時間在靜默前後不可靠：字尾常被拉長到下一句開口前（實測「做」被標成 1 秒長）。
// 所以剪點以「能量偵測到的靜音」為準，字詞時間只用來決定要選哪一段靜音。
// 一律只在靜音「之內」下刀（若有選到靜音）：
//   - 切入點：靜音覆蓋或早於字開頭 → 落在靜音結束前一小段，且不晚於字開頭
//   - 切出點：靜音覆蓋或晚於字結尾 → 落在靜音開始後一小段，且不超出該靜音

/** 切入點。silences 是 [start, end] 秒數陣列。 */
function snapStart(wordStart, silences = []) {
  const candidates = silences.filter(([start, end]) => start <= wordStart + 0.05
    && end >= wordStart - SNAP_MAX_DISTANCE);
  if (!candidates.length) return round(wordStart - PAD_IN);
  // 取最靠近字開頭的那一段（結束時間最晚者）
  const [start, end] = candidates.reduce((best, item) => (item[1] > best[1] ? item : best));
  return round(Math.max(start + 0.02, Math.min(end - PAD_IN, wordStart - 0.02)));
}

/**
 * 切出點。nextWordStart 是下一個字詞的開頭：選到的靜音不能晚於它，
 * 否則會把下一句的第一個字一起帶進來。
 */
function snapEnd(wordEnd, silences = [], nextWordStart = null) {
  const candidates = silences.filter(([start, end]) => end >= wordEnd - 0.05
    && start <= wordEnd + SNAP_MAX_DISTANCE
    && start >= wordEnd - 1.0
    && (nextWordStart === null || start <= nextWordStart + 0.1));
  if (!candidates.length) return round(wordEnd + PAD_OUT);
  const [start, end] = candidates.reduce((best, item) => (item[0] < best[0] ? item : best));
  return round(Math.min(start + PAD_OUT, end - 0.02));
}

function cueTime(clip, words, region, anchor) {
  const located = locateAnchor(words, anchor, region);
  if (!located) return null;
  const sourceTime = words[located.startWord].s + (anchor.offset || 0);
  const outTime = clip.outStart + (sourceTime - clip.srcStart);
  return round(Math.min(Math.max(outTime, clip.outStart), clip.outEnd - 0.1));
}

/**
 * 把「文字錨點」換成秒數（對齊後的 plan）。
 *
 * @param plan  已通過結構檢查的 recut-v1 plan
 * @param {{wordsByClip: Object<string, {w:string,s:number,e:number}[]>,
 *          silencesByClip?: Object<string, [number, number][]>}} input
 * @returns {{resolved: object|null, errors: object[]}}
 */
function resolvePlan(plan, { wordsByClip, silencesByClip = {} }) {
  const errors = [];
  const clips = [];
  const regions = {};

  for (const [index, clip] of plan.clips.entries()) {
    const words = wordsByClip[clip.id];
    if (!Array.isArray(words) || !words.length) {
      errors.push(issue('ALIGN_MISSING', `clips[${index}]`, `no aligned words for clip "${clip.id}"`));
      continue;
    }

    // from / to 的 nth 都以「對齊視窗」的出現順序計算；to 必須不早於 from 的開頭。
    const from = locateAnchor(words, clip.from);
    const to = locateAnchor(words, clip.to);
    if (!from) {
      errors.push(issue('ANCHOR_NOT_FOUND', `clips[${index}].from`, `anchor "${clip.from.text}" not found in aligned transcript`));
    }
    if (!to) {
      errors.push(issue('ANCHOR_NOT_FOUND', `clips[${index}].to`, `anchor "${clip.to.text}" not found in aligned transcript`));
    }
    if (!from || !to) continue;
    if (to.endWord < from.startWord) {
      errors.push(issue('ANCHOR_ORDER', `clips[${index}]`, 'end anchor comes before the start anchor'));
      continue;
    }

    const wordStart = words[from.startWord].s;
    const wordEnd = words[to.endWord].e;
    if (wordEnd <= wordStart) {
      errors.push(issue('ANCHOR_ORDER', `clips[${index}]`, 'end anchor is not after the start anchor'));
      continue;
    }

    const silences = silencesByClip[clip.id] || [];
    const exact = clip.cut === 'exact';
    const srcStart = exact ? round(wordStart - EXACT_PAD_IN) : snapStart(wordStart, silences);
    const srcEnd = exact ? round(wordEnd + EXACT_PAD_OUT) : snapEnd(wordEnd, silences, words[to.endWord + 1]?.s ?? null);

    regions[clip.id] = { from: from.startWord, to: to.endWord };
    clips.push({
      id: clip.id,
      srcStart,
      srcEnd,
      wordStart: round(wordStart),
      wordEnd: round(wordEnd),
      anchorsExact: from.exact && to.exact,
    });
  }

  if (errors.length) return { resolved: null, errors };

  // 相鄰片段在原片上重疊：小重疊（< 0.35 秒，多半是兩段共用一個字的邊界）順延下一段起點，
  // 避免同一個字被聽兩次；大重疊代表選段本身有問題，直接報錯。
  for (let index = 1; index < clips.length; index += 1) {
    const previous = clips[index - 1];
    const current = clips[index];
    const overlap = previous.srcEnd - current.srcStart;
    if (overlap > 0) {
      if (overlap < 0.35) {
        current.srcStart = previous.srcEnd;
      } else if (plan.clips[index].chunkIds.some((id) => plan.clips[index - 1].chunkIds.includes(id))) {
        errors.push(issue('CLIP_OVERLAP', `clips[${index}]`, `clip "${current.id}" overlaps the previous clip by ${round(overlap)}s`));
      }
    }
  }
  if (errors.length) return { resolved: null, errors };

  let cursor = 0;
  for (const clip of clips) {
    clip.dur = round(clip.srcEnd - clip.srcStart);
    clip.outStart = round(cursor);
    cursor += clip.dur;
    clip.outEnd = round(cursor);
  }
  const speechTotal = round(cursor);
  const endCardSeconds = plan.endCard.seconds ?? LIMITS.endCardSeconds.default;
  const clipById = Object.fromEntries(clips.map((clip) => [clip.id, clip]));

  // 字幕
  const subtitles = [];
  for (const [index, subtitle] of plan.subtitles.entries()) {
    const clip = clipById[subtitle.clip];
    const words = wordsByClip[subtitle.clip];
    const t0 = cueTime(clip, words, regions[subtitle.clip], subtitle.from);
    if (t0 === null) {
      errors.push(issue('ANCHOR_NOT_FOUND', `subtitles[${index}].from`, `anchor "${subtitle.from.text}" not found in clip "${subtitle.clip}"`));
      continue;
    }
    subtitles.push({ index, t0, t1: null });
  }
  for (let index = 0; index < subtitles.length; index += 1) {
    subtitles[index].t1 = index + 1 < subtitles.length ? subtitles[index + 1].t0 : speechTotal;
    if (subtitles[index].t1 - subtitles[index].t0 < 0.4) {
      errors.push(issue('SUBTITLE_ORDER', `subtitles[${subtitles[index].index}]`, 'subtitle cards must be in speech order, at least 0.4s apart'));
    }
  }

  // 場景與 cue
  const scenes = [];
  for (const [index, scene] of plan.scenes.entries()) {
    const first = clipById[scene.clips[0]];
    const last = clipById[scene.clips[scene.clips.length - 1]];
    const cues = {};
    for (const [name, anchor] of Object.entries(scene.cues || {})) {
      const clipId = anchor.clip || scene.clips[0];
      const time = cueTime(clipById[clipId], wordsByClip[clipId], regions[clipId], anchor);
      if (time === null) {
        errors.push(issue('ANCHOR_NOT_FOUND', `scenes[${index}].cues.${name}`, `anchor "${anchor.text}" not found in clip "${clipId}"`));
      } else {
        cues[name] = time;
      }
    }
    scenes.push({ id: scene.id, t0: first.outStart, t1: last.outEnd, cues });
  }
  if (errors.length) return { resolved: null, errors };

  return {
    resolved: {
      clips,
      subtitles,
      scenes,
      speechTotal,
      endCard: { t0: speechTotal, t1: round(speechTotal + endCardSeconds) },
      total: round(speechTotal + endCardSeconds),
    },
    errors,
  };
}

module.exports = { locateAnchor, snapStart, snapEnd, resolvePlan };
