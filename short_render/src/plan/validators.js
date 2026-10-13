'use strict';

const { LIMITS } = require('./constants');
const { validateStructure, issue } = require('./schema');
const { describeComponent } = require('./components');
const {
  normalizeText, extractNumbers, numbersInEvidence, similarity,
} = require('./text');

// 指涉畫面的句子：抽出來單獨看就不成立（模板 06 把它列為人工檢查項，這裡自動提醒）。
const REFERENTIAL = /(你們?看(這|那|螢幕|畫面|投影片)|看這(邊|裡|個|張)|看一下這|這張(圖|投影片)|剛才那(張|個)|如圖|螢幕上)/;

function chunkMap(evidence) {
  return new Map((evidence || []).map((item) => [String(item.chunkId), item]));
}

function joinedText(chunkIds, chunks) {
  return chunkIds.map((id) => chunks.get(String(id))?.rawText || '').join(' ');
}

function occurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let position = haystack.indexOf(needle);
  while (position !== -1) {
    count += 1;
    position = haystack.indexOf(needle, position + 1);
  }
  return count;
}

/**
 * 四則運算求值（遞迴下降）。刻意不用 eval／Function：expr 來自 LLM，
 * 只允許數字、小數點、+ - * / 與括號，其餘一律回傳 NaN。
 */
