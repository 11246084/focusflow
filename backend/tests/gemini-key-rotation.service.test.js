'use strict';
const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach } = require('node:test');
const env = require('../src/config/env');
const { createGeminiKeyStore } = require('../src/services/geminiKeyStore.service');
const { createGeminiKeyRotation, GOOGLE_MODELS_BASE, PROBE_MAX_OUTPUT_TOKENS } = require('../src/services/geminiKeyRotation.service');
const { createGeminiProvider } = require('../src/services/recutRuntimeAdapters.service');
const { createRecutDecisionPoint } = require('../src/services/recutDecision.service');
const { buildSttProcessEnvironment } = require('../src/services/sttProcessLifecycle.service');

const ENV_KEY = 'environment-key-0000000000000000';
const CANDIDATE = 'AIzaRotatedCandidateKey_0123456789ab';
const ADMIN = '507f1f77bcf86cd799439011';
const OTHER_ADMIN = '507f1f77bcf86cd799439012';

const embeddingOk = (dimensions = 3072) => ({ status: 200, body: { embedding: { values: Array.from({ length: dimensions }, () => 0.01) } } });
const generationOk = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'p' }] }, finishReason: 'MAX_TOKENS' }] } });

function googleFake(plan = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    const kind = url.endsWith(':embedContent') ? 'embedding' : 'generation';
    const step = typeof plan[kind] === 'function' ? plan[kind](url) : plan[kind];
    if (step instanceof Error) throw step;
    const { status, body, headers = {} } = step || (kind === 'embedding' ? embeddingOk() : generationOk());
    return { status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
  };
  return { calls, fetchImpl };
}

function setup({ plan, automation = false, chatModel = 'gemini-3.5-flash', recutModel = 'gemini-3.8-flash', limits, clock } = {}) {
  const envModule = {
    projectRoot: env.projectRoot, uploadDir: env.uploadDir, avatarUploadDir: env.avatarUploadDir, geminiKeyOverrideFile: '',
    geminiEnvironmentApiKey: ENV_KEY, geminiChatModel: chatModel, shortScriptAutomationEnabled: automation,
    resolver: null, setGeminiApiKeyOverride(fn) { this.resolver = fn; },
    get geminiApiKey() { return this.resolver?.() || this.geminiEnvironmentApiKey; },
  };
  const store = createGeminiKeyStore({ envModule });
  const google = googleFake(plan);
  const audits = [];
  const time = clock || { now: 1_800_000_000_000 };
  const rotation = createGeminiKeyRotation({
    store, envModule, fetchImpl: google.fetchImpl, now: () => time.now,
    getSetting: () => ({ provider: 'gemini', model: recutModel }),
    auditImpl: async (...args) => { audits.push(args); },
    ...(limits ? { limits } : {}),
  });
  return { envModule, store, google, audits, rotation, time };
}

