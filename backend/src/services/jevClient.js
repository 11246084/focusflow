const env = require('../config/env');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Jev (TypeSafe AI) 共用 Client
//
// 封裝 @typesafe-ai/sdk 的三個 primitive（Noul / Choice / Score），
// 並加上：
//   1. Feature gate：env.jevEnabled + typesafeApiKey 同時具備才真正呼叫。
//   2. Mock mode：無 API key 或 disabled 時回傳預設 passthrough 結果。
//   3. Timeout / error 吞處理：任何 Jev 呼叫失敗都不可中斷主流程。
//
// 設計原則：Jev 在 FocusFlow 裡只做「建議性判斷」而非「阻斷性驗證」；
// 即使 Jev 全掛了，系統仍如同 Jev 不存在一般正常運作。
// ---------------------------------------------------------------------------

// 延遲初始化，避免在 SDK 未安裝時 require 就爆炸
let _sdkModule = null;
let _clientInstance = null;

function loadSdk() {
  if (_sdkModule) return _sdkModule;
  try {
    _sdkModule = require('@typesafe-ai/sdk');
  } catch {
    _sdkModule = null;
  }
  return _sdkModule;
}

function getClient() {
  if (_clientInstance) return _clientInstance;
  const sdk = loadSdk();
  if (!sdk || !env.typesafeApiKey) return null;
  _clientInstance = new sdk.TypeSafeClient({ apiKey: env.typesafeApiKey });
  return _clientInstance;
}

function isJevAvailable() {
  return Boolean(env.jevEnabled && env.typesafeApiKey && loadSdk());
}

// ---------------------------------------------------------------------------
// Mock results — used when Jev is unavailable or disabled.
// All mocks default to "allow" / "pass" so they never block the user.
// ---------------------------------------------------------------------------

function mockNoulResult(value = 0.5) {
  return { value, mock: true };
}

function mockChoiceResult(label, confidence = 0.5) {
  return { label, confidence, mock: true };
}

function mockScoreResult(level, score = 0.5) {
  return { level, score, mock: true };
}

// ---------------------------------------------------------------------------
// Core API wrappers
// ---------------------------------------------------------------------------

/**
 * Execute a Jev System One call with multiple questions in parallel.
 *
 * @param {string} state - The input text/state for Jev to evaluate
 * @param {Record<string, object>} questions - Map of question key → primitive config
 * @param {object} [options]
 * @param {number} [options.timeoutMs=2000] - Max wait before falling back
 * @returns {Promise<{ results: Record<string, any>, mock: boolean, latencyMs: number }>}
 */
async function evaluate(state, questions, { timeoutMs = 2000 } = {}) {
  if (!isJevAvailable()) {
    return { results: {}, mock: true, latencyMs: 0 };
  }

  const client = getClient();
  if (!client) {
    return { results: {}, mock: true, latencyMs: 0 };
  }

  const sdk = loadSdk();
  const startedAt = Date.now();

  // Build SDK question objects
  const sdkQuestions = {};
  for (const [key, config] of Object.entries(questions)) {
    if (config.type === 'noul') {
      sdkQuestions[key] = new sdk.Noul({ instructions: config.instructions });
    } else if (config.type === 'choice') {
      sdkQuestions[key] = new sdk.Choice({
        instructions: config.instructions,
        options: config.options,
      });
    } else if (config.type === 'score') {
      sdkQuestions[key] = new sdk.Score({
        instructions: config.instructions,
        levels: config.levels,
      });
    }
  }

  try {
    const response = await Promise.race([
      client.system_one({ state, questions: sdkQuestions }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('Jev evaluation timed out')),
        timeoutMs,
      )),
    ]);

    const results = {};
    for (const key of Object.keys(questions)) {
      const config = questions[key];
      try {
        if (config.type === 'noul') {
          results[key] = { value: response.noul_value(key), mock: false };
        } else if (config.type === 'choice') {
          const choice = response.choice(key);
          results[key] = {
            label: response.choice_value(key),
            confidence: choice?.confidence ?? 0,
            mock: false,
          };
        } else if (config.type === 'score') {
          results[key] = {
            level: response.score_value(key),
            score: response.score(key)?.value ?? 0,
            mock: false,
          };
        }
      } catch {
        // Individual question extraction failure — use mock for this key
        if (config.type === 'noul') results[key] = mockNoulResult();
        else if (config.type === 'choice') results[key] = mockChoiceResult(config.defaultLabel || 'unknown');
        else if (config.type === 'score') results[key] = mockScoreResult(config.defaultLevel || 'unknown');
      }
    }

    return { results, mock: false, latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (env.nodeEnv !== 'test') {
      logger.warn('jev.evaluate_failed', {
        message: error?.message,
        questionKeys: Object.keys(questions),
      });
    }
    return { results: {}, mock: true, latencyMs: Date.now() - startedAt };
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Single Noul (yes/no) question.
 * @returns {Promise<{ value: number, mock: boolean }>}
 */
async function noul(state, instructions, options = {}) {
  const response = await evaluate(state, {
    q: { type: 'noul', instructions },
  }, options);

  return response.results.q || mockNoulResult();
}

/**
 * Single Choice (classification) question.
 * @returns {Promise<{ label: string, confidence: number, mock: boolean }>}
 */
async function choice(state, instructions, choiceOptions, options = {}) {
  const response = await evaluate(state, {
    q: { type: 'choice', instructions, options: choiceOptions, defaultLabel: 'unknown' },
  }, options);

  return response.results.q || mockChoiceResult('unknown');
}

/**
 * Single Score (rubric) question.
 * @returns {Promise<{ level: string, score: number, mock: boolean }>}
 */
async function score(state, instructions, levels, options = {}) {
  const response = await evaluate(state, {
    q: { type: 'score', instructions, levels, defaultLevel: levels[0] || 'unknown' },
  }, options);

  return response.results.q || mockScoreResult(levels[0] || 'unknown');
}

// ---------------------------------------------------------------------------
// Testing support
// ---------------------------------------------------------------------------

/** Reset the cached client instance (for test isolation). */
function _resetClient() {
  _clientInstance = null;
  _sdkModule = null;
}

module.exports = {
  isJevAvailable,
  evaluate,
  noul,
  choice,
  score,
  mockNoulResult,
  mockChoiceResult,
  mockScoreResult,
  _resetClient,
};
