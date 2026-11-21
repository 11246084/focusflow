'use strict';

// Administrator rotation of the whole-site Gemini API key.
//
// Flow: POST test (server-side probe against fixed Google endpoints) → the
// successful result is bound in memory to an HMAC of the exact candidate, the
// configured models and the key version it would replace → POST activate must
// present the same candidate and test id before the store is replaced.
// The candidate is never returned, audited or logged.

const crypto = require('node:crypto');
const AppError = require('../utils/appError');
const { GEMINI_EMBEDDING_2_MODEL, GEMINI_EMBEDDING_DIMENSIONS } = require('./embeddingContract.service');
const { isValidKeyFormat } = require('./geminiKeyStore.service');

const GOOGLE_MODELS_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MODEL_PATTERN = /^gemini-[A-Za-z0-9.-]+$/;
const TEST_ID_PATTERN = /^[0-9a-f-]{36}$/;
const PROBE_INPUT = 'ping';
const PROBE_MAX_OUTPUT_TOKENS = 256;

function createWindowLimiter({ limit, windowMs }) {
  const hits = new Map();
  return {
    consume(key, now) {
      const recent = (hits.get(key) || []).filter((time) => time > now - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      }
      recent.push(now); hits.set(key, recent);
      if (hits.size > 1000) for (const [k, v] of hits) if (!v.some((t) => t > now - windowMs)) hits.delete(k);
      return 0;
    },
    reset() { hits.clear(); },
  };
}

function adminRateLimited(retryAfterSec, action) {
  const error = new AppError('Too many Gemini key operations. Please wait and try again.', 429, 'GEMINI_KEY_ADMIN_RATE_LIMITED');
  error.publicDetails = { retryAfterSec, action };
  return error;
}

function parseRetryDelaySec(result) {
  const header = Number(result.retryAfter);
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  const details = Array.isArray(result.payload?.error?.details) ? result.payload.error.details : [];
  const delay = details.find((item) => /RetryInfo$/.test(String(item?.['@type'] || '')))?.retryDelay;
  const seconds = /^(\d+(?:\.\d+)?)s$/.exec(String(delay || ''));
  return seconds ? Math.max(1, Math.ceil(Number(seconds[1]))) : null;
}

// Map a Google response to a fixed reason. Provider text is never forwarded.
function classifyFailure(result) {
  if (result.failure) return result.failure;
  const reasons = (Array.isArray(result.payload?.error?.details) ? result.payload.error.details : [])
    .map((item) => String(item?.reason || ''));
  if (result.status === 429) return 'rate_limited';
  if (reasons.includes('API_KEY_INVALID') || result.status === 401) return 'key_rejected';
  if (result.status === 403) return 'permission_denied';
  if (result.status === 404) return 'model_unavailable';
  if (result.status === 400) return 'bad_request';
  if (result.status >= 500) return 'provider_error';
  return 'unexpected_status';
}

function probeError(reason, check, model, result = {}) {
  const publicDetails = { check, model, reason };
  let error;
  switch (reason) {
    case 'rate_limited':
      error = new AppError('Google reported rate limiting or exhausted quota for this key.', 429, 'GEMINI_KEY_PROVIDER_RATE_LIMITED');
      publicDetails.retryAfterSec = parseRetryDelaySec(result);
      break;
    case 'key_rejected':
      error = new AppError('Google rejected the candidate API key.', 422, 'GEMINI_KEY_REJECTED'); break;
    case 'permission_denied':
      error = new AppError('The candidate key cannot access the Gemini API.', 422, 'GEMINI_KEY_PERMISSION_DENIED'); break;
    case 'model_unavailable':
      error = new AppError('The candidate key cannot use a configured model.', 422, 'GEMINI_KEY_MODEL_UNAVAILABLE'); break;
    case 'dimension_mismatch':
    case 'invalid_response':
      error = new AppError('The provider returned an unexpected probe response.', 422, 'GEMINI_KEY_PROBE_INVALID_RESPONSE'); break;
    default:
      error = new AppError('The Gemini probe could not be completed.', 502, 'GEMINI_KEY_PROBE_UNAVAILABLE');
  }
  error.publicDetails = publicDetails;
  return error;
}

