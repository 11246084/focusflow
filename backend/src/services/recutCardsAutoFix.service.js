'use strict';
// 配圖卡輸出的程式修正（2026-11-19）：字幕過長、圖卡秒數超出 2～15 秒這類「差一點點」的問題，
// 由程式依句子邊界直接修，不再花模型呼叫額度重送。修正只搬動既有內容的位置，
// 不新增、不刪改字幕文字；修不了的情況維持原樣，交給後續驗證回報給模型。
const SUBTITLE_MAX = 20;
// 與 short_render 的圖卡長度一致（recut 決策第 96 項放寬為 2～15 秒）。
const SCENE_MIN = 2;
const SCENE_MAX = 15;
const EPS = 0.01;
const MAX_BLANK = 2.9; // renderer 允許 3 秒，留一點餘裕
const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[。！？、，；「」『』“”‘’\p{Z}\s]/gu, '');
const PUNCT = /[，。！？、；：,.!?;:]/u;
const clone = (v) => structuredClone(v);

// 每個選中句子在成品裡的開始秒數（依剪輯順序）與總長；和 renderer 的算法一致，
// 句子間的停頓算在前一句。
function playbackTimeline(source, selectionResult) {
  const byId = new Map((source?.sentences || []).map((s) => [s.id, s]));
  const order = []; let cursor = 0;
  for (const clip of selectionResult?.clips || []) {
    const words = clip.words?.length ? clip.words : [];
    const clipStart = words[0]?.startSec ?? clip.startSec;
    const clipEnd = words.at(-1)?.endSec ?? clip.endSec;
    if (!Number.isFinite(clipStart) || !Number.isFinite(clipEnd) || clipEnd <= clipStart) return null;
    for (const id of clip.sentenceIds || []) {
      const sentence = byId.get(id);
      const kept = (sentence?.words || []).filter((w) => w.startSec >= clipStart - 0.001 && w.endSec <= clipEnd + 0.001);
      if (!kept.length) return null;
      order.push({ id, t0: cursor + kept[0].startSec - clipStart, kept });
    }
    cursor += clipEnd - clipStart;
  }
  return order.length ? { order, total: cursor } : null;
}

