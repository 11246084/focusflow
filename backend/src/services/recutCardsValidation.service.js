'use strict';
const normalized = (text) => String(text).normalize('NFKC').toLocaleLowerCase('en');
function technicalTokens(text) {
  return normalized(text).match(/[a-z_$][a-z0-9_$]*(?:[#+]+|(?:\.[a-z0-9_$]+)+)?/g) || [];
}
function numericTokens(text) { return normalized(text).match(/[+-]?\d+(?:\.\d+)?(?:%|‰)?/g) || []; }
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