describe('Gemini 金鑰候選測試（伺服器端）', () => {
  it('依序呼叫固定 Google 端點：3072 維 embedding 與每個設定的生成模型，最小輸入與輸出上限', async () => {
    const f = setup({ automation: true });
    await f.store.initialize({ filePath: '' });
    const result = await f.rotation.testCandidate({ adminId: ADMIN, apiKey: `  ${CANDIDATE}\n` });
    assert.deepEqual(f.google.calls.map((call) => call.url), [
      `${GOOGLE_MODELS_BASE}gemini-embedding-2:embedContent`,
      `${GOOGLE_MODELS_BASE}gemini-3.5-flash:generateContent`,
      `${GOOGLE_MODELS_BASE}gemini-3.8-flash:generateContent`,
    ]);
    assert.ok(GOOGLE_MODELS_BASE.startsWith('https://generativelanguage.googleapis.com/'));
    for (const call of f.google.calls) {
      assert.equal(call.options.method, 'POST'); assert.equal(call.options.redirect, 'error');
      assert.equal(call.options.headers['x-goog-api-key'], CANDIDATE);
      assert.ok(call.options.signal);
    }
    assert.equal(f.google.calls[0].body.output_dimensionality, 3072);
    assert.deepEqual(f.google.calls[0].body.content, { parts: [{ text: 'ping' }] });
    for (const call of f.google.calls.slice(1)) {
      assert.deepEqual(call.body.contents, [{ role: 'user', parts: [{ text: 'ping' }] }]);
      assert.equal(call.body.generationConfig.maxOutputTokens, PROBE_MAX_OUTPUT_TOKENS);
      assert.ok(PROBE_MAX_OUTPUT_TOKENS <= 256);
    }
    assert.match(result.testId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(result.checks.map((check) => [check.check, check.model]), [
      ['embedding', 'gemini-embedding-2'], ['generation', 'gemini-3.5-flash'], ['generation', 'gemini-3.8-flash']]);
    assert.equal(result.checks[0].dimensions, 3072);
    // Testing never changes the key in use.
    assert.equal(f.envModule.geminiApiKey, ENV_KEY);
    assert.equal(JSON.stringify({ result, audits: f.audits }).includes(CANDIDATE), false);
    assert.deepEqual(f.audits, [[ADMIN, 'gemini_key_test', 'success', null]]);
  });

  it('自動化關閉時只測 QA 與腳本共用的模型；模型名稱不合法時不呼叫 Google', async () => {
    const f = setup();
    await f.store.initialize({ filePath: '' });
    await f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
    assert.equal(f.google.calls.length, 2);
    const bad = setup({ chatModel: 'gemini-x/../../evil' });
    await bad.store.initialize({ filePath: '' });
    await assert.rejects(bad.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE }), { code: 'GEMINI_MODEL_CONFIG_INVALID' });
    assert.equal(bad.google.calls.length, 0);
  });

  const failures = [
    ['401', { embedding: { status: 401, body: {} } }, 'GEMINI_KEY_REJECTED', 422],
    ['400 API_KEY_INVALID', { embedding: { status: 400, body: { error: { message: `bad key ${CANDIDATE}`, details: [{ reason: 'API_KEY_INVALID' }] } } } }, 'GEMINI_KEY_REJECTED', 422],
    ['403', { embedding: { status: 403, body: {} } }, 'GEMINI_KEY_PERMISSION_DENIED', 422],
    ['empty generation', { generation: { status: 200, body: { candidates: [] } } }, 'GEMINI_KEY_PROBE_INVALID_RESPONSE', 422],
    ['404 model', { generation: { status: 404, body: {} } }, 'GEMINI_KEY_MODEL_UNAVAILABLE', 422],
    ['dimension', { embedding: embeddingOk(768) }, 'GEMINI_KEY_PROBE_INVALID_RESPONSE', 422],
    ['500', { generation: { status: 503, body: {} } }, 'GEMINI_KEY_PROBE_UNAVAILABLE', 502],
    ['network', { embedding: new TypeError('fetch failed') }, 'GEMINI_KEY_PROBE_UNAVAILABLE', 502],
    ['timeout', { embedding: Object.assign(new Error('t'), { name: 'TimeoutError' }) }, 'GEMINI_KEY_PROBE_UNAVAILABLE', 502],
  ];
  for (const [label, plan, code, statusCode] of failures) {
    it(`失敗路徑 ${label}：固定錯誤碼、不建立測試、不洩漏金鑰或 provider 文字`, async () => {
      const f = setup({ plan });
      await f.store.initialize({ filePath: '' });
      await assert.rejects(f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE }), (error) => {
        assert.equal(error.code, code); assert.equal(error.statusCode, statusCode);
        assert.equal(JSON.stringify({ m: error.message, d: error.publicDetails }).includes(CANDIDATE), false);
        assert.equal(JSON.stringify(error.publicDetails).includes('bad key'), false);
        return true;
      });
      assert.equal(f.rotation.getStatus(ADMIN).pendingTest, null);
      assert.equal(f.audits.at(-1)[2], 'failure');
      assert.equal(JSON.stringify(f.audits).includes(CANDIDATE), false);
    });
  }

  it('Google 429 轉成 GEMINI_KEY_PROVIDER_RATE_LIMITED 並帶建議等待秒數', async () => {
    const f = setup({ plan: { generation: { status: 429, body: { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '27.5s' }] } } } } });
    await f.store.initialize({ filePath: '' });
    await assert.rejects(f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE }), (error) => error.statusCode === 429
      && error.code === 'GEMINI_KEY_PROVIDER_RATE_LIMITED'
      && error.publicDetails.retryAfterSec === 28 && error.publicDetails.check === 'generation' && error.publicDetails.model === 'gemini-3.5-flash');
    const header = setup({ plan: { embedding: { status: 429, body: {}, headers: { 'retry-after': '9' } } } });
    await header.store.initialize({ filePath: '' });
    await assert.rejects(header.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE }), (error) => error.publicDetails.retryAfterSec === 9);
  });

  it('格式不符或未啟用輪替時不呼叫 Google', async () => {
    const f = setup();
    await assert.rejects(f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE }), { code: 'GEMINI_KEY_ROTATION_UNAVAILABLE', statusCode: 503 });
    await f.store.initialize({ filePath: '' });
    for (const apiKey of [undefined, 42, 'short', `${CANDIDATE}\nX: y`]) {
      await assert.rejects(f.rotation.testCandidate({ adminId: ADMIN, apiKey }), { code: 'GEMINI_KEY_FORMAT_INVALID', statusCode: 400 });
    }
    assert.equal(f.google.calls.length, 0);
  });

  it('管理員與全站測試次數限制回 429 與等待秒數，不呼叫 Google', async () => {
    const f = setup({ limits: { testPerAdmin: 2, testGlobal: 3, activatePerAdmin: 1, windowMs: 60000 } });
    await f.store.initialize({ filePath: '' });
    await f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
    await f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
    const before = f.google.calls.length;
    await assert.rejects(f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE }),
      (error) => error.statusCode === 429 && error.code === 'GEMINI_KEY_ADMIN_RATE_LIMITED' && error.publicDetails.retryAfterSec === 60 && error.publicDetails.action === 'test');
    await f.rotation.testCandidate({ adminId: OTHER_ADMIN, apiKey: CANDIDATE });
    await assert.rejects(f.rotation.testCandidate({ adminId: '507f1f77bcf86cd799439013', apiKey: CANDIDATE }), { code: 'GEMINI_KEY_ADMIN_RATE_LIMITED' });
    assert.equal(f.google.calls.length, before + 2);
    f.time.now += 60001;
    await f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
  });

  it('同時只允許一個測試或啟用，其餘回 409', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const f = setup();
    await f.store.initialize({ filePath: '' });
    const rotation = createGeminiKeyRotation({ store: f.store, envModule: f.envModule, auditImpl: async () => {},
      fetchImpl: async (url, options) => { await gate; return f.google.fetchImpl(url, options); } });
    const first = rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
    await assert.rejects(rotation.testCandidate({ adminId: OTHER_ADMIN, apiKey: CANDIDATE }), { code: 'GEMINI_KEY_OPERATION_IN_PROGRESS', statusCode: 409 });
    await assert.rejects(rotation.activateCandidate({ adminId: OTHER_ADMIN, apiKey: CANDIDATE, testId: '00000000-0000-4000-8000-000000000000' }), { code: 'GEMINI_KEY_OPERATION_IN_PROGRESS' });
    release();
    assert.match((await first).testId, /^[0-9a-f-]{36}$/);
    // The lock is released after completion.
    await rotation.testCandidate({ adminId: OTHER_ADMIN, apiKey: CANDIDATE });
  });
});

