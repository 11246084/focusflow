const env = require('../config/env');
const { isJevAvailable, evaluate, mockChoiceResult } = require('./jevClient');

// ---------------------------------------------------------------------------
// lineIntentClassifier.service.js — LINE Bot 訊息意圖分類
//
// 用 Jev 的 Choice primitive 取代 line.service.js 裡的 regex 比對，
// 將使用者的 LINE 文字訊息分類為以下意圖：
//
//   question      — 課程相關提問（送進 QA pipeline）
//   switch_course — 要求切換目前的活動課程
//   greeting      — 打招呼、閒聊
//   off_topic     — 與教育平台完全無關的內容
//
// 注意：綁定碼（64 hex）和 COURSE:{id} 的判斷仍然保留在 line.service.js 用
// regex 處理，因為那些是結構化格式，不需要語意理解。
//
// 設計原則：
//   - Jev 高信心時直接使用分類結果；低信心時 fallback 回原始邏輯。
//   - 任何 Jev 失敗一律 fallback，不影響 LINE Bot 正常運作。
//   - Feature-gated：需 JEV_ENABLED=true + JEV_LINE_INTENT_ENABLED=true。
// ---------------------------------------------------------------------------

const INTENT_OPTIONS = {
  question: 'A question about course or lecture content that should be answered by the AI teaching assistant',
  switch_course: 'A request to switch, change, or select a different course (e.g. "切換課程", "換課", "我想問其他課")',
  greeting: 'A casual greeting, thanks, or simple social interaction (e.g. "你好", "謝謝", "hi")',
  off_topic: 'Content completely unrelated to the educational platform or any course',
};

const INTENT_INSTRUCTIONS = 'Classify this message from a student on an educational video Q&A platform. The student can ask questions about course content, request to switch courses, send greetings, or send off-topic messages.';

const INTENT_LABELS = Object.keys(INTENT_OPTIONS);
const INTENT_TIMEOUT_MS = 1500;

/**
 * @typedef {object} IntentResult
 * @property {string} intent - One of: question, switch_course, greeting, off_topic
 * @property {number} confidence - 0–1 confidence score
 * @property {boolean} usedJev - Whether Jev was used (vs. fallback)
 * @property {object} diagnostics
 */

/**
 * Classify a LINE text message into an intent category.
 *
 * This function only classifies "free text" messages. Structured inputs
 * (bind tokens, COURSE: links, BIND: links) must be handled upstream
 * in line.service.js before calling this classifier.
 *
 * @param {string} text - The normalized message text from LINE.
 * @returns {Promise<IntentResult>}
 */
async function classifyIntent(text) {
  const trimmed = String(text || '').trim();

  // ---- Gate check ----
  if (!env.jevEnabled || !env.jevLineIntentEnabled || !isJevAvailable()) {
    return fallbackClassify(trimmed, 'disabled');
  }

  if (!trimmed) {
    return {
      intent: 'off_topic',
      confidence: 1,
      usedJev: false,
      diagnostics: { gate: 'empty_text' },
    };
  }

  // ---- Jev evaluation ----
  const response = await evaluate(trimmed, {
    intent: {
      type: 'choice',
      instructions: INTENT_INSTRUCTIONS,
      options: INTENT_OPTIONS,
      defaultLabel: 'question',
    },
  }, { timeoutMs: INTENT_TIMEOUT_MS });

  // Mock / timeout → fallback
  if (response.mock) {
    return fallbackClassify(trimmed, 'jev_unavailable');
  }

  const result = response.results.intent;
  if (!result || result.mock) {
    return fallbackClassify(trimmed, 'jev_parse_error');
  }

  const threshold = env.jevIntentThreshold;

  // Low confidence → fall back to regex-based classification
  if (result.confidence < threshold) {
    return fallbackClassify(trimmed, 'low_confidence', {
      jevLabel: result.label,
      jevConfidence: result.confidence,
      threshold,
      latencyMs: response.latencyMs,
    });
  }

  // Validate label
  const intent = INTENT_LABELS.includes(result.label) ? result.label : 'question';

  return {
    intent,
    confidence: result.confidence,
    usedJev: true,
    diagnostics: {
      label: result.label,
      confidence: result.confidence,
      threshold,
      latencyMs: response.latencyMs,
    },
  };
}

/**
 * Regex-based fallback that mirrors the existing line.service.js logic.
 * This is what runs when Jev is disabled or returns low-confidence results.
 */
function fallbackClassify(text, reason, jevDiagnostics = null) {
  const normalized = text.toLowerCase().trim();

  // 「切換課程」及常見變體
  if (/^(切換課程|換課|換一門課|我要換課|更換課程|選課|選擇課程)$/.test(normalized)) {
    return {
      intent: 'switch_course',
      confidence: 1,
      usedJev: false,
      diagnostics: { gate: reason, method: 'regex', ...(jevDiagnostics || {}) },
    };
  }

  // 簡短問候
  if (/^(你好|哈囉|嗨|hi|hello|hey|早安|午安|晚安|謝謝|感謝|thanks?|thank you|掰掰|bye)$/i.test(normalized)) {
    return {
      intent: 'greeting',
      confidence: 0.9,
      usedJev: false,
      diagnostics: { gate: reason, method: 'regex', ...(jevDiagnostics || {}) },
    };
  }

  // 預設：視為課程提問（與 line.service.js 目前的 fallthrough 行為一致）
  return {
    intent: 'question',
    confidence: 0.5,
    usedJev: false,
    diagnostics: { gate: reason, method: 'default', ...(jevDiagnostics || {}) },
  };
}

module.exports = {
  classifyIntent,
  fallbackClassify,
  INTENT_OPTIONS,
  INTENT_LABELS,
  INTENT_TIMEOUT_MS,
};
