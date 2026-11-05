'use strict';

const crypto = require('node:crypto');
const { describeComponent } = require('./components');
const { getRendererMetadata, CONTRACT_VERSION, THEMES, validateVersions, validateAudio, calculateFixedGain } = require('./runtime');
const { findSimplifiedCharacters } = require('./text');
const issue = (code, path, message) => ({ code, path, message });
const round = (v) => Math.round(v * 1000) / 1000;
const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[。！？、，；「」『』“”‘’\p{Z}\s]/gu, '');
const text = (v) => typeof v === 'string' && !!v.trim();
const safeId = (v) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v);
const planHash = (plan) => crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');

function validateSentenceStructure(plan) {
  const errors = [];
  const add = (code, path, message) => errors.push(issue(code, path, message));
  const keys = (value, allowed, path) => { if (value && typeof value === 'object' && !Array.isArray(value)) for (const key of Object.keys(value)) if (!allowed.includes(key)) add('FIELD_UNKNOWN', `${path}.${key}`, 'field is not in the sentence-v1 contract'); };
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return [issue('PLAN_INVALID', '$', 'plan must be an object')];
  keys(plan, ['schemaVersion', 'contractVersion', 'layout', 'canvas', 'source', 'versions', 'theme', 'audio', 'title', 'clips', 'scenes', 'subtitles', 'endCard'], '$');
  keys(plan.canvas, ['width', 'height', 'fps'], 'canvas'); keys(plan.source, ['videoId'], 'source');
  keys(plan.versions, ['modelId', 'shortRender', 'assets'], 'versions'); keys(plan.versions?.assets, ['@iconify-json/fluent-emoji-flat', '@phosphor-icons/core'], 'versions.assets');
  keys(plan.audio, ['gainDb', 'inputIntegratedLufs', 'inputTruePeakDbtp', 'targetLufs', 'maxTruePeakDbtp'], 'audio');
  keys(plan.title, ['text', 'tag'], 'title'); keys(plan.endCard, ['line1', 'line2', 'seconds'], 'endCard');
  if (plan.schemaVersion !== 'recut-v1' || plan.contractVersion !== CONTRACT_VERSION) add('SCHEMA_VERSION', 'contractVersion', 'recut-v1 sentence-v1 is required');
  if (plan.layout !== 'full-animation') add('LAYOUT_INVALID', 'layout', 'sentence-v1 requires full-animation');
  if (plan.canvas?.width !== 720 || plan.canvas?.height !== 1280 || plan.canvas?.fps !== 30) add('CANVAS_INVALID', 'canvas', '720x1280 at 30fps is required');
  if (!text(plan.source?.videoId) || plan.source?.teacherRegion !== undefined) add('SOURCE_INVALID', 'source', 'videoId required; teacher footage region is not supported');
  for (const message of validateVersions(plan.versions)) add('VERSION_MISMATCH', 'versions', message);
  for (const message of validateAudio(plan.audio)) add('AUDIO_INVALID', 'audio', message);
  if (!Object.hasOwn(THEMES, plan.theme)) add('THEME_INVALID', 'theme', 'theme must be N2|N1|C|B|G');
  if (!text(plan.title?.text) || [...(plan.title?.text || '')].length > 16 || !text(plan.title?.tag)) add('TITLE_INVALID', 'title', 'tag and title (max 16 characters) required');
  const ids = new Set();
  if (!Array.isArray(plan.clips) || !plan.clips.length || plan.clips.length > 16) add('CLIPS_INVALID', 'clips', '1-16 clips required');
  else for (const [i, c] of plan.clips.entries()) {
    keys(c, ['id', 'from', 'to', 'startAt', 'endAt', 'chunkIds', 'opening', 'textAnchors'], `clips[${i}]`);
    if (c?.opening !== undefined && typeof c.opening !== 'boolean') add('CLIP_RANGE', `clips[${i}].opening`, 'opening must be a boolean');
    keys(c?.textAnchors, ['from', 'to'], `clips[${i}].textAnchors`);
    keys(c?.textAnchors?.from, ['text'], `clips[${i}].textAnchors.from`); keys(c?.textAnchors?.to, ['text'], `clips[${i}].textAnchors.to`);
    if (!safeId(c?.id) || ids.has(c.id)) add('CLIP_ID', `clips[${i}].id`, 'unique safe id required');
    ids.add(c?.id);
    if (!safeId(c?.from) || !safeId(c?.to) || !Array.isArray(c?.chunkIds) || !c.chunkIds.length || !c.chunkIds.every(text)) add('CLIP_RANGE', `clips[${i}]`, 'sentence from/to and chunkIds required');
    for (const key of ['startAt', 'endAt']) if (c?.[key] !== undefined && !text(c[key])) add('ANCHOR_INVALID', `clips[${i}].${key}`, 'phrase must be non-empty');
  }
  const sceneIds = new Set();
  if (!Array.isArray(plan.scenes) || !plan.scenes.length || plan.scenes.length > 14) add('SCENES_INVALID', 'scenes', '1-14 scenes required');
  else for (const [i, s] of plan.scenes.entries()) {
    const path = `scenes[${i}]`;
    keys(s, ['id', 'from', 'to', 'clips', 'component', 'params', 'cues', 'basedOn', 'stamp'], path);
    errors.push(...require('./catalog').checkParamFields(s?.component, s?.params, `${path}.params`));
    // Reserve renderer-owned IDs to prevent selector/script injection and collisions.
    if (!safeId(s?.id) || /^(?:root|hdr|endcard|end1|end2|narration|sub\d+)$/.test(s.id) || sceneIds.has(s.id)) add('SCENE_ID', path, 'unique safe non-reserved scene id required');
    sceneIds.add(s?.id);
    if (typeof s?.id === 'string' && [...sceneIds].some((v) => typeof v === 'string' && v !== s.id && (v.startsWith(`${s.id}-`) || s.id.startsWith(`${v}-`)))) add('SCENE_ID', path, 'scene id overlaps a generated child id namespace');
    if (!safeId(s?.from) || !safeId(s?.to) || !Array.isArray(s?.clips) || !s.clips.length || !s.clips.every((id) => ids.has(id))) add('SCENE_CLIPS', path, 'sentence range and existing clips required');
    if (!Array.isArray(s?.basedOn) || !s.basedOn.length || !s.basedOn.every(text)) add('SCENE_BASED_ON', path, 'basedOn chunkIds required');
    const d = describeComponent(s?.component, s?.params);
    for (const message of d.errors) add('COMPONENT_PARAMS', `${path}.params`, message);
    if (s?.cues !== undefined && (!s.cues || typeof s.cues !== 'object' || Array.isArray(s.cues))) add('CUES_INVALID', `${path}.cues`, 'cues must be an object');
    else for (const [key, anchor] of Object.entries(s?.cues || {})) {
      keys(anchor, ['sentenceId', 'text'], `${path}.cues.${key}`);
      if (!d.cues.includes(key)) add('CUE_UNKNOWN', `${path}.cues.${key}`, `unknown component cue; component "${s?.component}" with these params accepts only: ${d.cues.join(', ')}`);
      if (!safeId(anchor?.sentenceId) || (anchor?.text !== undefined && !text(anchor.text)) || anchor?.offset !== undefined || anchor?.nth !== undefined) add('ANCHOR_INVALID', `${path}.cues.${key}`, 'sentenceId + optional unique text; offsets are not accepted');
    }
    keys(s?.stamp, ['text', 'tone'], `${path}.stamp`);
    if (s?.stamp !== undefined && (!text(s.stamp?.text) || [...s.stamp.text].length > 6 || (s.stamp.tone !== undefined && s.stamp.tone !== 'alert'))) add('STAMP_INVALID', `${path}.stamp`, 'stamp text max 6 characters / alert tone');
  }
  if (!Array.isArray(plan.subtitles) || !plan.subtitles.length) add('SUBTITLES_INVALID', 'subtitles', 'subtitles required');
  else for (const [i, s] of plan.subtitles.entries()) {
    const path = `subtitles[${i}]`;
    keys(s, ['from', 'runs', 'level', 'clip'], path); keys(s?.from, ['sentenceId', 'text'], `${path}.from`);
    if (Array.isArray(s?.runs)) s.runs.forEach((r, j) => keys(r, ['t', 'hl'], `${path}.runs[${j}]`));
    if (!ids.has(s?.clip) || !safeId(s?.from?.sentenceId) || (s.from.text !== undefined && !text(s.from.text)) || s.from.offset !== undefined) add('ANCHOR_INVALID', `${path}.from`, 'clip and sentence anchor required');
    if (!Array.isArray(s?.runs) || !s.runs.length || !s.runs.every((r) => text(r?.t) && (r.hl === undefined || typeof r.hl === 'boolean'))) add('SUBTITLE_RUNS', path, 'runs {t,hl?} required');
    else {
      const value = s.runs.map((r) => r.t).join('');
      if ([...value].length > 20) add('SUBTITLE_TOO_LONG', path, 'maximum 20 characters');
      if (findSimplifiedCharacters(value).length) add('SUBTITLE_SIMPLIFIED', path, 'Traditional Chinese required');
    }
  }
  if (!text(plan.endCard?.line1) || !Number.isFinite(plan.endCard?.seconds) || plan.endCard.seconds < 0 || plan.endCard.seconds > 6) add('END_CARD', 'endCard', 'line1 and seconds 0-6 required; 0 means no extra silent end card');
  return errors;
}