describe('Gemini 金鑰啟用綁定', () => {
  let f;
  beforeEach(async () => { f = setup(); await f.store.initialize({ filePath: '' }); });

  it('同一把金鑰與 testId 才能啟用，測試只能用一次，回應與稽核不含金鑰', async () => {
    const { testId } = await f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
    const calls = f.google.calls.length;
    const result = await f.rotation.activateCandidate({ adminId: ADMIN, apiKey: ` ${CANDIDATE} `, testId });
    assert.deepEqual(Object.keys(result).sort(), ['activatedAt', 'persistence', 'source']);
    assert.equal(result.source, 'rotated');
    assert.equal(f.envModule.geminiApiKey, CANDIDATE);
    assert.equal(f.google.calls.length, calls, 'binding replaces a second probe');
    assert.equal(JSON.stringify({ result, audits: f.audits, status: f.rotation.getStatus(ADMIN) }).includes(CANDIDATE), false);
    assert.equal(f.audits.at(-1)[1], 'gemini_key_activate'); assert.equal(f.audits.at(-1)[2], 'success');
    assert.match(f.audits.at(-1)[3], /^version:[0-9a-f-]{36}$/);
    await assert.rejects(f.rotation.activateCandidate({ adminId: ADMIN, apiKey: CANDIDATE, testId }), { code: 'GEMINI_KEY_TEST_REQUIRED', statusCode: 409 });
  });

  it('金鑰不同、testId 不符、其他管理員、過期時拒絕並維持原金鑰', async () => {
    const { testId } = await f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
    await assert.rejects(f.rotation.activateCandidate({ adminId: ADMIN, apiKey: 'AIzaDifferentCandidate_0123456789abcd', testId }), { code: 'GEMINI_KEY_TEST_MISMATCH' });
    await assert.rejects(f.rotation.activateCandidate({ adminId: ADMIN, apiKey: CANDIDATE, testId: '00000000-0000-4000-8000-000000000000' }), { code: 'GEMINI_KEY_TEST_REQUIRED' });
    await assert.rejects(f.rotation.activateCandidate({ adminId: ADMIN, apiKey: CANDIDATE }), { code: 'GEMINI_KEY_TEST_REQUIRED' });
    await assert.rejects(f.rotation.activateCandidate({ adminId: OTHER_ADMIN, apiKey: CANDIDATE, testId }), { code: 'GEMINI_KEY_TEST_REQUIRED' });
    f.time.now += 10 * 60 * 1000 + 1;
    await assert.rejects(f.rotation.activateCandidate({ adminId: ADMIN, apiKey: CANDIDATE, testId }), { code: 'GEMINI_KEY_TEST_REQUIRED' });
    assert.equal(f.envModule.geminiApiKey, ENV_KEY);
    assert.equal(JSON.stringify(f.audits).includes(CANDIDATE), false);
  });

  it('測試後模型設定改變或其他管理員已更換金鑰時要求重新測試', async () => {
    const { testId } = await f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
    f.envModule.geminiChatModel = 'gemini-3.9-flash';
    await assert.rejects(f.rotation.activateCandidate({ adminId: ADMIN, apiKey: CANDIDATE, testId }), { code: 'GEMINI_KEY_TEST_STALE' });
    f.envModule.geminiChatModel = 'gemini-3.5-flash';
    const mine = await f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
    const other = 'AIzaOtherAdminCandidate_0123456789abc';
    const theirs = await f.rotation.testCandidate({ adminId: OTHER_ADMIN, apiKey: other });
    await f.rotation.activateCandidate({ adminId: OTHER_ADMIN, apiKey: other, testId: theirs.testId });
    await assert.rejects(f.rotation.activateCandidate({ adminId: ADMIN, apiKey: CANDIDATE, testId: mine.testId }), { code: 'GEMINI_KEY_CHANGED_CONCURRENTLY' });
    assert.equal(f.envModule.geminiApiKey, other);
  });

  it('啟用次數限制回 429', async () => {
    const limited = setup({ limits: { testPerAdmin: 5, testGlobal: 5, activatePerAdmin: 1, windowMs: 60000 } });
    await limited.store.initialize({ filePath: '' });
    await assert.rejects(limited.rotation.activateCandidate({ adminId: ADMIN, apiKey: CANDIDATE, testId: '00000000-0000-4000-8000-000000000000' }), { code: 'GEMINI_KEY_TEST_REQUIRED' });
    await assert.rejects(limited.rotation.activateCandidate({ adminId: ADMIN, apiKey: CANDIDATE, testId: '00000000-0000-4000-8000-000000000000' }),
      (error) => error.statusCode === 429 && error.code === 'GEMINI_KEY_ADMIN_RATE_LIMITED' && error.publicDetails.action === 'activate');
  });

  it('保存失敗時不切換金鑰並記錄失敗', async () => {
    const { testId } = await f.rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
    const originalActivate = f.store.activate;
    f.store.activate = async () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); };
    await assert.rejects(f.rotation.activateCandidate({ adminId: ADMIN, apiKey: CANDIDATE, testId }), { code: 'GEMINI_KEY_STORAGE_FAILED', statusCode: 500 });
    f.store.activate = originalActivate;
    assert.equal(f.envModule.geminiApiKey, ENV_KEY);
    assert.deepEqual(f.audits.at(-1).slice(1), ['gemini_key_activate', 'failure', 'storage_failed']);
  });

  it('稽核寫入失敗不影響已完成的啟用，也不記錄金鑰', async () => {
    const errors = []; const originalError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const rotation = createGeminiKeyRotation({ store: f.store, envModule: f.envModule, fetchImpl: f.google.fetchImpl,
        auditImpl: async () => { throw new Error('audit offline'); } });
      const { testId } = await rotation.testCandidate({ adminId: ADMIN, apiKey: CANDIDATE });
      await rotation.activateCandidate({ adminId: ADMIN, apiKey: CANDIDATE, testId });
      assert.equal(f.envModule.geminiApiKey, CANDIDATE);
      assert.equal(errors.join('\n').includes(CANDIDATE), false);
    } finally { console.error = originalError; }
  });
});

