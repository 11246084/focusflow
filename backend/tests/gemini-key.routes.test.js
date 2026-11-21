'use strict';
const assert = require('node:assert/strict');
const { describe, it, before, after, beforeEach } = require('node:test');
const yaml = require('js-yaml');
const { env, resetStore, store, startServer, stopServer, jsonRequest, loginAs } = require('./helpers/backendTestHarness');
const cookie = require('../src/utils/authCookies');
const mailer = require('../src/services/mailer.service');
const { geminiKeyStore } = require('../src/services/geminiKeyStore.service');
const { geminiKeyRotation } = require('../src/services/geminiKeyRotation.service');
const { readOpenApiYaml } = require('../src/docs/openapi');

const CANDIDATE = 'AIzaRouteCandidateKey_0123456789abcdef';
const ENV_KEY = 'route-environment-key-00000000000';

describe('/api/v1/admin/gemini-key', () => {
  let server; let googleCalls; let googlePlan;
  const origin = 'http://localhost:5173';
  const browser = { Origin: origin, 'X-Requested-With': 'FocusFlow' };
  const request = (path, options) => jsonRequest(server.baseUrl, `/api/v1${path}`, options);
  const cookieFor = (result, kind) => result.response.headers.getSetCookie()
    .find((value) => value.startsWith(`${cookie.cookieName(kind)}=`) && value.split(';')[0] !== `${cookie.cookieName(kind)}=`)?.split(';')[0];
  const credentials = { admin: ['admin@focusflow.local', 'Admin123!'], student: ['student@focusflow.local', 'Student123!'], teacher: ['teacher@focusflow.local', 'Teacher123!'] };
  async function sessionCookie(role = 'admin') {
    const [email, password] = credentials[role];
    const result = await request('/auth/session', { method: 'POST', headers: browser, body: { email, password, role } });
    assert.equal(result.status, 200);
    return cookieFor(result, 'session');
  }
  async function steppedUp() {
    const session = await sessionCookie('admin');
    const step = await request('/auth/step-up', { method: 'POST', headers: { ...browser, Cookie: session }, body: { password: 'Admin123!' } });
    assert.equal(step.status, 204);
    return { ...browser, Cookie: `${session}; ${cookieFor(step, 'stepup')}` };
  }

  const originalFetch = global.fetch;
  let previousConfig;
  before(async () => {
    previousConfig = Object.fromEntries(['geminiApiKey', 'adminEmail2faEnabled', 'emailVerificationEnabled', 'nodeEnv'].map((key) => [key, env[key]]));
    server = await startServer();
  });
  beforeEach((t) => {
    t.mock.method(global, 'fetch', async (url, options) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(url, options);
      googleCalls.push({ url: String(url), key: options.headers['x-goog-api-key'] });
      const kind = String(url).endsWith(':embedContent') ? 'embedding' : 'generation';
      const step = googlePlan[kind] || { status: 200, body: kind === 'embedding'
        ? { embedding: { values: Array.from({ length: 3072 }, () => 0.01) } } : { candidates: [{ content: { parts: [{ text: 'pong' }] } }] } };
      return new Response(JSON.stringify(step.body), { status: step.status, headers: { 'Content-Type': 'application/json', ...(step.headers || {}) } });
    });
  });
  after(async () => {
    global.fetch = originalFetch; geminiKeyStore.resetForTests(); Object.assign(env, previousConfig);
    mailer.setTransportForTests(null);
    await stopServer(server.server);
  });
  beforeEach(async () => {
    resetStore(); env.nodeEnv = 'test'; env.adminEmail2faEnabled = true; env.emailVerificationEnabled = true;
    mailer.setTransportForTests({ sendMail: async () => {} });
    googleCalls = []; googlePlan = {};
    env.geminiApiKey = ENV_KEY;
    geminiKeyRotation.resetForTests();
    await geminiKeyStore.initialize({ filePath: '' });
  });

  it('未登入 401、學生與教師 403，且不呼叫 Google', async () => {
    for (const [method, path] of [['GET', '/admin/gemini-key'], ['POST', '/admin/gemini-key/test'], ['POST', '/admin/gemini-key/activate']]) {
      assert.equal((await request(path, { method, body: method === 'POST' ? { apiKey: CANDIDATE } : undefined })).status, 401);
      for (const role of ['student', 'teacher']) {
        const [email, password] = credentials[role];
        const token = await loginAs(server.baseUrl, email, password, role);
        const result = await request(path, { method, token, body: method === 'POST' ? { apiKey: CANDIDATE } : undefined });
        assert.equal(result.status, 403); assert.equal(result.body.error.code, 'FORBIDDEN');
      }
    }
    assert.equal(googleCalls.length, 0);
  });

  it('管理員未重新驗證密碼、Bearer 或缺 CSRF 標頭時不能測試或啟用', async () => {
    const session = await sessionCookie('admin');
    for (const path of ['/admin/gemini-key/test', '/admin/gemini-key/activate']) {
      const noStep = await request(path, { method: 'POST', headers: { ...browser, Cookie: session }, body: { apiKey: CANDIDATE, testId: '00000000-0000-4000-8000-000000000000' } });
      assert.equal(noStep.status, 403); assert.equal(noStep.body.error.code, 'STEP_UP_REQUIRED');
      const bearer = await request(path, { method: 'POST', token: session.split('=')[1], body: { apiKey: CANDIDATE } });
      assert.equal(bearer.status, 403);
    }
    const headers = await steppedUp();
    const noCsrf = await request('/admin/gemini-key/test', { method: 'POST', headers: { Cookie: headers.Cookie }, body: { apiKey: CANDIDATE } });
    assert.equal(noCsrf.status, 403);
    assert.equal(googleCalls.length, 0);
    assert.equal(env.geminiApiKey, ENV_KEY);
  });

  it('GET 回傳契約欄位、no-store，且不含金鑰', async () => {
    const headers = await steppedUp();
    const result = await request('/admin/gemini-key', { headers: { Cookie: headers.Cookie } });
    assert.equal(result.status, 200);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
    const spec = yaml.load(readOpenApiYaml()).components.schemas.GeminiKeyStatus;
    assert.deepEqual(Object.keys(result.body.data).sort(), [...spec.required].sort());
    assert.equal(result.body.data.source, 'environment');
    assert.deepEqual(result.body.data.models, geminiKeyRotation.configuredModels());
    assert.equal(result.body.data.models.embedding, 'gemini-embedding-2');
    assert.equal(result.body.data.models.embeddingDimensions, 3072);
    assert.equal(JSON.stringify(result.body).includes(ENV_KEY), false);
  });

  it('測試 → 啟用：下一次 QA 讀到新金鑰，回應、稽核、狀態都不含金鑰', async () => {
    const headers = await steppedUp();
    const tested = await request('/admin/gemini-key/test', { method: 'POST', headers, body: { apiKey: CANDIDATE } });
    assert.equal(tested.status, 200);
    assert.equal(tested.response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(tested.body.data).sort(), ['checks', 'expiresAt', 'testId']);
    assert.ok(googleCalls.length >= 2 && googleCalls.every((call) => call.key === CANDIDATE));
    assert.equal(env.geminiApiKey, ENV_KEY, 'testing does not activate');
    const status = await request('/admin/gemini-key', { headers: { Cookie: headers.Cookie } });
    assert.equal(status.body.data.pendingTest.testId, tested.body.data.testId);

    const activated = await request('/admin/gemini-key/activate', { method: 'POST', headers, body: { apiKey: CANDIDATE, testId: tested.body.data.testId } });
    assert.equal(activated.status, 200);
    assert.deepEqual(activated.body.data.source, 'rotated');
    assert.equal(activated.body.data.persistence, 'memory');
    assert.equal(env.geminiApiKey, CANDIDATE);
    const after = await request('/admin/gemini-key', { headers: { Cookie: headers.Cookie } });
    assert.equal(after.body.data.source, 'rotated'); assert.equal(after.body.data.pendingTest, null);

    const everything = JSON.stringify([tested.body, activated.body, after.body, store.adminAuditLogs]);
    assert.equal(everything.includes(CANDIDATE), false);
    assert.deepEqual(store.adminAuditLogs.filter((item) => item.event.startsWith('gemini_key')).map((item) => [item.event, item.result]),
      [['gemini_key_test', 'success'], ['gemini_key_activate', 'success']]);

    const replay = await request('/admin/gemini-key/activate', { method: 'POST', headers, body: { apiKey: CANDIDATE, testId: tested.body.data.testId } });
    assert.equal(replay.status, 409); assert.equal(replay.body.error.code, 'GEMINI_KEY_TEST_REQUIRED');
  });

  it('未測試、金鑰不同時啟用回 409，金鑰不變', async () => {
    const headers = await steppedUp();
    const untested = await request('/admin/gemini-key/activate', { method: 'POST', headers, body: { apiKey: CANDIDATE, testId: '00000000-0000-4000-8000-000000000000' } });
    assert.equal(untested.status, 409); assert.equal(untested.body.error.code, 'GEMINI_KEY_TEST_REQUIRED');
    const tested = await request('/admin/gemini-key/test', { method: 'POST', headers, body: { apiKey: CANDIDATE } });
    const other = await request('/admin/gemini-key/activate', { method: 'POST', headers, body: { apiKey: 'AIzaSomeOtherKey_0123456789abcdefgh', testId: tested.body.data.testId } });
    assert.equal(other.status, 409); assert.equal(other.body.error.code, 'GEMINI_KEY_TEST_MISMATCH');
    assert.equal(env.geminiApiKey, ENV_KEY);
  });

  it('Google 429 回 429 與可顯示的細節；Google 拒絕回 422；皆不含金鑰', async () => {
    const headers = await steppedUp();
    googlePlan = { embedding: { status: 429, body: { error: { message: `quota for ${CANDIDATE}` } }, headers: { 'Retry-After': '30' } } };
    const limited = await request('/admin/gemini-key/test', { method: 'POST', headers, body: { apiKey: CANDIDATE } });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'GEMINI_KEY_PROVIDER_RATE_LIMITED');
    assert.deepEqual(limited.body.error.details, { check: 'embedding', model: 'gemini-embedding-2', reason: 'rate_limited', retryAfterSec: 30 });
    googlePlan = { embedding: { status: 400, body: { error: { details: [{ reason: 'API_KEY_INVALID' }] } } } };
    const rejected = await request('/admin/gemini-key/test', { method: 'POST', headers, body: { apiKey: CANDIDATE } });
    assert.equal(rejected.status, 422); assert.equal(rejected.body.error.code, 'GEMINI_KEY_REJECTED');
    assert.equal(JSON.stringify([limited.body, rejected.body, store.adminAuditLogs]).includes(CANDIDATE), false);
  });

  it('管理員測試次數限制回 429 與等待秒數（細節走 publicDetails，production 也會回傳）', async () => {
    const headers = await steppedUp();
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) last = await request('/admin/gemini-key/test', { method: 'POST', headers, body: { apiKey: CANDIDATE } });
    assert.equal(last.status, 429); assert.equal(last.body.error.code, 'GEMINI_KEY_ADMIN_RATE_LIMITED');
    assert.ok(last.body.error.details.retryAfterSec > 0);
  });

  it('格式錯誤與無法解析的 JSON 不回顯內容', async () => {
    const headers = await steppedUp();
    const bad = await request('/admin/gemini-key/test', { method: 'POST', headers, body: { apiKey: 'short' } });
    assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'GEMINI_KEY_FORMAT_INVALID');
    const response = await fetch(`${server.baseUrl}/api/v1/admin/gemini-key/test`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: `{"apiKey":"${CANDIDATE}"` });
    const body = await response.json();
    assert.equal(response.status, 400); assert.equal(body.error.code, 'INVALID_REQUEST_BODY');
    assert.equal(JSON.stringify(body).includes(CANDIDATE), false);
    assert.equal(googleCalls.length, 0);
  });

  it('此程序未啟用輪替時回 503，不呼叫 Google', async () => {
    geminiKeyStore.resetForTests();
    const headers = await steppedUp();
    const result = await request('/admin/gemini-key/test', { method: 'POST', headers, body: { apiKey: CANDIDATE } });
    assert.equal(result.status, 503); assert.equal(result.body.error.code, 'GEMINI_KEY_ROTATION_UNAVAILABLE');
    assert.equal(googleCalls.length, 0);
    assert.equal((await request('/admin/gemini-key', { headers: { Cookie: headers.Cookie } })).body.data.rotationAvailable, false);
  });
});
