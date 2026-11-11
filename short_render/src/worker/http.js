'use strict';

const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { SHORT_RENDER_VERSION, ASSET_VERSIONS } = require('../plan/runtime');
const ROOT = '/api/v1/recut-worker/jobs';
function workerError(code, status) {
  return Object.assign(new Error(code), { code, status });
}
function safeJobId(id) {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/.test(id)) throw workerError('RECUT_JOB_INVALID');
  return id;
}
function untilAborted(work, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(workerError('RECUT_REQUEST_TIMEOUT_OR_CANCELLED'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
function createHttpClient({ backendUrl, getWorkerKey, fetchImpl = globalThis.fetch, requestTimeoutMs = 120000,
  maxDownloadBytes = 4 * 1024 ** 3, maxUploadBytes = 512 * 1024 ** 2 }) {
  const base = new URL(backendUrl);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/'
    || !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
    throw workerError('RECUT_BACKEND_URL_INVALID');
  }
  if (typeof getWorkerKey !== 'function') throw workerError('RECUT_WORKER_KEY_PROVIDER_REQUIRED');
  if (![requestTimeoutMs, maxDownloadBytes, maxUploadBytes].every((v) => Number.isSafeInteger(v) && v > 0)) throw workerError('RECUT_CONFIG_INVALID');
  async function request(route, { method = 'POST', job, json, form, signal, consume } = {}) {
    // Every URL is constructed locally. Never use a target or filename from a job/HTTP response.
    const url = new URL(`${ROOT}${route}`, base);
    const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]) : AbortSignal.timeout(requestTimeoutMs);
    bounded.throwIfAborted();
    const key = await untilAborted(getWorkerKey(), bounded);
    if (typeof key !== 'string' || !/^rw_[a-f\d]{24}\.[A-Za-z\d_-]{43}$/.test(key)) throw workerError('RECUT_WORKER_KEY_INVALID');
    const headers = { Authorization: `Bearer ${key}`, ...(job ? { 'X-Recut-Lease': job.leaseToken } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}) };
    let response;
    try { response = await fetchImpl(url.href, { method, headers, redirect: 'error', credentials: 'omit',
      body: form || (json ? JSON.stringify(json) : undefined), signal: bounded }); }
    catch { throw workerError(bounded.aborted ? 'RECUT_REQUEST_TIMEOUT_OR_CANCELLED' : 'RECUT_NETWORK_ERROR'); }
    if (!response.ok) {
      // Never propagate upstream text; it may contain a token, path or stack trace.
      let body; try { body = await untilAborted(response.json(), bounded); } catch { /* generic HTTP error */ }
      const code = /^RECUT_[A-Z_]{1,70}$/.test(body?.error?.code || '') ? body.error.code : 'RECUT_HTTP_ERROR';
      throw workerError(code, response.status);
    }
    if (consume) return consume(response, bounded);
    const body = await untilAborted(response.json(), bounded);
    if (body?.success !== true) throw workerError('RECUT_RESPONSE_INVALID');
    return body.data;
  }
  const endpoint = (job, action) => `/${safeJobId(job.jobId)}/${action}`;
  return {
    claim: (signal) => request('/claim', { json: { shortRenderVersion: SHORT_RENDER_VERSION, assetVersions: { ...ASSET_VERSIONS } }, signal }),
    heartbeat: (job, signal) => request(endpoint(job, 'heartbeat'), { job, json: {}, signal }),
    fail: (job, data, signal) => request(endpoint(job, 'failure'), { job, json: data, signal }),
    download: (job, destination, signal) => request(endpoint(job, 'source'), { method: 'GET', job, signal,
      consume: async (response, bounded) => {
        const type = response.headers.get('content-type')?.split(';')[0];
        const length = Number(response.headers.get('content-length'));
        if (!['video/mp4', 'application/octet-stream'].includes(type) || length > maxDownloadBytes || !response.body) throw workerError('RECUT_SOURCE_INVALID');
        let bytes = 0;
        const limiter = new Transform({ transform(chunk, encoding, next) {
          bytes += chunk.length; next(bytes > maxDownloadBytes ? workerError('RECUT_SOURCE_TOO_LARGE') : null, chunk);
        } });
        await pipeline(response.body, limiter, fs.createWriteStream(destination, { flags: 'wx' }), { signal: bounded });
        if (!bytes) throw workerError('RECUT_SOURCE_INVALID');
      } }),
    upload: async (job, filePath, metadata, signal) => {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > maxUploadBytes) throw workerError('RECUT_RESULT_INVALID');
      const form = new FormData();
      form.set('video', await fs.openAsBlob(filePath, { type: 'video/mp4' }), 'result.mp4');
      form.set('metadata', JSON.stringify(metadata));
      // Deliberately no retry: a lost response can follow an accepted commit.
      return request(endpoint(job, 'result'), { job, form, signal });
    },
  };
}
module.exports = { createHttpClient, safeJobId, workerError };
