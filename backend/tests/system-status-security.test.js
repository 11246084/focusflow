const assert = require('node:assert/strict');
const {
  after,
  before,
  beforeEach,
  describe,
  it,
} = require('node:test');
const {
  ids,
  jsonRequest,
  loginAs,
  resetStore,
  startServer,
  stopServer,
} = require('./helpers/backendTestHarness');
const { buildSystemStatus } = require('../src/services/systemStatus.service');

function baseInput(overrides = {}) {
  return {
    dbReadyState: 1,
    qa: {
      readiness: 'ready',
      answerProvider: 'gemini',
      vectorSearchMode: 'atlas',
      hardFailures: [],
      warnings: [],
    },
    line: { readiness: 'ready', deliveryMode: 'live' },
    youtube: { readiness: 'not_enabled', hardFailures: [], warnings: [] },
    venvPythonExists: true,
    queue: { active: 0, queued: 0 },
    checkedAt: new Date('2026-09-18T00:00:00.000Z'),
    ...overrides,
  };
}

function serviceByKey(result, key) {
  return result.services.find((service) => service.key === key);
}

describe('buildSystemStatus', () => {
  it('DB 未連線時資料庫狀態為 down', () => {
    const result = buildSystemStatus(baseInput({ dbReadyState: 0 }));
    assert.equal(serviceByKey(result, 'database').status, 'down');
  });

  it('QA hard_fail 時顯示 down 並帶第一個錯誤訊息', () => {
    const result = buildSystemStatus(baseInput({
      qa: {
        readiness: 'hard_fail',
        answerProvider: 'gemini',
        vectorSearchMode: 'atlas',
        hardFailures: [{ code: 'X', message: 'GEMINI_API_KEY is required.' }],
        warnings: [],
      },
    }));
    const qa = serviceByKey(result, 'qa');
    assert.equal(qa.status, 'down');
    assert.equal(qa.detail, 'GEMINI_API_KEY is required.');
  });

  it('YouTube 功能未啟用時回 not_enabled 而不是正常', () => {
    const result = buildSystemStatus(baseInput());
    assert.equal(serviceByKey(result, 'youtube').status, 'not_enabled');
  });

  it('找不到 STT venv 時 Pipeline 為 degraded', () => {
    const result = buildSystemStatus(baseInput({ venvPythonExists: false }));
    assert.equal(serviceByKey(result, 'stt').status, 'degraded');
  });
});

describe('系統狀態 API、404 與安全標頭', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(() => {
    resetStore();
  });

  it('管理員可取得系統服務狀態', async () => {
    const token = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/system-status', { token });

    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.data.services.map((service) => service.key),
      ['database', 'qa', 'line', 'stt', 'youtube'],
    );
  });

  it('學生不能讀取系統服務狀態', async () => {
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!', 'student');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/system-status', { token });

    assert.equal(result.status, 403);
  });

  it('未登入讀取系統服務狀態回 401', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/system-status');

    assert.equal(result.status, 401);
  });

  it('未登入打不存在的 API 路徑回 404', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/does-not-exist');

    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'NOT_FOUND');
  });

  it('未登入讀取影片仍回 401', async () => {
    const result = await jsonRequest(serverContext.baseUrl, `/api/v1/videos/${ids.publishedVideo}`);

    assert.equal(result.status, 401);
  });

  it('API 回應帶基本安全標頭且不透露 X-Powered-By', async () => {
    const { response } = await jsonRequest(serverContext.baseUrl, '/api/v1/does-not-exist');

    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-powered-by'), null);
  });
});
