const env = require('../config/env');
const { isJevAvailable, evaluate, mockNoulResult } = require('./jevClient');

// ---------------------------------------------------------------------------
// questionGuard.service.js — QA 問題品質守門
//
// 用 Jev 的 Noul primitive 在 LLM 生成前快速判斷：
//   1. is_meaningful：「這是否是一個關於課程內容的有意義問題？」
//   2. is_safe：「這個問題是否不含有害、辱罵或完全無關的內容？」
//
// 設計原則：
//   - Fail-open：任何 Jev 失敗、超時、mock 結果一律放行，不阻斷學生。
//   - Feature-gated：需 JEV_ENABLED=true + JEV_QUESTION_GUARD_ENABLED=true。
//   - 低信心結果放行：confidence < JEV_GUARD_THRESHOLD 時仍放行。
//   - 不替代現有的字數檢查和每日次數限制（那些是 askLimits 的職責）。
// ---------------------------------------------------------------------------

const GUARD_QUESTIONS = {
  is_meaningful: {
    type: 'noul',
    instructions: 'Is this a genuine question about educational or course content that could be meaningfully answered using lecture transcripts? Say no to random characters, greetings, single-word non-questions, or completely off-topic requests.',
  },
  is_safe: {
    type: 'noul',
    instructions: 'Is this input free from harmful, abusive, threatening, or sexually explicit content? Say yes if the content is safe for an educational platform.',
  },
};

const GUARD_TIMEOUT_MS = 1500;

/**
 * @typedef {object} GuardResult
 * @property {boolean} allowed - Whether the question should proceed to QA.
 * @property {string|null} reason - Rejection reason code, null when allowed.
 * @property {string|null} userMessage - Friendly message to show the student.
 * @property {object} diagnostics - Raw Jev results for logging.
 */

/**
 * Evaluate whether a question should be allowed through to the LLM pipeline.
 *
 * @param {string} question - The student's question text.
 * @returns {Promise<GuardResult>}
 */
async function evaluateQuestion(question) {
  // ---- Gate check ----
  if (!env.jevEnabled || !env.jevQuestionGuardEnabled || !isJevAvailable()) {
    return {
      allowed: true,
      reason: null,
      userMessage: null,
      diagnostics: { skipped: true, gate: 'disabled' },
    };
  }

  const trimmed = String(question || '').trim();
  if (!trimmed) {
    return {
      allowed: true,
      reason: null,
      userMessage: null,
      diagnostics: { skipped: true, gate: 'empty_question' },
    };
  }

  // ---- Jev evaluation ----
  const response = await evaluate(trimmed, GUARD_QUESTIONS, {
    timeoutMs: GUARD_TIMEOUT_MS,
  });

  // Mock / timeout → fail-open
  if (response.mock) {
    return {
      allowed: true,
      reason: null,
      userMessage: null,
      diagnostics: { skipped: true, gate: 'jev_unavailable', latencyMs: response.latencyMs },
    };
  }

  const meaningful = response.results.is_meaningful || mockNoulResult();
  const safe = response.results.is_safe || mockNoulResult();
  const threshold = env.jevGuardThreshold;

  const diagnostics = {
    is_meaningful: meaningful.value,
    is_safe: safe.value,
    threshold,
    latencyMs: response.latencyMs,
  };

  // Safety check first (stricter)
  if (!safe.mock && safe.value < 0.3) {
    return {
      allowed: false,
      reason: 'unsafe_content',
      userMessage: '你的提問可能包含不適當的內容，請修改後重新提問。',
      diagnostics,
    };
  }

  // Meaningfulness check
  if (!meaningful.mock && meaningful.value < threshold) {
    return {
      allowed: false,
      reason: 'not_meaningful',
      userMessage: '這似乎不是一個關於課程內容的問題。請試著針對課程內容提問，例如：「老師提到的 XX 是什麼意思？」',
      diagnostics,
    };
  }

  return {
    allowed: true,
    reason: null,
    userMessage: null,
    diagnostics,
  };
}

module.exports = {
  evaluateQuestion,
  GUARD_QUESTIONS,
  GUARD_TIMEOUT_MS,
};