function indexSentences(sentences) {
  if (!Array.isArray(sentences) || !sentences.length) throw new Error('frozen sentences required');
  const byId = new Map(); let previous = -Infinity;
  for (const [index, s] of sentences.entries()) {
    if (!safeId(s?.id) || byId.has(s.id) || !text(s.text) || !Array.isArray(s.words) || !s.words.length) throw new Error('invalid frozen sentence');
    let last = s.startSec;
    if (!Number.isFinite(s.startSec) || !Number.isFinite(s.endSec) || s.startSec < previous || s.startSec < 0 || s.endSec <= s.startSec) throw new Error('sentence times must be finite and ordered');
    for (const w of s.words) {
      if (!text(w?.text) || !Number.isFinite(w.startSec) || !Number.isFinite(w.endSec) || w.startSec < last - 0.001 || w.endSec <= w.startSec || w.startSec < s.startSec - 0.001 || w.endSec > s.endSec + 0.001) throw new Error('word times must be finite and inside their sentence');
      last = w.endSec;
    }
    if (norm(s.words.map((w) => w.text).join('')) !== norm(s.text)) throw new Error('sentence text differs from frozen words');
    previous = s.endSec;
    byId.set(s.id, { ...s, index });
  }
  return byId;
}

// Unique exact phrase matching in a single sentence, preserving decimal/sign/code
// characters. Both ends must coincide with whole ASR-word boundaries.
function phraseWords(sentence, phrase) {
  if (phrase === undefined) return { first: 0, last: sentence.words.length - 1 };
  const parts = sentence.words.map((w) => norm(w.text));
  const joined = parts.join(''), needle = norm(phrase), at = joined.indexOf(needle);
  if (!needle || at < 0 || joined.indexOf(needle, at + 1) >= 0) throw new Error(`anchor absent or ambiguous in ${sentence.id}: ${phrase}; use a phrase copied from that sentence that occurs exactly once (sentence: ${sentence.text})`);
  const starts = []; let cursor = 0;
  for (const part of parts) { starts.push(cursor); cursor += part.length; }
  const first = starts.indexOf(at), end = at + needle.length;
  const last = parts.findIndex((part, i) => starts[i] + part.length === end);
  if (first < 0 || last < first) throw new Error(`anchor must use complete word boundaries in ${sentence.id}`);
  return { first, last };
}