function safeEvaluate(expression) {
  const tokens = String(expression).match(/\d+(?:\.\d+)?|[()+\-*/]|\S/g) || [];
  let position = 0;

  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function parseFactor() {
    const token = take();
    if (token === undefined) throw new Error('unexpected end');
    if (token === '-') return -parseFactor();
    if (token === '(') {
      const value = parseExpression();
      if (take() !== ')') throw new Error('missing )');
      return value;
    }
    if (/^\d/.test(token)) return Number(token);
    throw new Error(`unexpected token ${token}`);
  }

  function parseTerm() {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const operator = take();
      const right = parseFactor();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const operator = take();
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  try {
    const value = parseExpression();
    return position === tokens.length && Number.isFinite(value) ? value : NaN;
  } catch {
    return NaN;
  }
}

function approxEqual(left, right) {
  return Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

/** value 以及 value 縮放 10^-k 之後的數字（12000 萬 → 1.2 億 這類單位換算）。 */
function scaledForms(value) {
  const forms = [];
  for (let power = 0; power <= 8; power += 1) {
    forms.push(Number((value / 10 ** power).toFixed(6)));
  }
  return forms;
}

/** 計畫中所有「會出現在畫面上的文字」，連同來源路徑。 */
function collectDisplayTexts(plan) {
  const items = [];
  items.push({ path: 'title.text', text: plan.title.text });
  plan.subtitles.forEach((subtitle, index) => {
    items.push({ path: `subtitles[${index}]`, text: subtitle.runs.map((run) => run.t).join('') });
  });
  plan.scenes.forEach((scene, index) => {
    const { texts } = describeComponent(scene.component, scene.params);
    texts.forEach((text) => items.push({ path: `scenes[${index}].params`, text }));
    if (scene.stamp?.text) items.push({ path: `scenes[${index}].stamp`, text: scene.stamp.text });
  });
  items.push({ path: 'endCard.line1', text: plan.endCard.line1 });
  if (plan.endCard.line2) items.push({ path: 'endCard.line2', text: plan.endCard.line2 });
  return items;
}

/**
 * V1：引用必須在凍結證據內；來源影片要對得上。
 */
function checkEvidence(plan, chunks, errors) {
  plan.clips.forEach((clip, index) => {
    for (const id of clip.chunkIds) {
      const chunk = chunks.get(String(id));
      if (!chunk) {
        errors.push(issue('EVIDENCE_MISSING', `clips[${index}].chunkIds`, `chunk "${id}" is not in the frozen evidence`));
      } else if (chunk.videoId && String(chunk.videoId) !== String(plan.source.videoId)) {
        errors.push(issue('SOURCE_MISMATCH', `clips[${index}].chunkIds`, `chunk "${id}" belongs to video ${chunk.videoId}, not ${plan.source.videoId}`));
      }
    }
  });
  plan.scenes.forEach((scene, index) => {
    for (const id of scene.basedOn) {
      if (!chunks.has(String(id))) {
        errors.push(issue('EVIDENCE_MISSING', `scenes[${index}].basedOn`, `chunk "${id}" is not in the frozen evidence`));
      }
    }
  });
}

/**
 * V2（對齊前）：每個錨點都要能在它引用的 chunk 文字裡找到。
 * 這裡比的是 LLM 當時看到的證據原文，所以要求完全相同（不做模糊）。
 */
function checkAnchorsInEvidence(plan, chunks, errors) {
  const clipText = Object.fromEntries(
    plan.clips.map((clip) => [clip.id, normalizeText(joinedText(clip.chunkIds, chunks))]),
  );

  const verify = (clipId, anchor, path) => {
    const text = clipText[clipId];
    if (text === undefined) return;
    const target = normalizeText(anchor.text);
    const needed = anchor.nth || 1;
    if (occurrences(text, target) < needed) {
      errors.push(issue('ANCHOR_NOT_IN_EVIDENCE', path, `anchor "${anchor.text}"${needed > 1 ? ` (#${needed})` : ''} is not found in the cited chunks of clip "${clipId}"`));
    }
  };

  plan.clips.forEach((clip, index) => {
    verify(clip.id, clip.from, `clips[${index}].from`);
    verify(clip.id, clip.to, `clips[${index}].to`);
  });
  plan.subtitles.forEach((subtitle, index) => verify(subtitle.clip, subtitle.from, `subtitles[${index}].from`));
  plan.scenes.forEach((scene, index) => {
    for (const [name, cue] of Object.entries(scene.cues || {})) {
      verify(cue.clip || scene.clips[0], cue, `scenes[${index}].cues.${name}`);
    }
  });
}

/**
 * V3：數字與推導。畫面上每個數字都必須出現在引用的證據，或是由 derived 重算得到。
 * 這是整套設計裡最重要的一道關：它讓「動畫上的數字」和「老師說過的話」之間有可驗證的連結。
 */
function checkNumbers(plan, chunks, errors) {
  const cited = new Set();
  plan.clips.forEach((clip) => clip.chunkIds.forEach((id) => cited.add(String(id))));
  plan.scenes.forEach((scene) => scene.basedOn.forEach((id) => cited.add(String(id))));
  const evidenceNumbers = numbersInEvidence(joinedText([...cited], chunks));

  const allowed = new Set(evidenceNumbers);

  (plan.derived || []).forEach((item, index) => {
    const path = `derived[${index}]`;
    const computed = safeEvaluate(item.expr);
    if (!Number.isFinite(computed) || !approxEqual(computed, item.value)) {
      errors.push(issue('DERIVED_MISMATCH', path, `"${item.expr}" evaluates to ${computed}, not ${item.value}`));
      return;
    }
    for (const input of extractNumbers(item.expr)) {
      if (!evidenceNumbers.has(input)) {
        errors.push(issue('DERIVED_INPUT', path, `input ${input} of "${item.expr}" does not appear in the cited evidence`));
      }
    }
    const forms = scaledForms(item.value);
    forms.forEach((form) => allowed.add(form));
    for (const shown of item.shows || []) {
      for (const number of extractNumbers(shown)) {
        if (!forms.some((form) => approxEqual(form, number))) {
          errors.push(issue('DERIVED_SHOWS', path, `shown value ${number} is not ${item.value} or a power-of-ten rescaling of it`));
        }
      }
    }
  });

  for (const { path, text } of collectDisplayTexts(plan)) {
    for (const number of extractNumbers(text)) {
      if (!allowed.has(number)) {
        errors.push(issue('NUMBER_UNSUPPORTED', path, `number ${number} in "${text}" is neither in the cited evidence nor derived from it`));
      }
    }
  }
}

/** V7：指涉畫面句警告（不阻擋，交給教師判斷）。 */
function checkReferential(plan, chunks, warnings) {
  plan.clips.forEach((clip, index) => {
    const text = joinedText(clip.chunkIds, chunks);
    const match = text.match(REFERENTIAL);
    if (match) {
      warnings.push(issue('REFERENTIAL_PHRASE', `clips[${index}]`, `cited text contains "${match[0]}", which may not make sense without the original slide`));
    }
  });
}

/**
 * V2'/V5：對齊後的時間檢查。需要 resolved。
 */
function checkResolved(plan, chunks, resolved, errors) {
  const tolerance = LIMITS.chunkTimeToleranceSeconds;

  resolved.clips.forEach((clip, index) => {
    const planClip = plan.clips[index];
    const cited = planClip.chunkIds.map((id) => chunks.get(String(id))).filter(Boolean);
    const starts = cited.map((chunk) => chunk.startSec).filter(Number.isFinite);
    const ends = cited.map((chunk) => chunk.endSec).filter(Number.isFinite);
    if (starts.length && ends.length) {
      const low = Math.min(...starts) - tolerance;
      const high = Math.max(...ends) + tolerance;
      if (clip.srcStart < low || clip.srcEnd > high) {
        errors.push(issue('CLIP_OUTSIDE_CHUNK', `clips[${index}]`, `clip ${clip.srcStart}-${clip.srcEnd}s falls outside its cited chunks (${low + tolerance}-${high - tolerance}s ±${tolerance}s)`));
      }
    }
    if (clip.dur < 0.8) {
      errors.push(issue('CLIP_TOO_SHORT', `clips[${index}]`, `clip "${clip.id}" is only ${clip.dur}s`));
    }
  });

  if (resolved.total < LIMITS.minSeconds || resolved.total > LIMITS.maxSeconds) {
    errors.push(issue('DURATION', 'total', `total ${resolved.total}s is outside ${LIMITS.minSeconds}-${LIMITS.maxSeconds}s`));
  }

  resolved.scenes.forEach((scene, index) => {
    if (scene.t1 - scene.t0 < LIMITS.minSceneSeconds) {
      errors.push(issue('SCENE_TOO_SHORT', `scenes[${index}]`, `scene "${scene.id}" lasts ${Math.round((scene.t1 - scene.t0) * 100) / 100}s (min ${LIMITS.minSceneSeconds}s)`));
    }
    for (const [name, time] of Object.entries(scene.cues)) {
      if (time < scene.t0 || time > scene.t1 - 0.2) {
        errors.push(issue('CUE_OUT_OF_SCENE', `scenes[${index}].cues.${name}`, `cue at ${time}s is outside the scene (${scene.t0}-${scene.t1}s)`));
      }
    }
  });
}

/**
 * V6：剪出來的音訊重新轉錄後，要和預期的文字相符（避免剪掉半個字或剪錯段）。
 * 轉錄由呼叫端負責（需要外部 ASR），這裡只做比對。
 */
function compareCutText(expected, actual) {
  const score = similarity(expected, actual);
  return {
    ok: score >= LIMITS.cutTextSimilarity,
    score: Math.round(score * 1000) / 1000,
  };
}

/**
 * 完整驗證。
 *
 * @param plan
 * @param {{ evidence: {chunkId: string, videoId?: string, startSec?: number, endSec?: number, rawText?: string}[],
 *           resolved?: object }} context
 * @returns {{valid: boolean, errors: object[], warnings: object[]}}
 */
function validatePlan(plan, { evidence = [], resolved = null } = {}) {
  const errors = validateStructure(plan);
  const warnings = [];
  if (errors.length) {
    return { valid: false, errors, warnings };
  }

  const chunks = chunkMap(evidence);
  checkEvidence(plan, chunks, errors);
  checkAnchorsInEvidence(plan, chunks, errors);
  checkNumbers(plan, chunks, errors);
  checkReferential(plan, chunks, warnings);
  if (resolved) {
    checkResolved(plan, chunks, resolved, errors);
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = {
  validatePlan,
  compareCutText,
  collectDisplayTexts,
  safeEvaluate,
};
