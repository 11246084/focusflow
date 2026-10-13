'use strict';

// 文字比對用的純函式。anchor 與證據是否「對得上」都靠這裡，所以規則集中在一處。

// 簡體字偵測清單。**與 backend/src/services/shortScriptGeneration.service.js 的
// SIMPLIFIED_ONLY 必須保持一致**（盡力而為的清單，不是完整簡繁對照表）。
// 之後 recut 接進後端時，應改成由同一個模組匯出，避免兩份漂移。
const SIMPLIFIED_ONLY = new Set([
  '经', '济', '发', '达', '国', '际', '认', '识', '过', '还', '这', '样', '们', '时',
  '间', '关', '键', '习', '数', '据', '电', '脑', '视', '觉', '简', '单', '复', '杂',
  '运', '训', '练', '选', '择', '设', '备', '图', '检', '测', '应', '该', '说', '实',
  '现', '开', '软', '网', '络', '结', '构', '级', '类', '别', '资', '讯', '处', '题',
  '问', '让', '两', '为', '会', '来', '东', '师', '课', '业', '专', '门', '进', '内',
  '边', '长', '书', '总', '论', '证', '断', '与',
]);

function findSimplifiedCharacters(text) {
  const found = new Set();
  for (const character of String(text || '')) {
    if (SIMPLIFIED_ONLY.has(character)) {
      found.add(character);
    }
  }
  return [...found];
}

const FULLWIDTH_DIGITS = /[０-９]/g;

// 中文數字 → 阿拉伯數字。Whisper 會把老師講的「200 張」「60 萬」寫成「兩百張」「六十萬」，
// 而證據（另一個模型的逐字稿）可能寫成阿拉伯數字；比對前兩邊都轉成同一種寫法。
// 只轉「至少含一個 一～九 的數字串」：單獨的「十」「百」「萬」不動，所以「個十百千萬」不會被誤讀。
const DIGIT_VALUE = {
  一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const NUMERAL_PATTERN = /(?:[一二兩三四五六七八九]千)?(?:[一二兩三四五六七八九]百)?零?(?:[一二兩三四五六七八九]?十)?[一二三四五六七八九]?/gu;

function numeralValue(text) {
  let value = 0;
  let rest = text.replace('零', '');
  const thousands = rest.match(/^([一二兩三四五六七八九])千/u);
  if (thousands) {
    value += DIGIT_VALUE[thousands[1]] * 1000;
    rest = rest.slice(2);
  }
  const hundreds = rest.match(/^([一二兩三四五六七八九])百/u);
  if (hundreds) {
    value += DIGIT_VALUE[hundreds[1]] * 100;
    rest = rest.slice(2);
  }
  const tens = rest.match(/^([一二兩三四五六七八九])?十/u);
  if (tens) {
    value += (tens[1] ? DIGIT_VALUE[tens[1]] : 1) * 10;
    rest = rest.slice(tens[0].length);
  }
  if (rest) value += DIGIT_VALUE[rest] || 0;
  return value;
}

/**
 * 把字串切成片段：中文數字串換成阿拉伯數字，其餘每個字一片。
 * 每一片都記錄原字串的 [from, to)，讓呼叫端能對回原本的位置（字詞索引）。
 */
function numeralPieces(text) {
  const pieces = [];
  const chars = [...text];
  const flat = chars.join('');
  let position = 0;
  NUMERAL_PATTERN.lastIndex = 0;
  let match = NUMERAL_PATTERN.exec(flat);
  const matches = [];
  while (match !== null) {
    if (match[0] === '') {
      NUMERAL_PATTERN.lastIndex += 1;
    } else if (/[一二兩三四五六七八九]/u.test(match[0])) {
      matches.push({ from: match.index, to: match.index + match[0].length, value: numeralValue(match[0]) });
    }
    match = NUMERAL_PATTERN.exec(flat);
  }

  const byStart = new Map(matches.map((item) => [item.from, item]));
  while (position < chars.length) {
    const hit = byStart.get(position);
    if (hit) {
      pieces.push({ text: String(hit.value), from: hit.from, to: hit.to });
      position = hit.to;
    } else {
      pieces.push({ text: chars[position], from: position, to: position + 1 });
      position += 1;
    }
  }
  return pieces;
}

const SEPARATOR = /^[\s\p{P}\p{S}]$/u;

function foldWidthAndCase(value) {
  return String(value ?? '')
    .replace(FULLWIDTH_DIGITS, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/**
 * 比對用正規化：全形數字轉半形、英文轉小寫、中文數字轉阿拉伯數字，最後去掉空白與標點。
 * 順序很重要：標點要留到數字轉換「之後」才去掉，否則「六十，六十萬」會被接成「六十六十萬」而誤讀成 66。
 * 注意：不做簡繁轉換，也不做同音字修正——那會讓比對變成「猜」。
 */
function normalizeText(value) {
  return numeralPieces(foldWidthAndCase(value))
    .filter((piece) => !SEPARATOR.test(piece.text))
    .map((piece) => piece.text)
    .join('');
}

/**
 * 對字詞序列做同樣的正規化，並記錄每個輸出字元來自第幾個字詞（含起訖）。
 * 先把所有字詞接起來再轉數字，因為 ASR 常把「兩百張」拆成「兩」「百」「張」三個字詞。
 *
 * @param {{w: string}[]} words
 * @returns {{chars: string[], startWord: number[], endWord: number[]}}
 */
function normalizeWords(words) {
  const raw = [];
  const owners = [];
  words.forEach((word, index) => {
    for (const character of foldWidthAndCase(word.w)) {
      raw.push(character);
      owners.push(index);
    }
  });

  const chars = [];
  const startWord = [];
  const endWord = [];
  for (const piece of numeralPieces(raw.join(''))) {
    if (SEPARATOR.test(piece.text)) continue;
    for (const character of piece.text) {
      chars.push(character);
      startWord.push(owners[piece.from]);
      endWord.push(owners[piece.to - 1]);
    }
  }
  return { chars, startWord, endWord };
}

const CJK_DIGITS = {
  〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 取出文字中的數字（阿拉伯數字；逗號千分位會被去掉）。 */
function extractNumbers(value) {
  const matches = String(value ?? '').match(/\d+(?:[.,]\d+)*/g) || [];
  return matches.map((item) => Number(item.replace(/,/g, ''))).filter((item) => Number.isFinite(item));
}

/** 證據文字裡出現過的數字集合：阿拉伯數字，加上單字的中文數字（四張、六開頭）。 */
function numbersInEvidence(value) {
  const numbers = new Set(extractNumbers(value));
  for (const character of String(value ?? '')) {
    if (Object.prototype.hasOwnProperty.call(CJK_DIGITS, character)) {
      numbers.add(CJK_DIGITS[character]);
    }
  }
  return numbers;
}

function levenshtein(left, right) {
  const a = [...left];
  const b = [...right];
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** 0..1，1 代表完全相同（已正規化）。 */
function similarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  const longest = Math.max([...a].length, [...b].length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

module.exports = {
  findSimplifiedCharacters,
  normalizeText,
  normalizeWords,
  extractNumbers,
  numbersInEvidence,
  levenshtein,
  similarity,
};