describe('輪替後的熱更新', () => {
  const originalFetch = global.fetch;
  const originalEnvKey = env.geminiApiKey;
  const { geminiKeyStore } = require('../src/services/geminiKeyStore.service');
  afterEach(() => { geminiKeyStore.resetForTests(); env.geminiApiKey = originalEnvKey; global.fetch = originalFetch; });

  it('快取的 recut provider、decision point、STT 子程序都改用新金鑰；CLI 固定金鑰不受影響', async () => {
    env.geminiApiKey = ENV_KEY;
    await geminiKeyStore.initialize({ filePath: '' });
    const seen = [];
    const fetchImpl = async (url, options) => { seen.push(options.headers['x-goog-api-key']); return { status: 200, ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) }; };
    const hosted = createGeminiProvider({ apiKey: env.geminiApiKey, getApiKey: () => env.geminiApiKey, fetchImpl });
    const cli = createGeminiProvider({ apiKey: 'cli-fixed-key-000000000000000000', fetchImpl });
    const decide = createRecutDecisionPoint({ fetchImpl });
    const request = { model: { provider: 'gemini', model: 'gemini-3.8-flash' }, instructions: 'x', input: {}, responseSchema: {} };
    await hosted(request); await cli(request); await decide(request);
    assert.equal(buildSttProcessEnvironment({ GEMINI_API_KEY: ENV_KEY }, {}).GEMINI_API_KEY, ENV_KEY);
    await geminiKeyStore.activate(CANDIDATE);
    await hosted(request); await cli(request); await decide(request);
    assert.deepEqual(seen, [ENV_KEY, 'cli-fixed-key-000000000000000000', ENV_KEY, CANDIDATE, 'cli-fixed-key-000000000000000000', CANDIDATE]);
    assert.equal(buildSttProcessEnvironment({ GEMINI_API_KEY: ENV_KEY, PATH: 'p' }, { MONGODB_URI: 'm' }).GEMINI_API_KEY, CANDIDATE);
    assert.equal(buildSttProcessEnvironment({}, {}).GEMINI_API_KEY, CANDIDATE);
  });

  it('QA 問答與腳本生成在下一次請求讀取新金鑰', async () => {
    env.geminiApiKey = ENV_KEY;
    await geminiKeyStore.initialize({ filePath: '' });
    const seen = [];
    global.fetch = async (url, options) => {
      seen.push(options.headers['x-goog-api-key']);
      return { status: 200, ok: true, json: async () => ({ embedding: { values: Array.from({ length: 3072 }, () => 0.5) } }) };
    };
    const { embedWithGemini } = require('../src/services/queryEmbedding.service');
    const originalModel = env.geminiEmbeddingModelName;
    env.geminiEmbeddingModelName = 'gemini-embedding-2';
    try {
      await embedWithGemini('a');
      await geminiKeyStore.activate(CANDIDATE);
      await embedWithGemini('b');
    } finally { env.geminiEmbeddingModelName = originalModel; }
    assert.deepEqual(seen, [ENV_KEY, CANDIDATE]);
  });

  it('host runtime：geminiApiKeyEnv 為 GEMINI_API_KEY 時傳入動態解析器，其他名稱維持固定環境變數', async () => {
    const { createRecutHostRuntime } = require('../src/services/recutHostRuntime.service');
    const path = require('node:path');
    const base = path.resolve('fake-recut-host-gemini');
    const file = (name) => path.join(base, name);
    const build = async (geminiApiKeyEnv) => {
      const config = { schemaVersion: 1, modelCallsEnabled: true, geminiApiKeyEnv, allowedGeminiModels: ['gemini-3-fake'],
        maxOutputTokens: 4096, codeCardsEnabled: false, workspaceRoot: file('work'),
        media: { allowedRoot: file('sources'), ffmpeg: file('ffmpeg'), ffprobe: file('ffprobe'), python: file('python'), transcriber: file('t.py'), asrModel: file('model') } };
      const directories = new Set([file('work'), file('sources'), file('model')]);
      const captured = [];
      await createRecutHostRuntime({ enabled: true, runtimeConfigPath: file('runtime.json'),
        fs: { stat: async (v) => ({ isFile: () => !directories.has(v), isDirectory: () => directories.has(v), size: 20 }), realpath: async (v) => v, readFile: async () => JSON.stringify(config) },
        env: { GEMINI_API_KEY: 'stale-process-env-key-000000000', OTHER_KEY: 'other-fixed-key-0000000000000' },
        geminiKeyResolver: () => env.geminiApiKey,
        getSetting: () => ({ provider: 'gemini', model: 'gemini-3-fake' }),
        providerFactory: (options) => { captured.push(options); return async () => ({ output: {} }); },
        rendererLoader: () => ({ buildRecutPlan() {}, validatePlan() {}, getCardsResponseSchema() {}, getComponentCatalog() {} }),
        runtimeFactory: () => ({ missing: [] }), mediaFactory: () => ({}) });
      return captured[0];
    };
    env.geminiApiKey = ENV_KEY;
    await geminiKeyStore.initialize({ filePath: '' });
    env.geminiApiKey = '';
    const coldSite = await build('GEMINI_API_KEY');
    assert.equal(coldSite.getApiKey(), '');
    env.geminiApiKey = ENV_KEY;
    const site = await build('GEMINI_API_KEY');
    assert.equal(site.apiKey, ENV_KEY);
    await geminiKeyStore.activate(CANDIDATE);
    assert.equal(coldSite.getApiKey(), CANDIDATE);
    assert.equal(site.getApiKey(), CANDIDATE);
    const other = await build('OTHER_KEY');
    assert.equal(other.apiKey, 'other-fixed-key-0000000000000');
    assert.equal(other.getApiKey, undefined);
  });
});