function fixSceneTiming(output, timeline) {
  if (!timeline || !Array.isArray(output?.scenes) || !output.scenes.length) return { output, changed: false };
  const { order, total } = timeline;
  const at = (n) => (n < order.length ? order[n].t0 : total);
  const index = new Map(order.map((o, i) => [o.id, i]));
  let scenes = output.scenes.map((scene) => ({ scene, a: index.get(scene.from), b: index.get(scene.to) }));
  // 只處理依序、完整涵蓋所有句子的情況；其餘交給驗證回報。
  let expected = 0;
  for (const s of scenes) { if (s.a !== expected || !(s.b >= s.a)) return { output, changed: false }; expected = s.b + 1; }
  if (expected !== order.length) return { output, changed: false };
  const dur = (s) => at(s.b + 1) - at(s.a);
  const ok = (d) => d >= SCENE_MIN + EPS && d <= SCENE_MAX - EPS;
  let changed = false;
  for (let round = 0; round < order.length * 2; round++) {
    let moved = false;
    for (let i = 0; i < scenes.length && !moved; i++) {
      const s = scenes[i], prev = scenes[i - 1], next = scenes[i + 1];
      const d = dur(s);
      if (d > SCENE_MAX - EPS && s.b > s.a) {
        // 太長：把頭尾一句讓給相鄰圖卡，兩邊都要仍在範圍內。
        if (next && ok(dur({ a: s.b, b: next.b })) && ok(dur({ a: s.a, b: s.b - 1 })) ) { next.a = s.b; s.b -= 1; moved = true; }
        else if (prev && ok(dur({ a: prev.a, b: s.a })) && ok(dur({ a: s.a + 1, b: s.b }))) { prev.b = s.a; s.a += 1; moved = true; }
        else {
          // 讓不出去就在句子邊界拆成同樣的圖卡：先找兩半都合規的切點；
          // 沒有就切下前段最長的合規部分，剩下的下一輪再處理（可拆成三張以上）。
          let cut = -1;
          for (let c = s.a; c < s.b; c++) if (ok(dur({ a: s.a, b: c })) && ok(dur({ a: c + 1, b: s.b }))) { cut = c; break; }
          if (cut < 0) for (let c = s.b - 1; c >= s.a; c--) if (ok(dur({ a: s.a, b: c }))) { cut = c; break; }
          if (cut >= 0) {
            const id = uniqueId(`${s.scene.id}b`, scenes);
            scenes.splice(i + 1, 0, { scene: { ...clone(s.scene), id }, a: cut + 1, b: s.b });
            s.b = cut; moved = true;
          }
        }
      } else if (d < SCENE_MIN + EPS) {
        // 太短：向相鄰圖卡借一句；借不到就併進前一張或下一張。
        if (prev && prev.b > prev.a && ok(dur({ a: prev.a, b: prev.b - 1 })) && ok(dur({ a: prev.b, b: s.b }))) { s.a = prev.b; prev.b -= 1; moved = true; }
        else if (next && next.b > next.a && ok(dur({ a: next.a + 1, b: next.b })) && ok(dur({ a: s.a, b: next.a }))) { s.b = next.a; next.a += 1; moved = true; }
        else if (prev && ok(dur({ a: prev.a, b: s.b }))) { prev.b = s.b; scenes.splice(i, 1); moved = true; }
        else if (next && ok(dur({ a: s.a, b: next.b }))) { next.a = s.a; scenes.splice(i, 1); moved = true; }
      }
    }
    if (!moved) break;
    changed = true;
  }
  if (!changed) return { output, changed: false };
  const fixed = scenes.map(({ scene, a, b }) => {
    const ids = new Set(order.slice(a, b + 1).map((o) => o.id));
    const next = { ...scene, from: order[a].id, to: order[b].id };
    // 搬走的句子上的 cue 一併移除；沒有 cue 的元素使用預設時間。
    if (Array.isArray(scene.cues)) next.cues = scene.cues.filter((cue) => ids.has(cue?.sentenceId));
    else if (scene.cues && typeof scene.cues === 'object') next.cues = Object.fromEntries(Object.entries(scene.cues).filter(([, cue]) => ids.has(cue?.sentenceId)));
    return next;
  });
  return { output: { ...output, scenes: fixed }, changed: true };
}

// 圖卡開頭空白太久（第一個元素在開場 1.5 秒後才出現）：移除最早的那個 cue，
// 讓該元素改用預設的開場時間。只看物件形式的 cues（傳輸格式攤平後）。
function fixEmptyCards(output, timeline) {
  if (!timeline || !Array.isArray(output?.scenes)) return { output, changed: false };
  const occ = new Map(timeline.order.map((o) => [o.id, o]));
  const cueTime = (cue) => {
    const o = occ.get(cue?.sentenceId);
    if (!o) return null;
    if (!cue.text) return o.t0;
    const parts = o.kept.map((w) => norm(w.text)), joined = parts.join(''), at = joined.indexOf(norm(cue.text));
    if (at < 0) return o.t0;
    let pos = 0;
    for (const [i, part] of parts.entries()) { if (pos + part.length > at) return o.t0 + o.kept[i].startSec - o.kept[0].startSec; pos += part.length; }
    return o.t0;
  };
  let changed = false;
  const scenes = output.scenes.map((scene) => {
    const start = occ.get(scene?.from)?.t0;
    if (!Number.isFinite(start) || !scene.cues || typeof scene.cues !== 'object' || Array.isArray(scene.cues)) return scene;
    const cues = { ...scene.cues };
    for (;;) {
      const timed = Object.entries(cues).filter(([key]) => key !== 'stamp').map(([key, cue]) => [key, cueTime(cue)]).filter(([, t]) => Number.isFinite(t));
      if (!timed.length) break;
      const [key, first] = timed.reduce((a, b) => (b[1] < a[1] ? b : a));
      if (first - start <= MAX_BLANK) break;
      delete cues[key]; changed = true;
    }
    return Object.keys(cues).length === Object.keys(scene.cues).length ? scene : { ...scene, cues };
  });
  return changed ? { output: { ...output, scenes }, changed } : { output, changed: false };
}

