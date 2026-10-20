const assert = require('node:assert/strict');
const {
  after,
  afterEach,
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
  store,
} = require('./helpers/backendTestHarness');
const env = require('../src/config/env');

const ENV_KEYS = [
  'youtubeUploadEnabled',
  'youtubeUploadRecoveryEnabled',
  'youtubeUploadCleanupEnabled',
  'youtubeUploadRecoveryIntervalMs',
];

describe('管理員 YouTube 生命週期設定 API', () => {
  let serverContext;
  let originalEnv;
  let adminToken;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(async () => {
    resetStore();
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    env.youtubeUploadEnabled = true;
    env.youtubeUploadRecoveryEnabled = true;
    env.youtubeUploadCleanupEnabled = false;
    env.youtubeUploadRecoveryIntervalMs = 300000;
    adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
  });

  it('非 admin 呼叫回 403', async () => {
    const token = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!', 'teacher');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/settings', { token });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'FORBIDDEN');
  });

  it('GET 回傳三個開關、修改紀錄與執行期參數', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/settings', {
      token: adminToken,
    });

    assert.equal(result.status, 200);
    const { switches, history, runtime } = result.body.data;
    assert.deepEqual(switches.map((item) => item.key), ['upload', 'recovery', 'cleanup']);
    assert.deepEqual(switches[2], {
      key: 'cleanup',
      envAllowed: false,
      runtimeEnabled: null,
      effective: false,
      reason: 'env_disabled',
    });
    assert.deepEqual(history, []);
    assert.equal(runtime.recoveryIntervalMs, 300000);
    assert.ok('freeSpaceGb' in runtime);
    assert.ok('lastRecoveryAt' in runtime);
    assert.equal(typeof runtime.cleanupMaxAgeDays, 'number');
  });

  it('PATCH 切換開關後回傳最新設定，紀錄帶修改者姓名與 email', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/settings', {
      method: 'PATCH',
      token: adminToken,
      body: { key: 'recovery', enabled: false },
    });

    assert.equal(result.status, 200);
    const recovery = result.body.data.switches.find((item) => item.key === 'recovery');
    assert.equal(recovery.runtimeEnabled, false);
    assert.equal(recovery.effective, false);
    assert.equal(recovery.reason, 'runtime_disabled');
    assert.equal(result.body.data.history.length, 1);
    const [entry] = result.body.data.history;
    assert.equal(entry.key, 'recovery');
    assert.equal(entry.from, null);
    assert.equal(entry.to, false);
    assert.equal(entry.changedBy.id, ids.admin);
    assert.equal(entry.changedBy.email, 'admin@focusflow.local');
    assert.equal(entry.changedBy.name, store.users.find((user) => user._id === ids.admin).name);
  });

  it('環境變數不允許時 PATCH 回 409 且不寫入設定', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/settings', {
      method: 'PATCH',
      token: adminToken,
      body: { key: 'cleanup', enabled: true },
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'YOUTUBE_LIFECYCLE_SWITCH_ENV_DISABLED');
    assert.equal(store.runtimeSettings.length, 0);
  });

  it('PATCH 的 enabled 不是布林值時回 400', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/admin/youtube-lifecycle/settings', {
      method: 'PATCH',
      token: adminToken,
      body: { key: 'upload', enabled: 'false' },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  });
});
