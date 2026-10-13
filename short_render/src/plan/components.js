'use strict';

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

const COMPONENT_NAMES = Object.keys(DEFINITIONS);

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
  const described = definition(params);
  return { ...described, cues: [...new Set([...described.cues, 'stamp'])] };
}

module.exports = { COMPONENT_NAMES, TOKEN_STYLES, describeComponent };