// chips 圖卡要 2～6 個詞：超過 6 個保留前 6 個；只有 1 個時，能用頓號、逗號或斜線拆開就拆，
// 拆不開改成單句引言圖卡（quote-reveal）。只動畫面上的詞卡，不影響原音與字幕。
const chipText = (chip) => (chip && typeof chip === 'object' ? chip.text : chip);
function fixChipsParams(output) {
  if (!Array.isArray(output?.scenes)) return { output, changed: false };
  let changed = false;
  const scenes = output.scenes.map((scene) => {
    if (scene?.component !== 'chips' || !scene.params || !Array.isArray(scene.params.chips)) return scene;
    const chips = scene.params.chips.filter((chip) => typeof chipText(chip) === 'string' && chipText(chip).trim());
    if (chips.length >= 2 && chips.length <= 6 && chips.length === scene.params.chips.length) return scene;
    if (chips.length > 6) {
      const params = { ...scene.params, chips: chips.slice(0, 6) };
      if (Array.isArray(params.highlight)) params.highlight = params.highlight.filter((i) => Number.isInteger(i) && i < 6);
      if (Number.isInteger(params.dimKeep) && params.dimKeep >= 6) delete params.dimKeep;
      changed = true; return { ...scene, params };
    }
    if (chips.length >= 2) {
      changed = true; return { ...scene, params: { ...scene.params, chips, highlight: (scene.params.highlight || []).filter((i) => i < chips.length) } };
    }
    if (chips.length === 1) {
      const text = chipText(chips[0]).trim();
      const parts = text.split(/[、,，/／]/u).map((v) => v.trim()).filter(Boolean);
      if (parts.length >= 2 && parts.length <= 6) { changed = true; return { ...scene, params: { ...scene.params, chips: parts, highlight: [] } }; }
      if ([...text].length <= 24) {
        changed = true;
        const { cues, ...rest } = scene;
        return { ...rest, component: 'quote-reveal', params: { text } };
      }
    }
    return scene;
  });
  return changed ? { output: { ...output, scenes }, changed } : { output, changed: false };
}

function uniqueId(base, scenes) {
  const used = new Set(scenes.map((s) => s.scene.id));
  let id = base; let n = 2;
  while (used.has(id)) id = `${base}${n++}`;
  return id;
}

// 字幕超過 20 字：在標點或詞的邊界切成多行，第二行起的錨點用原句中唯一的詞組。
// 只在字幕文字照原句順序出現在該句時處理（精簡改寫過的字幕無法對時，維持原樣）。
function splitLongSubtitles(output, source) {
  if (!Array.isArray(output?.subtitles)) return { output, changed: false };
  const byId = new Map((source?.sentences || []).map((s) => [s.id, s]));
  let changed = false;
  const subtitles = [];
  for (const subtitle of output.subtitles) {
    const pieces = splitSubtitle(subtitle, byId.get(subtitle?.from?.sentenceId));
    if (pieces.length > 1) changed = true;
    subtitles.push(...pieces);
  }
  return changed ? { output: { ...output, subtitles }, changed } : { output, changed: false };
}

