const { RECUT_REASON_LABELS } = require('../constants/recut');
const AppError = require('../utils/appError');
const KEEP = new Set(RECUT_REASON_LABELS.slice(0, 4));
// 只忽略中文排版標點與空白；小數點、負號、C# 等技術內容必須保留。
const norm = (s) => s.replace(/[。！？、，；「」『』“”‘’]/gu, '').normalize('NFKC').toLocaleLowerCase('en').replace(/[\p{Z}\s]/gu, '');
const round = (v) => Math.round(v * 1000) / 1000;
function invalid(message) { throw new Error(message); }
function shape(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || required.some((k) => !Object.hasOwn(value, k)) || Object.keys(value).some((k) => ![...required, ...optional].includes(k))) invalid('輸出欄位不符合格式');
}
function anchorIndex(sentence, phrase, end) {
  if (typeof phrase !== 'string' || !norm(phrase)) invalid('句內錨點不可為空');
  const words = sentence.words;
  const joined = words.map((w) => norm(w.text)).join(''); const needle = norm(phrase);
  const at = joined.indexOf(needle);
  if (at < 0 || joined.indexOf(needle, at + 1) >= 0) invalid(`${sentence.id} 的錨點不存在或不唯一：${phrase}`);
  const boundaries = new Set([0]); let length = 0;
  for (const word of words) { length += norm(word.text).length; boundaries.add(length); }
  if (!boundaries.has(at) || !boundaries.has(at + needle.length)) invalid(`${sentence.id} 的錨點不是完整的逐字片語`);
  const pos = end ? at + needle.length : at;
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const next = cursor + norm(words[i].text).length;
    if (end ? next === pos : cursor === pos) return i;
    cursor = next;
  }
  invalid(`${sentence.id} 的錨點不在可用逐字邊界`);
}
function resolveSelection(source, input, { allowInvalidDuration = false } = {}) {
  const excluded = new Set(source.excludedSentenceIds || []);
  const assertAllowed = (id) => { if (excluded.has(id)) throw new AppError(`${id} 位於辨識視窗截斷邊界，不可選用或加回`, 422, 'RECUT_SENTENCE_EXCLUDED'); };
  const sentences = source.sentences; const index = new Map(sentences.map((s, i) => [s.id, i]));
  shape(input, ['answerable', 'unanswerableReason', 'ranges', 'sentenceLabels', 'openingSentenceId'], ['lockedSentenceIds']);
  if (typeof input.answerable !== 'boolean' || !Array.isArray(input.ranges) || !Array.isArray(input.sentenceLabels)) invalid('輸出型別錯誤');
  const labels = new Map();
  for (const item of input.sentenceLabels) {
    shape(item, ['sentenceId', 'label']);
    if (!index.has(item.sentenceId) || labels.has(item.sentenceId) || !RECUT_REASON_LABELS.includes(item.label)) invalid('每句必須恰有一個合法理由標籤');
    labels.set(item.sentenceId, item.label);
  }
  if (labels.size !== sentences.length) invalid('漏標句子');
  if (!input.answerable) {
    if (typeof input.unanswerableReason !== 'string' || !input.unanswerableReason.trim() || input.ranges.length || input.openingSentenceId !== null
      || [...labels.values()].some((v) => KEEP.has(v))) invalid('無法回答時須附原因、全部跳過且不得選段');
    return { selection: { ...input, lockedSentenceIds: [] }, clips: [], durationSec: 0, fullScript: '' };
  }
  if (input.unanswerableReason !== null || (!allowInvalidDuration && !input.ranges.length)) invalid('可回答時須有範圍且原因為 null');
  const opening = input.openingSentenceId;
  if (opening !== null) assertAllowed(opening);
  if (opening !== null && (!index.has(opening) || labels.get(opening) !== '冷開場'
    || sentences[index.get(opening)].endSec - sentences[index.get(opening)].startSec > 3)) invalid('片頭須為同一視窗不超過三秒的冷開場句');
  if ([...labels].some(([id, label]) => label === '冷開場' && id !== opening)) invalid('最多一次冷開場');
  const ranges = []; const clips = []; const selected = new Set(); let previous = -1;
  function addGroup(group, range) {
    if (!group.length) return;
    const first = group[0], last = group.at(-1);
    const normalized = { from: first.id, to: last.id,
      ...(first.id === range.from && range.startAt !== undefined ? { startAt: range.startAt } : {}),
      ...(last.id === range.to && range.endAt !== undefined ? { endAt: range.endAt } : {}) };
    const words = group.flatMap((s) => s.words); const clip = { sentenceIds: group.map((s) => s.id), startSec: words[0].startSec, endSec: words.at(-1).endSec,
      words, text: words.map((w) => w.text).join(''), opening: false };
    ranges.push(normalized); clips.push(clip);
  }
  for (const range of input.ranges) {
    shape(range, ['from', 'to'], ['startAt', 'endAt']);
    let a = index.get(range.from), b = index.get(range.to);
    if (a === undefined || b === undefined || a > b || a <= previous) invalid('範圍須存在、依時間排序且不重疊');
    previous = b;
    // 即使邊界之後被剪掉，原來提供的句內錨點仍須可信。
    const startWord = range.startAt === undefined ? 0 : anchorIndex(sentences[a], range.startAt, false);
    const endWord = range.endAt === undefined ? sentences[b].words.length - 1 : anchorIndex(sentences[b], range.endAt, true);
    if (a === b && startWord > endWord) invalid('句內剪點倒序');
    while (a <= b && labels.get(sentences[a].id) === '指畫面') a++;
    while (b >= a && labels.get(sentences[b].id) === '指畫面') b--;
    let group = [];
    for (let i = a; i <= b; i++) {
      const s = sentences[i]; assertAllowed(s.id); selected.add(s.id);
      if (s.id === opening) { addGroup(group, range); group = []; continue; }
      const words = s.words.slice(s.id === range.from ? startWord : 0, s.id === range.to ? endWord + 1 : undefined);
      group.push({ ...s, words });
    }
    addGroup(group, range);
  }
  if (opening !== null) {
    const s = sentences[index.get(opening)]; selected.add(opening);
    clips.unshift({ sentenceIds: [opening], startSec: s.words[0].startSec, endSec: s.words.at(-1).endSec,
      words: s.words, text: s.words.map((w) => w.text).join(''), opening: true });
  }
  for (const [id, label] of labels) if (KEEP.has(label) !== selected.has(id)) invalid(`${id} 的理由標籤與實際範圍矛盾`);
  const durationSec = round(clips.reduce((sum, c) => sum + c.endSec - c.startSec, 0));
  if (!allowInvalidDuration && (durationSec < 30 || durationSec > 65)) invalid(`總長 ${durationSec} 秒，不在 30～65 秒`);
  const locked = input.lockedSentenceIds || [];
  if (!Array.isArray(locked) || new Set(locked).size !== locked.length || locked.some((id) => !index.has(id))) invalid('鎖定句子不存在或重複');
  return { selection: { ...input, ranges, lockedSentenceIds: [...locked] }, clips, durationSec, fullScript: clips.map((c) => c.text).join('\n\n') };
}
function validateSelection(source, input) {
  try {
    if (input && Object.hasOwn(input, 'lockedSentenceIds')) invalid('模型不得自行設定教師鎖定句子');
    return { valid: true, errors: [], ...resolveSelection(source, input) };
  }
  catch (error) { return { valid: false, errors: [error.message] }; }
}
module.exports = { validateSelection, resolveSelection, KEEP };