function resolveSentencePlan(plan, { sentences } = {}) {
  const errors = validateSentenceStructure(plan);
  if (errors.length) return { resolved: null, errors };
  let byId;
  try { byId = indexSentences(sentences); } catch (e) { return { resolved: null, errors: [issue('SENTENCES_INVALID', 'sentences', e.message)] }; }
  try {
    const clips = [], occurrences = []; let cursor = 0, lastIndex = -1, openingCount = 0;
    const used = new Set();
    for (const c of plan.clips) {
      const first = byId.get(c.from), last = byId.get(c.to);
      if (!first || !last || first.index > last.index) throw new Error('clip sentence range missing or reversed');
      if (c.opening) {
        if (clips.length || ++openingCount > 1 || first.id !== last.id) throw new Error('cold open must be the first single sentence and occur once');
      } else { if (first.index <= lastIndex) throw new Error('clips must retain source chronological order'); lastIndex = last.index; }
      const range = sentences.slice(first.index, last.index + 1);
      const expectedChunks = [...new Set(range.flatMap((s) => s.chunkIds || []))].sort();
      if (JSON.stringify([...new Set(c.chunkIds)].sort()) !== JSON.stringify(expectedChunks)) throw new Error('clip chunk references differ from the selected frozen sentences');
      if (c.textAnchors && (c.textAnchors.from?.text !== (c.startAt || first.text) || c.textAnchors.to?.text !== (c.endAt || last.text))) throw new Error('filled textual anchors differ from frozen sentences');
      const a = phraseWords(first, c.startAt).first, b = phraseWords(last, c.endAt).last;
      const words = range.flatMap((s, i) => {
        if (used.has(s.id)) throw new Error('sentence appears more than once');
        used.add(s.id);
        return s.words.slice(i === 0 ? a : 0, i === range.length - 1 ? b + 1 : undefined);
      });
      if (!words.length) throw new Error('clip contains no words');
      const srcStart = words[0].startSec, srcEnd = words.at(-1).endSec;
      if (srcEnd <= srcStart || (c.opening && srcEnd - srcStart > 3)) throw new Error('invalid clip duration / cold open exceeds three seconds');
      const clip = { id: c.id, srcStart, srcEnd, wordStart: srcStart, wordEnd: srcEnd, anchorsExact: true, dur: round(srcEnd - srcStart), outStart: round(cursor), outEnd: round(cursor + srcEnd - srcStart), text: words.map((w) => w.text).join('') };
      clips.push(clip);
      for (const s of range) {
        const kept = words.filter((w) => w.startSec >= s.startSec && w.endSec <= s.endSec);
        if (!kept.length) throw new Error('empty selected sentence after trim');
        occurrences.push({ id: s.id, clip: c.id, t0: round(cursor + kept[0].startSec - srcStart), t1: round(cursor + kept.at(-1).endSec - srcStart), source: s, words: kept });
      }
      cursor = clip.outEnd;
    }
    const speechTotal = round(cursor);
    const sentenceAt = (id) => { const s = occurrences.find((v) => v.id === id); if (!s) throw new Error(`unselected sentence: ${id}`); return s; };
    const anchorAt = (anchor, clipIds) => {
      const s = sentenceAt(anchor.sentenceId);
      if (!clipIds.includes(s.clip)) throw new Error('anchor sentence is outside the referenced clip');
      const match = phraseWords(s.source, anchor.text);
      const w = s.source.words[match.first];
      if (w.startSec < s.words[0].startSec || s.source.words[match.last].endSec > s.words.at(-1).endSec) throw new Error(`${anchor.text === undefined ? `whole-sentence anchor on ${anchor.sentenceId}` : `anchor phrase "${anchor.text}" in ${anchor.sentenceId}`} was trimmed out of the clip; give a text phrase inside the kept part: ${s.words.map((v) => v.text).join('')}`);
      return round(s.t0 + w.startSec - s.words[0].startSec);
    };
    let covered = 0;
    const scenes = plan.scenes.map((scene) => {
      const a = occurrences.findIndex((s) => s.id === scene.from), b = occurrences.findIndex((s) => s.id === scene.to);
      if (a !== covered || b < a) throw new Error('scenes must cover every selected sentence in playback order exactly once');
      covered = b + 1;
      const actualClips = [...new Set(occurrences.slice(a, b + 1).map((s) => s.clip))];
      const expectedChunks = [...new Set(occurrences.slice(a, b + 1).flatMap((s) => s.source.chunkIds || []))].sort();
      if (JSON.stringify([...new Set(scene.basedOn)].sort()) !== JSON.stringify(expectedChunks)) throw new Error('scene evidence differs from frozen sentence range');
      if (JSON.stringify(actualClips) !== JSON.stringify(scene.clips)) throw new Error('scene clips differ from its sentence range');
      const t0 = occurrences[a].t0;
      // The next scene starts at a sentence's first word; intervening pause
      // remains with the current card so there is no uncovered black interval.
      const t1 = occurrences[b + 1]?.t0 ?? speechTotal;
      if (t1 - t0 < 3 - 0.001 || t1 - t0 > 12 + 0.001) {
        const spans = occurrences.map((o, i) => `${o.id} ${round((occurrences[i + 1]?.t0 ?? speechTotal) - o.t0)}s`).join(', ');
        throw new Error(`scene ${scene.id} (${scene.from}-${scene.to}) lasts ${round(t1 - t0)}s but must last 3-12 seconds; regroup sentences at sentence boundaries. Playback seconds per selected sentence: ${spans}`);
      }
      const cues = {};
      for (const [name, anchor] of Object.entries(scene.cues || {})) {
        const time = anchorAt(anchor, actualClips);
        if (time < t0 || time >= t1) throw new Error(`cue ${name} is outside scene ${scene.id}`);
        cues[name] = time;
      }
      return { id: scene.id, t0, t1, cues };
    });
    if (covered !== occurrences.length) throw new Error('scene coverage is incomplete');
    const subtitles = plan.subtitles.map((s, i) => ({ index: i, clip: s.clip, t0: anchorAt(s.from, [s.clip]) }));
    for (let i = 0; i < subtitles.length; i++) {
      const s = subtitles[i], next = subtitles[i + 1];
      if ((i === 0 && s.t0 !== 0) || (next && next.t0 <= s.t0)) throw new Error('subtitles must start at zero and follow playback order');
      s.t1 = next?.t0 ?? speechTotal;
    }
    const total = round(speechTotal + plan.endCard.seconds);
    if (speechTotal < 30 || total > 65) throw new Error('speech must be >=30 seconds and total including end card <=65 seconds');
    return { resolved: { clips, scenes, subtitles, speechTotal, total, endCard: { t0: speechTotal, t1: total }, planHash: planHash(plan), contractVersion: CONTRACT_VERSION }, errors: [] };
  } catch (e) { return { resolved: null, errors: [issue('SENTENCE_TIMING', '$', e.message)] }; }
}

