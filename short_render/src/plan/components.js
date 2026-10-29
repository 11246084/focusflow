'use strict';
const { validateIcon } = require('./assets');

// 元件庫：每個元件宣告「接受哪些參數」「有哪些 cue」「畫面上會出現哪些文字」。
// 同一份宣告同時支援：參數檢查、cue 名稱檢查、數字／名詞對證（texts）。
// 渲染（HTML/動畫）在 render/html.js，鍵名必須與這裡一致。

const STAT_KEYS = ['label', 'kicker', 'value', 'unit', 'badge'];
// huge=黃色大字、display=白色大字、mid=白色中字、text=灰紫說明字、num=白色粗數字、op=黃色運算符、unit=黃色單位、blank=空框
const TOKEN_STYLES = ['text', 'num', 'op', 'unit', 'blank', 'huge', 'display', 'mid'];
const MARKS = ['✕', '✓', 'none'];

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalText(errors, params, key) {
  if (params[key] !== undefined && params[key] !== null && !isText(params[key])) {
    errors.push(`params.${key} must be a non-empty string when present`);
  }
}

function requireText(errors, params, key) {
  if (!isText(params[key])) {
    errors.push(`params.${key} is required (non-empty string)`);
  }
}

function range(count) {
  return Array.from({ length: count }, (_, index) => index);
}