function createGeminiKeyRotation({
  store = require('./geminiKeyStore.service').geminiKeyStore,
  envModule = require('../config/env'),
  getSetting = (key) => require('./recutSettings.service').getSetting(key),
  fetchImpl = (...args) => global.fetch(...args),
  auditImpl = (...args) => require('./adminAudit.service').audit(...args),
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  probeTimeoutMs = 15000,
  testTtlMs = 10 * 60 * 1000,
  limits = { testPerAdmin: 5, testGlobal: 15, activatePerAdmin: 5, windowMs: 10 * 60 * 1000 },
} = {}) {
  const digestSecret = crypto.randomBytes(32);
  const digest = (value) => crypto.createHmac('sha256', digestSecret).update(value, 'utf8').digest();
  const pendingTests = new Map();
  const testAdminLimiter = createWindowLimiter({ limit: limits.testPerAdmin, windowMs: limits.windowMs });
  const testGlobalLimiter = createWindowLimiter({ limit: limits.testGlobal, windowMs: limits.windowMs });
  const activateLimiter = createWindowLimiter({ limit: limits.activatePerAdmin, windowMs: limits.windowMs });
  let busy = false;

  function configuredModels() {
    const generation = new Set([String(envModule.geminiChatModel || '').trim()]);
    if (envModule.shortScriptAutomationEnabled) {
      const recut = getSetting('recut.geminiModel');
      if (recut?.provider === 'gemini') generation.add(String(recut.model || '').trim());
    }
    const list = [...generation].sort();
    if (!list.length || list.some((model) => !MODEL_PATTERN.test(model))) {
      throw new AppError('A configured Gemini model name is invalid.', 500, 'GEMINI_MODEL_CONFIG_INVALID');
    }
    return { embedding: GEMINI_EMBEDDING_2_MODEL, embeddingDimensions: GEMINI_EMBEDDING_DIMENSIONS, generation: list };
  }
  const signatureOf = (models) => JSON.stringify([models.embedding, models.embeddingDimensions, models.generation]);

  async function callGoogle(model, method, apiKey, body) {
    let response;
    try {
      response = await fetchImpl(`${GOOGLE_MODELS_BASE}${encodeURIComponent(model)}:${method}`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(probeTimeoutMs),
      });
    } catch (error) {
      return { failure: ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'unreachable' };
    }
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { status: response.status, ok: response.ok, payload, retryAfter: response.headers?.get?.('retry-after') ?? null };
  }

  // Sequential, minimal-input probes; the first failure stops further calls.
  async function probe(apiKey, models) {
    const checks = [];
    const embedding = await callGoogle(models.embedding, 'embedContent', apiKey, {
      model: `models/${models.embedding}`,
      content: { parts: [{ text: PROBE_INPUT }] },
      output_dimensionality: models.embeddingDimensions,
    });
    if (!embedding.ok) throw probeError(classifyFailure(embedding), 'embedding', models.embedding, embedding);
    const values = embedding.payload?.embedding?.values;
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw probeError('invalid_response', 'embedding', models.embedding);
    }
    if (values.length !== models.embeddingDimensions) throw probeError('dimension_mismatch', 'embedding', models.embedding);
    checks.push({ check: 'embedding', model: models.embedding, ok: true, dimensions: values.length });
    for (const model of models.generation) {
      const generation = await callGoogle(model, 'generateContent', apiKey, {
        contents: [{ role: 'user', parts: [{ text: PROBE_INPUT }] }],
        generationConfig: { maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS },
      });
      if (!generation.ok) throw probeError(classifyFailure(generation), 'generation', model, generation);
      const parts = generation.payload?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts) || !parts.some((part) => !part?.thought && typeof part?.text === 'string' && part.text.trim())) {
        throw probeError('invalid_response', 'generation', model);
      }
      checks.push({ check: 'generation', model, ok: true });
    }
    return checks;
  }

  async function safeAudit(userId, event, result, reason) {
    try { await auditImpl(userId, event, result, reason); }
    catch { console.error(`[gemini-key] audit write failed event=${event} result=${result}`); }
  }

  function readCandidate(value) {
    const candidate = typeof value === 'string' ? value.trim() : '';
    if (!isValidKeyFormat(candidate)) throw new AppError('Gemini API key format is invalid.', 400, 'GEMINI_KEY_FORMAT_INVALID');
    return candidate;
  }

  function assertRotationAvailable() {
    const status = store.getStatus();
    if (!store.isInitialized()) throw new AppError('Gemini key rotation is not enabled in this process.', 503, 'GEMINI_KEY_ROTATION_UNAVAILABLE');
    if (!status.rotationAvailable) {
      const error = new AppError('Gemini key storage is unavailable.', 503, 'GEMINI_KEY_ROTATION_UNAVAILABLE');
      error.publicDetails = { storageError: status.storageError };
      throw error;
    }
  }

  async function exclusive(task) {
    if (busy) throw new AppError('Another Gemini key operation is in progress.', 409, 'GEMINI_KEY_OPERATION_IN_PROGRESS');
    busy = true;
    try { return await task(); } finally { busy = false; }
  }

  function pruneExpired(at) {
    for (const [admin, entry] of pendingTests) if (entry.expiresAt <= at) pendingTests.delete(admin);
  }

  function getStatus(adminId) {
    const status = store.getStatus();
    let models = null; let modelsError = null;
    try { models = configuredModels(); } catch (error) { modelsError = error.code; }
    pruneExpired(now());
    const pending = adminId ? pendingTests.get(String(adminId)) : null;
    return {
      source: status.source,
      activatedAt: status.activatedAt,
      persistence: status.persistence,
      rotationAvailable: status.rotationAvailable,
      storageError: status.storageError,
      models,
      modelsError,
      pendingTest: pending ? { testId: pending.testId, expiresAt: new Date(pending.expiresAt).toISOString() } : null,
    };
  }

  async function testCandidate({ adminId, apiKey }) {
    const admin = String(adminId);
    const candidate = readCandidate(apiKey);
    assertRotationAvailable();
    const at = now();
    const adminWait = testAdminLimiter.consume(admin, at);
    if (adminWait) throw adminRateLimited(adminWait, 'test');
    const globalWait = testGlobalLimiter.consume('global', at);
    if (globalWait) throw adminRateLimited(globalWait, 'test');
    return exclusive(async () => {
      const models = configuredModels();
      const baseVersion = store.currentVersion();
      pendingTests.delete(admin);
      let checks;
      try { checks = await probe(candidate, models); }
      catch (error) {
        await safeAudit(adminId, 'gemini_key_test', 'failure', error.publicDetails?.reason || 'error');
        throw error;
      }
      const testId = randomUUID();
      const expiresAt = now() + testTtlMs;
      pendingTests.set(admin, { testId, digest: digest(candidate), signature: signatureOf(models), baseVersion, expiresAt });
      await safeAudit(adminId, 'gemini_key_test', 'success', null);
      return { testId, expiresAt: new Date(expiresAt).toISOString(), checks };
    });
  }

  async function activateCandidate({ adminId, apiKey, testId }) {
    const admin = String(adminId);
    const candidate = readCandidate(apiKey);
    if (typeof testId !== 'string' || !TEST_ID_PATTERN.test(testId)) {
      throw new AppError('A successful test is required before activation.', 409, 'GEMINI_KEY_TEST_REQUIRED');
    }
    assertRotationAvailable();
    const wait = activateLimiter.consume(admin, now());
    if (wait) throw adminRateLimited(wait, 'activate');
    return exclusive(async () => {
      pruneExpired(now());
      const pending = pendingTests.get(admin);
      const fail = async (code, message, reason) => {
        await safeAudit(adminId, 'gemini_key_activate', 'failure', reason);
        throw new AppError(message, 409, code);
      };
      if (!pending || pending.testId !== testId) return fail('GEMINI_KEY_TEST_REQUIRED', 'A successful test is required before activation.', 'test_required');
      if (!crypto.timingSafeEqual(pending.digest, digest(candidate))) {
        return fail('GEMINI_KEY_TEST_MISMATCH', 'The key differs from the tested key.', 'test_mismatch');
      }
      let models;
      try { models = configuredModels(); } catch (error) { pendingTests.delete(admin); throw error; }
      if (pending.signature !== signatureOf(models)) {
        pendingTests.delete(admin);
        return fail('GEMINI_KEY_TEST_STALE', 'Configured models changed after the test.', 'test_stale');
      }
      if (pending.baseVersion !== store.currentVersion()) {
        pendingTests.delete(admin);
        return fail('GEMINI_KEY_CHANGED_CONCURRENTLY', 'The site key changed after the test.', 'changed_concurrently');
      }
      pendingTests.delete(admin); // single use, consumed before the write
      let result;
      try { result = await store.activate(candidate); }
      catch (error) {
        await safeAudit(adminId, 'gemini_key_activate', 'failure', 'storage_failed');
        throw error instanceof AppError ? error : new AppError('Gemini key storage is unavailable.', 500, 'GEMINI_KEY_STORAGE_FAILED');
      }
      await safeAudit(adminId, 'gemini_key_activate', 'success', `version:${result.versionId}`);
      const status = store.getStatus();
      return { source: status.source, activatedAt: result.activatedAt, persistence: status.persistence };
    });
  }

  return {
    getStatus,
    testCandidate,
    activateCandidate,
    configuredModels,
    resetForTests() {
      pendingTests.clear(); testAdminLimiter.reset(); testGlobalLimiter.reset(); activateLimiter.reset(); busy = false;
    },
  };
}

const geminiKeyRotation = createGeminiKeyRotation();

module.exports = { createGeminiKeyRotation, geminiKeyRotation, classifyFailure, GOOGLE_MODELS_BASE, PROBE_MAX_OUTPUT_TOKENS };
