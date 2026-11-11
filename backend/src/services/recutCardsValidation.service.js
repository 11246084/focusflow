'use strict';
const normalized = (text) => String(text).normalize('NFKC').toLocaleLowerCase('en');
function technicalTokens(text) {
  return normalized(text).match(/[a-z_$][a-z0-9_$]*(?:[#+]+|(?:\.[a-z0-9_$]+)+)?/g) || [];
}
const CN_DIGITS = { '零': 0, '〇': 0, '○': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '壹': 1, '貳': 2, '參': 3, '肆': 4, '伍': 5, '陸': 6, '柒': 7, '捌': 8, '玖': 9 };
const CN_UNITS = { 十: 10n, 拾: 10n, 百: 100n, 佰: 100n, 千: 1000n, 仟: 1000n, 萬: 10000n, 億: 100000000n, 兆: 1000000000000n };
const DIGITS = '0-9零〇○一二兩三四五六七八九壹貳參肆伍陸柒捌玖';
const INTEGER = `[${DIGITS}十拾百佰千仟萬億兆]+`;
const NUMBER = `[+負正-]?${INTEGER}(?:[.點][${DIGITS}]+)?`;
function integerValue(text) {
  if (/^\d+$/.test(text)) return BigInt(text).toString();
  if (![...text].some((c) => CN_UNITS[c])) return [...text].map((c) => CN_DIGITS[c] ?? c).join('').replace(/^0+(?=\d)/, '');
  let total = 0n, section = 0n, value = 0n;
  for (const token of text.match(/\d+|./gu)) {
    const unit = CN_UNITS[token];
    if (!unit) value = /^\d+$/.test(token) ? BigInt(token) : BigInt(CN_DIGITS[token]);
    else if (unit < 10000n) { section += (value || 1n) * unit; value = 0n; }
    else { total += (section + value || 1n) * unit; section = 0n; value = 0n; }
  }
  return String(total + section + value);
}
function numberValue(raw) {
  const negative = /^[-負]/.test(raw); const text = raw.replace(/^[+負正-]/, '');
  const [integer, decimal] = text.split(/[.點]/);
  const fraction = decimal === undefined ? '' : [...decimal].map((c) => CN_DIGITS[c] ?? c).join('').replace(/0+$/, '');
  return `${negative ? '-' : ''}${integerValue(integer)}${fraction ? `.${fraction}` : ''}`;
}
function numericTokens(text) {
  // Ignore lexical uses of 一/萬 instead of treating ordinary words as counts.
  // Quantities such as 一個/第三/三維 remain numeric; no broad similarity rule.
  const input = normalized(text).replace(/一(?:樣|起|旦|定|些|直|律|般|致|切|如|向)|唯[一]|統[一]|逐[一]|萬一|千萬(?=不|別|要)/gu, (s) => ' '.repeat(s.length));
  const pattern = new RegExp(`百分之(${NUMBER})|千分之(${NUMBER})|(${NUMBER})分之(${NUMBER})|(${NUMBER})/(${NUMBER})|(${NUMBER})([%‰]?)`, 'gu');
  const result = [];
  for (const match of input.matchAll(pattern)) {
    if (match[7] && /^[+負正-]?[壹貳參肆伍陸柒捌玖]$/.test(match[7])) {
      const before = input.slice(0, match.index), after = input.slice(match.index + match[0].length);
      // Exempt recognized lexical compounds, not unknown units or bare values.
      // Thus 參考/陸地 are words, while 陸圓/伍公里/數量是陸 remain numbers.
      const digit = match[7].replace(/^[+負正-]/, '');
      const lexical = (digit === '參' && /^(考|數|照|與|加|訪|賽|見|拜|會|展|謀)/.test(after))
        || (digit === '陸' && (/^(地|續|路|軍|海|空|戰|運)/.test(after) || /[大登著內]$/.test(before)))
        || (digit === '伍' && /隊$/.test(before)) || (digit === '肆' && /^(虐|意)/.test(after));
      if (!match[8] && !/第\s*$/.test(before) && lexical) continue;
    }
    if (match[1]) result.push(`${numberValue(match[1])}%`);
    else if (match[2]) result.push(`${numberValue(match[2])}‰`);
    else if (match[3]) result.push(`${numberValue(match[4])}/${numberValue(match[3])}`);
    else if (match[5]) result.push(`${numberValue(match[5])}/${numberValue(match[6])}`);
    else result.push(`${numberValue(match[7])}${match[8]}`);
  }
  return result;
}
// Exact tokens, sentence-local. No semantic similarity threshold: paraphrase is
// allowed; meaning drift remains the third model check and teacher decision.
function validateSubtitleSources(plan, source, courseTerms = []) {
  const errors = [], byId = new Map(source.sentences.map((s) => [s.id, s]));
  for (const [index, subtitle] of (plan.subtitles || []).entries()) {
    const sentence = byId.get(subtitle.from?.sentenceId);
    if (!sentence) { errors.push(`字幕${index}引用不存在的句子。`); continue; }
    const text = (subtitle.runs || []).map((run) => run.t).join('');
    const originalNumbers = new Set(numericTokens(sentence.text)), originalTerms = new Set(technicalTokens(sentence.text));
    for (const token of numericTokens(text)) if (!originalNumbers.has(token)) errors.push(`字幕${index}數字沒有對應原句出處：${token}`);
    for (const token of technicalTokens(text)) if (!originalTerms.has(token)) errors.push(`字幕${index}專有名詞沒有對應原句出處：${token}`);
    for (const term of courseTerms) if (normalized(text).includes(normalized(term)) && !normalized(sentence.text).includes(normalized(term))) errors.push(`字幕${index}課程術語沒有對應原句出處：${term}`);
  }
  return { valid: !errors.length, errors };
}
module.exports = { validateSubtitleSources, technicalTokens, numericTokens };