const DEFINITIONS = {
  stat: (params) => {
    const errors = [];
    const texts = [];
    if (!(typeof params.value === 'number' || isText(params.value))) {
      errors.push('params.value is required (number or string)');
    } else {
      texts.push(String(params.value));
    }
    for (const key of ['label', 'kicker', 'unit', 'badge']) {
      optionalText(errors, params, key);
      if (isText(params[key])) texts.push(params[key]);
    }
    return { errors, texts, cues: STAT_KEYS };
  },

  slots: (params) => {
    const errors = [];
    const texts = [];
    const count = params.count;
    if (!Number.isInteger(count) || count < 1 || count > 6) {
      errors.push('params.count must be an integer between 1 and 6');
    }
    requireText(errors, params, 'badge');
    optionalText(errors, params, 'label');
    for (const key of ['label', 'badge']) {
      if (isText(params[key])) texts.push(params[key]);
    }
    const lit = Number.isInteger(count) && count >= 1 && count <= 6 ? range(count).map((i) => `lit${i}`) : [];
    return { errors, texts, cues: ['show', ...lit] };
  },

  rows: (params) => {
    const errors = [];
    const texts = [];
    const cues = ['note'];
    if (!Array.isArray(params.rows) || params.rows.length < 1 || params.rows.length > 4) {
      errors.push('params.rows must be an array of 1-4 rows');
    } else {
      params.rows.forEach((row, rowIndex) => {
        if (!Array.isArray(row?.tokens) || row.tokens.length < 1 || row.tokens.length > 6) {
          errors.push(`params.rows[${rowIndex}].tokens must be an array of 1-6 tokens`);
          return;
        }
        row.tokens.forEach((token, tokenIndex) => {
          if (!isText(token?.t)) {
            errors.push(`params.rows[${rowIndex}].tokens[${tokenIndex}].t is required`);
          } else {
            texts.push(token.t);
          }
          if (token?.style !== undefined && !TOKEN_STYLES.includes(token.style)) {
            errors.push(`params.rows[${rowIndex}].tokens[${tokenIndex}].style must be one of ${TOKEN_STYLES.join('|')}`);
          }
          cues.push(`r${rowIndex}t${tokenIndex}`);
        });
      });
    }
    optionalText(errors, params, 'note');
    if (isText(params.note)) texts.push(params.note);
    return { errors, texts, cues };
  },

  'quote-reveal': (params) => {
    const errors = [];
    requireText(errors, params, 'text');
    optionalText(errors, params, 'label');
    const texts = ['label', 'text'].map((key) => params[key]).filter(isText);
    if (isText(params.text) && [...params.text].length > 24) {
      errors.push('params.text is too long for a single-line quote (max 24 characters)');
    }
    return { errors, texts, cues: ['label', 'text'] };
  },

  chips: (params) => {
    const errors = [];
    const texts = [];
    const cues = ['enter', 'note', 'caption'];
    const chips = params.chips;
    if (!Array.isArray(chips) || chips.length < 2 || chips.length > 6 || !chips.every(isText)) {
      errors.push('params.chips must be an array of 2-6 non-empty strings');
    } else {
      texts.push(...chips);
      for (const index of params.highlight || []) {
        if (!Number.isInteger(index) || index < 0 || index >= chips.length) {
          errors.push(`params.highlight index ${index} is out of range`);
        } else {
          cues.push(`hl${index}`);
        }
      }
      if (params.dimKeep !== undefined) {
        if (!Number.isInteger(params.dimKeep) || params.dimKeep < 0 || params.dimKeep >= chips.length) {
          errors.push('params.dimKeep is out of range');
        } else {
          cues.push('dim');
        }
      }
    }
    if (params.question) cues.push('q');
    for (const key of ['note', 'caption']) {
      optionalText(errors, params, key);
      if (isText(params[key])) texts.push(params[key]);
    }
    return { errors, texts, cues };
  },

  compare: (params) => {
    const errors = [];
    const texts = [];
    for (const side of ['left', 'right']) {
      if (!isText(params[side]?.value)) {
        errors.push(`params.${side}.value is required`);
      } else {
        texts.push(params[side].value);
      }
      if (params[side]?.label !== undefined) {
        if (!isText(params[side].label)) errors.push(`params.${side}.label must be a non-empty string`);
        else texts.push(params[side].label);
      }
    }
    optionalText(errors, params, 'link');
    if (isText(params.link)) texts.push(params.link);
    if (params.mark !== undefined && !MARKS.includes(params.mark)) {
      errors.push(`params.mark must be one of ${MARKS.join('|')}`);
    }
    return { errors, texts, cues: ['left', 'link', 'right', 'mark'] };
  },

  checklist: (params) => {
    const errors = [];
    const texts = [];
    const cues = ['head', 'banner'];
    if (!Array.isArray(params.items) || params.items.length < 1 || params.items.length > 6 || !params.items.every(isText)) {
      errors.push('params.items must be an array of 1-6 non-empty strings');
    } else {
      texts.push(...params.items);
      params.items.forEach((_, index) => cues.push(`item${index}`));
    }
    if (params.mark !== undefined && !MARKS.includes(params.mark)) {
      errors.push(`params.mark must be one of ${MARKS.join('|')}`);
    }
    for (const key of ['head', 'banner']) {
      optionalText(errors, params, key);
      if (isText(params[key])) texts.push(params[key]);
    }
    return { errors, texts, cues };
  },

  'place-values': (params) => {
    const errors = [];
    const texts = [];
    const { digits, labels } = params;
    if (!Array.isArray(digits) || digits.length < 1 || digits.length > 6
      || !digits.every((digit) => typeof digit === 'string' && /^\d$/.test(digit))) {
      errors.push('params.digits must be an array of 1-6 single-digit strings');
    }
    if (!Array.isArray(labels) || !Array.isArray(digits) || labels.length !== digits.length || !labels.every(isText)) {
      errors.push('params.labels must have the same length as params.digits');
    }
    optionalText(errors, params, 'note');
    if (Array.isArray(digits)) texts.push(digits.join(''));
    if (Array.isArray(labels)) texts.push(...labels.filter(isText));
    if (isText(params.note)) texts.push(params.note);
    const cues = Array.isArray(digits) ? [...range(digits.length).map((i) => `d${i}`), 'note'] : ['note'];
    return { errors, texts, cues };
  },

  relation: (params) => {
    const errors = [];
    const texts = [];
    if (!Array.isArray(params.words) || params.words.length !== 3 || !params.words.every(isText)) {
      errors.push('params.words must be an array of exactly 3 non-empty strings');
    } else {
      texts.push(...params.words);
    }
    optionalText(errors, params, 'note');
    if (isText(params.note)) texts.push(params.note);
    return { errors, texts, cues: ['w0', 'w1', 'w2', 'l0', 'l1', 'note'] };
  },
};

function sceneItems(params, keys) {
  const errors = [], texts = [];
  for (const key of keys) {
    const value = params[key];
    if (!value || typeof value !== 'object' || !isText(value.text) || [...value.text].length > 12) errors.push(`params.${key} requires text (max 12 characters) and optional icon`);
    else texts.push(value.text);
  }
  return { errors, texts };
}

