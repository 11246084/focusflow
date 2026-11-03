// 呼叫外部模型 API（Gemini 等）時的逾時與暫時性錯誤重試。
// 只重試「再試一次可能成功」的狀況：連線失敗、逾時、408、429、5xx；
// 400、401、403 這類請求本身的問題直接回傳，讓呼叫端照原本方式處理。
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function wait(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// signal 也涵蓋讀取回應內容，呼叫端讀 body 時一樣受逾時限制。
async function fetchWithRetry(url, options, { timeoutMs, retries = 0, retryDelayMs = 0 }) {
  for (let attempt = 0; ; attempt += 1) {
    const isLastAttempt = attempt >= retries;
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (isLastAttempt || !RETRYABLE_STATUS.has(response.status)) return response;
    } catch (error) {
      if (isLastAttempt) throw error;
    }
    await wait(retryDelayMs * (attempt + 1));
  }
}

module.exports = { fetchWithRetry, RETRYABLE_STATUS };