function splitSubtitle(subtitle, sentence) {
  const chars = [];
  for (const run of Array.isArray(subtitle?.runs) ? subtitle.runs : []) {
    if (typeof run?.t !== 'string') return [subtitle];
    for (const ch of run.t) chars.push({ ch, hl: run.hl });
  }
  if (chars.length <= SUBTITLE_MAX || !sentence?.words?.length) return [subtitle];
  const parts = sentence.words.map((w) => norm(w.text));
  const joined = parts.join('');
  const starts = []; let cursor = 0;
  for (const part of parts) { starts.push(cursor); cursor += part.length; }
  const anchorText = subtitle.from?.text;
  const base = anchorText ? joined.indexOf(norm(anchorText)) : 0;
  const subNorm = norm(chars.map((c) => c.ch).join(''));
  let offset = joined.indexOf(subNorm, Math.max(0, base));
  if (offset < 0) offset = joined.indexOf(subNorm);
  if (offset < 0 || !subNorm) return [subtitle];
  // 每個原始字元之前已累積幾個正規化字元，用來把切點對回原句的詞。
  const normBefore = []; let count = 0;
  for (const c of chars) { normBefore.push(count); count += norm(c.ch).length; }
  const wordAt = (i) => starts.indexOf(offset + normBefore[i]);
  const unique = (from) => {
    let text = '';
    for (let w = from; w < sentence.words.length; w++) {
      text += sentence.words[w].text;
      const needle = norm(text), hit = joined.indexOf(needle);
      if (needle && hit === starts[from] && joined.indexOf(needle, hit + 1) < 0) return text;
    }
    return null;
  };
  const pieces = []; let begin = 0;
  while (chars.length - begin > SUBTITLE_MAX) {
    let best = null;
    for (let i = begin + 1; i <= begin + SUBTITLE_MAX && i < chars.length; i++) {
      const word = wordAt(i);
      if (word < 0 || norm(chars[i].ch) === '') continue;
      const anchor = unique(word);
      if (!anchor) continue;
      const score = (PUNCT.test(chars[i - 1].ch) ? 0 : 100) + Math.abs((i - begin) - Math.min(SUBTITLE_MAX, (chars.length - begin) / 2));
      if (!best || score < best.score) best = { i, anchor, score };
    }
    if (!best) return [subtitle];
    pieces.push({ end: best.i, anchor: best.anchor });
    begin = best.i;
  }
  const result = []; let start = 0;
  for (const [n, cut] of [...pieces, { end: chars.length }].entries()) {
    const slice = chars.slice(start, cut.end);
    // 切點後的開頭標點留在上一行。
    const runs = [];
    for (const { ch, hl } of slice) {
      const last = runs.at(-1);
      if (last && last.hl === hl) last.t += ch; else runs.push(hl === undefined ? { t: ch } : { t: ch, hl });
    }
    const from = n === 0 ? subtitle.from : { sentenceId: subtitle.from.sentenceId, text: pieces[n - 1].anchor };
    result.push({ ...clone(subtitle), from, runs: runs.map((r) => (r.hl === undefined ? { t: r.t } : r)) });
    start = cut.end;
  }
  return result.every((piece) => [...piece.runs.map((r) => r.t).join('')].length <= SUBTITLE_MAX) ? result : [subtitle];
}

function autoFixCardsOutput(output, { source, selectionResult } = {}) {
  const chips = fixChipsParams(output);
  const subtitles = splitLongSubtitles(chips.output, source);
  const timeline = playbackTimeline(source, selectionResult);
  const scenes = fixSceneTiming(subtitles.output, timeline);
  const cards = fixEmptyCards(scenes.output, timeline);
  // A sentence-only anchor normally refers to the whole original sentence.
  // After an in-sentence trim, anchor at the same audible onset using kept words.
  const byId = new Map((source?.sentences || []).map((s) => [s.id, s]));
  const phrases = new Map();
  for (const { id, kept } of timeline?.order || []) {
    const sentence = byId.get(id);
    if (kept.length === sentence.words.length) continue;
    const phrase = kept.map((w) => w.text).join('');
    const full = norm(sentence.text), part = norm(phrase);
    const start = full.indexOf(part);
    if (part && start >= 0 && full.indexOf(part, start + 1) < 0) phrases.set(id, phrase);
  }
  if (!phrases.size) return { output: cards.output, changed: chips.changed || subtitles.changed || scenes.changed || cards.changed };
  const anchor = (a) => a && a.text === undefined && phrases.has(a.sentenceId) ? { ...a, text: phrases.get(a.sentenceId) } : a;
  const fixed = { ...cards.output,
    subtitles: cards.output.subtitles.map((s) => ({ ...s, from: anchor(s.from) })),
    scenes: cards.output.scenes.map((s) => s.cues && !Array.isArray(s.cues)
      ? { ...s, cues: Object.fromEntries(Object.entries(s.cues).map(([key, value]) => [key, anchor(value)])) } : s),
  };
  return { output: fixed, changed: true };
}

module.exports = { autoFixCardsOutput, fixSceneTiming, fixEmptyCards, fixChipsParams, splitLongSubtitles, playbackTimeline };