function validateSentencePlan(plan, { sentences, evidence = [], resolved } = {}) {
  const result = resolveSentencePlan(plan, { sentences });
  const errors = [...result.errors], warnings = [];
  if (result.resolved) {
    const byId = new Map(sentences.map((s) => [s.id, s]));
    const available = new Map((Array.isArray(evidence) ? evidence : (evidence?.sentences || sentences).flatMap((s) => (s.chunkIds || []).map((chunkId) => ({ chunkId, videoId: evidence?.videoId })))).map((c) => [String(c.chunkId), c]));
    for (const [i, c] of plan.clips.entries()) for (const id of c.chunkIds) {
      const chunk = available.get(String(id));
      if (!chunk) errors.push(issue('EVIDENCE_MISSING', `clips[${i}].chunkIds`, 'chunk is not in frozen evidence'));
      else if (chunk.videoId && String(chunk.videoId) !== plan.source.videoId) errors.push(issue('SOURCE_MISMATCH', `clips[${i}]`, 'evidence belongs to a different video'));
    }
    for (const [i, s] of plan.scenes.entries()) for (const id of s.basedOn) if (!available.has(String(id))) errors.push(issue('EVIDENCE_MISSING', `scenes[${i}].basedOn`, 'chunk is not in frozen evidence'));
    // Numeric/terminology semantics are RC4's sentence-local responsibility.
    // This module validates sentence/timing and evidence identity, not truth.
    for (const s of plan.subtitles) if (!byId.has(s.from.sentenceId)) errors.push(issue('ANCHOR_INVALID', 'subtitles', 'unknown sentence'));
    if (resolved && JSON.stringify(resolved) !== JSON.stringify(result.resolved)) errors.push(issue('RESOLVED_MISMATCH', 'resolved', 'resolved timing differs from deterministic sentence resolution'));
  }
  return { valid: errors.length === 0, errors, warnings };
}

