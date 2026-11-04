// 呼叫外部模型 API（Gemini 等）時的逾時與暫時性錯誤重試。
// 只重試「再試一次可能成功」的狀況：連線失敗、逾時、408、429、5xx；
// 400、401、403 這類請求本身的問題直接回傳，讓呼叫端照原本方式處理。
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

async function wait(ms, signal) {
  signal?.throwIfAborted();
  if (ms <= 0) return;
  let timer, onAbort;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(resolve, ms);
      onAbort = () => reject(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// 不用 AbortSignal.timeout：它的計時器不會讓 event loop 保持運作，
// 沒有其他工作時 Node 會在逾時觸發前就結束，等待中的請求永遠不會被中止。
function startTimeout(timeoutMs, parentSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  }, timeoutMs);
  return { controller, signal: parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal, timer };
}

// signal 也涵蓋讀取回應內容，呼叫端讀 body 時一樣受逾時限制。
async function fetchWithRetry(url, options, { timeoutMs, retries = 0, retryDelayMs = 0 }) {
  for (let attempt = 0; ; attempt += 1) {
    const parentSignal = options?.signal;
    parentSignal?.throwIfAborted();
    const isLastAttempt = attempt >= retries;
    const { controller, signal, timer } = startTimeout(timeoutMs, parentSignal);
    let returnedResponse = false;
    try {
      const response = await fetch(url, { ...options, signal });
      if (isLastAttempt || !RETRYABLE_STATUS.has(response.status)) {
        // 拿到回應後計時器繼續限制讀取 body，但不再讓 process 為它多等。
        returnedResponse = true;
        timer.unref();
        return response;
      }
    } catch (error) {
      if (parentSignal?.aborted) throw parentSignal.reason;
      if (isLastAttempt) throw error;
    } finally {
      if (!returnedResponse) {
        // Abort the discarded transport before removing its deadline. Do not
        // await body.cancel(): custom/locked bodies can reject or never settle.
        controller.abort();
        clearTimeout(timer);
      }
    }
    await wait(retryDelayMs * (attempt + 1), parentSignal);
  }
}

module.exports = { fetchWithRetry, RETRYABLE_STATUS };
