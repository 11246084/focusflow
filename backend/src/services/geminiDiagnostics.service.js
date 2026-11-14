'use strict';

// Gemini 呼叫失敗的原因分類：只看 HTTP 狀態、錯誤狀態與 details 的型別欄位，不回傳金鑰、請求內容或完整錯誤原文。
// 用於維運診斷（src/scripts/diagnoseGemini.js），不在產片流程裡呼叫。

const GUIDANCE = {
  OK: '金鑰與模型可用。',
  SPEND_CAP_REACHED: '專案已達每月花費上限：到 AI Studio 的花費設定（ai.studio/spend）調高上限，或等下個月重置。這不是程式問題，重試也不會成功。',
  RATE_LIMITED: '短時間內請求太多（每分鐘或每日次數）：稍後再試；長期不足時到 Google Cloud 申請提高配額。',
  FREE_TIER_QUOTA: '金鑰所屬專案用的是免費額度且已用完：在 AI Studio 為專案啟用付費方案。',
  QUOTA_EXHAUSTED: '配額用完，但回應沒有說明是哪一種：到 AI Studio 的用量與配額頁確認。',
  API_KEY_INVALID: '金鑰無效或已被撤銷：在 AI Studio 重新建立金鑰並更新 VM 的環境設定。',
  PERMISSION_DENIED: '金鑰沒有權限（API 未啟用、專案被停用或金鑰有使用限制）：到 Google Cloud 確認 Generative Language API 已啟用、金鑰限制允許這台主機。',
  BILLING_REQUIRED: '專案沒有可用的帳單帳戶：到 Google Cloud 連結帳單帳戶。',
  MODEL_NOT_FOUND: '模型名稱不存在或這把金鑰不能用：改用 AI Studio 列出的可用模型，並同步更新 runtime JSON 的 allowedGeminiModels。',
  BAD_REQUEST: '請求格式被拒（通常是模型不支援某個參數）：檢查 thinkingLevel、responseSchema 與模型是否相容。',
  PROVIDER_UNAVAILABLE: 'Gemini 服務暫時異常：稍後再試，持續發生時看 Google 的服務狀態頁。',
  NETWORK_ERROR: '連不到 Gemini：檢查主機對 generativelanguage.googleapis.com 的連線、DNS 與防火牆。',
  KEY_MISSING: '環境變數沒有金鑰：在 VM 的環境設定加上金鑰，並確認 runtime JSON 的 geminiApiKeyEnv 指向同一個名稱。',
  UNKNOWN: '無法判斷原因：保留 HTTP 狀態與錯誤代碼，交給負責人到 AI Studio 檢查。',
};

function detailTypes(error) {
  return (Array.isArray(error?.details) ? error.details : []).map((detail) => String(detail?.['@type'] || ''));
}

// 從 QuotaFailure 取出配額名稱（例如 GenerateRequestsPerMinutePerProjectPerModel-FreeTier），只留名稱不含數值。
function quotaIds(error) {
  const ids = [];
  for (const detail of Array.isArray(error?.details) ? error.details : []) {
    for (const violation of Array.isArray(detail?.violations) ? detail.violations : []) {
      for (const key of ['quotaId', 'quotaMetric']) if (typeof violation?.[key] === 'string') ids.push(violation[key]);
    }
  }
  return ids;
}

function retryDelay(error) {
  const info = (Array.isArray(error?.details) ? error.details : []).find((detail) => String(detail?.['@type'] || '').endsWith('RetryInfo'));
  return typeof info?.retryDelay === 'string' ? info.retryDelay : null;
}

// 回傳 { category, httpStatus, errorStatus, quotaIds, retryDelay, guidance }。
function classifyGeminiResponse({ httpStatus, body, networkError = false } = {}) {
  const base = (category, extra = {}) => ({ category, httpStatus: httpStatus ?? null, errorStatus: body?.error?.status || null,
    quotaIds: [], retryDelay: null, ...extra, guidance: GUIDANCE[category] });
  if (networkError) return base('NETWORK_ERROR');
  if (httpStatus >= 200 && httpStatus < 300) return base('OK');
  const error = body?.error || {};
  const message = String(error.message || '');
  const reasons = (Array.isArray(error.details) ? error.details : []).map((detail) => String(detail?.reason || ''));
  const quotas = quotaIds(error);
  const delay = retryDelay(error);
  if (httpStatus === 429 || error.status === 'RESOURCE_EXHAUSTED') {
    if (/spending cap|spend cap/i.test(message)) return base('SPEND_CAP_REACHED');
    if (quotas.some((id) => /free.?tier/i.test(id))) return base('FREE_TIER_QUOTA', { quotaIds: quotas, retryDelay: delay });
    if (quotas.some((id) => /per(minute|day|second)/i.test(id)) || delay) return base('RATE_LIMITED', { quotaIds: quotas, retryDelay: delay });
    return base('QUOTA_EXHAUSTED', { quotaIds: quotas, retryDelay: delay });
  }
  if (reasons.includes('API_KEY_INVALID') || /api key not valid|api_key_invalid/i.test(message)) return base('API_KEY_INVALID');
  if (/billing/i.test(message) || reasons.some((reason) => /BILLING/.test(reason))) return base('BILLING_REQUIRED');
  if (httpStatus === 403 || error.status === 'PERMISSION_DENIED') return base('PERMISSION_DENIED');
  if (httpStatus === 404 || error.status === 'NOT_FOUND') return base('MODEL_NOT_FOUND');
  if (httpStatus === 400) return base('BAD_REQUEST');
  if (httpStatus >= 500) return base('PROVIDER_UNAVAILABLE');
  return base('UNKNOWN', { errorTypes: detailTypes(error) });
}

module.exports = { classifyGeminiResponse, GUIDANCE };