DEFINITIONS['not-fit'] = (p) => ({ ...sceneItems(p, ['object', 'container']), cues: ['object', 'container', 'attempt', 'reject'] });
DEFINITIONS['not-merge'] = (p) => ({ ...sceneItems(p, ['left', 'right', 'result']), cues: ['left', 'right', 'attempt', 'reject'] });
DEFINITIONS.nested = (p) => {
  if (!Array.isArray(p.layers) || p.layers.length < 2 || p.layers.length > 3) return { errors: ['params.layers must contain 2-3 outer-to-inner items'], texts: [], cues: [] };
  const r = sceneItems(Object.fromEntries(p.layers.map((v, i) => [i, v])), p.layers.map((_, i) => i));
  return { ...r, cues: p.layers.map((_, i) => `layer${i}`) };
};
const CODE_SOURCES = ['畫面原樣', 'AI 修正', 'AI 補寫'];
DEFINITIONS.code = (p) => {
  const errors = [], texts = [];
  if (!['javascript', 'python', 'cpp', 'c', 'csharp', 'java', 'text'].includes(p.language)) errors.push('params.language must be a supported language');
  if (!Array.isArray(p.lines) || p.lines.length < 1 || p.lines.length > 12) errors.push('params.lines must contain 1-12 lines');
  else for (const [i, line] of p.lines.entries()) {
    if (typeof line?.text !== 'string' || [...line.text].length > 36 || /[\r\n]/.test(line.text)) errors.push(`line ${i + 1} must be one line of at most 36 characters`);
    if (!CODE_SOURCES.includes(line?.source) || typeof line?.originalText !== 'string') errors.push(`line ${i + 1} requires source and originalText`);
    if (line?.source === '畫面原樣' && line.text !== line.originalText) errors.push(`line ${i + 1} original source must match text`);
    if (line?.intentionalError && line.text !== line.originalText) errors.push(`line ${i + 1} intentional error must remain unchanged`);
    if (typeof line?.text === 'string') texts.push(line.text);
  }
  const count = p.lines?.length || 0;
  for (const n of p.highlightLines || []) if (!Number.isInteger(n) || n < 1 || n > count) errors.push('highlightLines must reference existing one-based lines');
  for (const box of p.boxes || []) {
    const text = p.lines?.[box?.line - 1]?.text;
    if (!text || !isText(box?.text) || !text.includes(box.text) || text.indexOf(box.text) !== text.lastIndexOf(box.text)) errors.push('boxes must reference an existing line and unique literal text');
  }
  const all = (p.lines || []).map((v) => v?.text || '').join('\n');
  for (const name of p.requiredVariables || []) if (!isText(name) || !new RegExp(`(^|[^\\p{L}\\p{N}_])${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}_]|$)`, 'u').test(all)) errors.push('required variable is missing');
  if (p.errorMessage !== undefined) { if (!isText(p.errorMessage) || [...p.errorMessage].length > 80) errors.push('errorMessage must have 1-80 characters'); else texts.push(p.errorMessage); }
  if (p.diagram !== undefined) { const d = DEFINITIONS.nested(p.diagram); errors.push(...d.errors); texts.push(...d.texts); }
  return { errors, texts, cues: ['enter', ...(p.lines || []).map((_, i) => `line${i + 1}`), 'error', 'diagram'] };
};
const COMPONENT_NAMES = Object.keys(DEFINITIONS);

// Rich item variants preserve the original string-only fixture interface.
function normalizeComponentParams(component, input) {
  const p = structuredClone(input);
  const text = (item) => typeof item === 'object' && item ? item.text : item;
  if (component === 'compare') for (const side of ['left', 'right']) if (p[side]?.text !== undefined && p[side].value === undefined) p[side].value = p[side].text;
  if (component === 'chips') p.chips = p.chips?.map(text);
  if (component === 'checklist') p.items = p.items?.map(text);
  if (component === 'relation') p.words = p.words?.map(text);
  if (component === 'place-values') p.labels = p.labels?.map(text);
  return p;
}

function iconErrors(value, prefix = 'params') {
  if (!value || typeof value !== 'object') return [];
  const errors = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === 'icon' && !validateIcon(child)) errors.push(`${prefix}.icon is not in the approved asset allowlist`);
    else if (child && typeof child === 'object') errors.push(...iconErrors(child, `${prefix}.${key}`));
  }
  return errors;
}

/**
 * @returns {{errors: string[], texts: string[], cues: string[]}}
 */
function describeComponent(component, params) {
  const definition = DEFINITIONS[component];
  if (!definition) {
    return { errors: [`unknown component "${component}" (expected one of ${COMPONENT_NAMES.join(', ')})`], texts: [], cues: [] };
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return { errors: ['params must be an object'], texts: [], cues: [] };
  }
  try {
    const described = definition(normalizeComponentParams(component, params));
    return { ...described, errors: [...described.errors, ...iconErrors(params)], cues: [...new Set([...described.cues, 'stamp'])] };
  } catch {
    return { errors: ['component params have invalid field types'], texts: [], cues: [] };
  }
}

module.exports = { COMPONENT_NAMES, TOKEN_STYLES, CODE_SOURCES, describeComponent, normalizeComponentParams };