function buildRecutPlan({ source, selectionResult, scenes, subtitles, title, endCard, modelId, audio = source?.audio, theme = 'N2' }) {
  try {
    const sentences = source.sentences, byId = indexSentences(sentences);
    const selected = selectionResult.clips;
    const clips = selected.map((c, i) => {
      const first = byId.get(c.sentenceIds[0]), last = byId.get(c.sentenceIds.at(-1));
      const from = first.id, to = last.id;
      const findPhrase = (s, start, end) => s.words.filter((w) => w.startSec >= start - 0.0001 && w.endSec <= end + 0.0001).map((w) => w.text).join('');
      const clip = { id: c.id || `c${i + 1}`, from, to, chunkIds: [...new Set(c.sentenceIds.flatMap((id) => byId.get(id).chunkIds || []))], ...(c.opening ? { opening: true } : {}) };
      if (c.startSec !== first.words[0].startSec) clip.startAt = findPhrase(first, c.startSec, first.endSec);
      if (c.endSec !== last.words.at(-1).endSec) clip.endAt = findPhrase(last, last.startSec, c.endSec);
      clip.textAnchors = { from: { text: clip.startAt || first.text }, to: { text: clip.endAt || last.text } };
      return clip;
    });
    const order = selected.flatMap((c, i) => c.sentenceIds.map((id) => ({ id, clip: clips[i].id })));
    const builtScenes = scenes.map((s) => {
      const a = order.findIndex((v) => v.id === s.from), b = order.findIndex((v) => v.id === s.to);
      if (a < 0 || b < a) throw new Error('scene references missing selected sentence');
      const span = order.slice(a, b + 1);
      return { ...s, clips: [...new Set(span.map((v) => v.clip))], basedOn: [...new Set(span.flatMap((v) => byId.get(v.id).chunkIds || []))] };
    });
    const builtSubs = subtitles.map((s) => ({ ...s, clip: order.find((v) => v.id === s.from.sentenceId)?.clip }));
    const measured = audio?.gainDb !== undefined ? audio : { ...calculateFixedGain({ integratedLufs: audio?.integratedLufs, truePeakDbtp: audio?.truePeakDbtp }), gainDb: audio.fixedGainDb };
    const plan = { schemaVersion: 'recut-v1', contractVersion: CONTRACT_VERSION, layout: 'full-animation', canvas: { width: 720, height: 1280, fps: 30 }, source: { videoId: String(source.videoId) }, versions: getRendererMetadata(modelId), theme, audio: measured,
      title: title || { tag: '重點', text: '課堂重點' }, clips, scenes: builtScenes, subtitles: builtSubs,
      endCard: { line1: 'FocusFlow', line2: '', seconds: 0, ...endCard } };
    const result = resolveSentencePlan(plan, { sentences });
    if (result.resolved) for (let i = 0; i < selected.length; i++) {
      if (Math.abs(result.resolved.clips[i].srcStart - selected[i].startSec) > 0.001 || Math.abs(result.resolved.clips[i].srcEnd - selected[i].endSec) > 0.001) throw new Error('assembled timing differs from locked RC3 clip');
    }
    return { plan, ...result };
  } catch (e) { return { plan: null, resolved: null, errors: [issue('ASSEMBLY_INVALID', '$', e.message)] }; }
}

module.exports = { validateSentenceStructure, validateSentencePlan, resolveSentencePlan, buildRecutPlan, phraseWords, norm, planHash };
