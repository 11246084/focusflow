const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, ids, jsonRequest, loginAs, startServer, stopServer, store, newObjectId } = require('./helpers/backendTestHarness');
const { seedScript, makeVersion } = require('./helpers/recutFixtures');
const env = require('../src/config/env');
const { recutQueue: queue } = require('../src/services/recutQueue.service');
let server; let baseUrl; let flag;
const pathFor = (script, tail = '') => `/api/v1/short-scripts/${script._id}${tail}`;
async function teacherToken() { return loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!'); }
async function installSteps(script) {
  const { _id, createdAt, updatedAt, __v, ...version } = await makeVersion(script);
  queue.registerSteps('generate', [{ id: 'route-fake-v1', stage: 'selection', run: async () => ({ version }) }]);
}
describe('recut 最小 API', () => {
  before(async () => { ({ server, baseUrl } = await startServer()); flag = env.shortScriptAutomationEnabled; });
  after(async () => { await queue.idle(); await stopServer(server); env.shortScriptAutomationEnabled = flag; });
  beforeEach(() => { resetStore(); env.shortScriptAutomationEnabled = true; queue.stop(); });
  afterEach(async () => { await queue.idle(); });
  it('所有新路由沿用 feature flag，未開啟時回 404', async () => {
    env.shortScriptAutomationEnabled = false; const script = seedScript();
    for (const [method, tail] of [['PATCH', '/production-mode'], ['POST', '/recut/generate'], ['GET', '/recut'], ['GET', `/recut/tasks/${newObjectId()}`], ['POST', `/recut/tasks/${newObjectId()}/cancel`]]) {
      assert.equal((await jsonRequest(baseUrl, pathFor(script, tail), { method, body: method === 'GET' ? undefined : {} })).status, 404);
    }
  });
  it('所有新路由未登入時回 401', async () => {
    const script = seedScript();
    for (const [method, tail] of [['PATCH', '/production-mode'], ['POST', '/recut/generate'], ['GET', '/recut'], ['GET', `/recut/tasks/${newObjectId()}`], ['POST', `/recut/tasks/${newObjectId()}/cancel`]]) {
      assert.equal((await jsonRequest(baseUrl, pathFor(script, tail), { method, body: method === 'GET' ? undefined : {} })).status, 401);
    }
  });
  for (const [email, password, label] of [['student@focusflow.local', 'Student123!', '學生'], ['teacher2@focusflow.local', 'Teacher123!', '其他教師']]) {
    it(`${label}不能設定模式、啟動、查狀態、查任務或取消，均為 403`, async () => {
      const script = seedScript(); await installSteps(script);
      const token = await loginAs(baseUrl, email, password);
      for (const [method, tail, body] of [['PATCH', '/production-mode', { productionMode: 'avatar' }], ['POST', '/recut/generate', {}], ['GET', '/recut'], ['GET', `/recut/tasks/${newObjectId()}`], ['POST', `/recut/tasks/${newObjectId()}/cancel`, {}]]) {
        assert.equal((await jsonRequest(baseUrl, pathFor(script, tail), { method, token, body })).status, 403);
      }
      assert.equal(store.recutTasks.length, 0);
    });
  }
  it('教師可在生成前設定模式；舊資料查詢顯示 avatar', async () => {
    const script = seedScript(); delete script.productionMode; const token = await teacherToken();
    const old = await jsonRequest(baseUrl, pathFor(script, '/recut'), { token });
    assert.equal(old.body.data.productionMode, 'avatar'); assert.equal(script.productionMode, undefined);
    const response = await jsonRequest(baseUrl, pathFor(script, '/production-mode'), { method: 'PATCH', token, body: { productionMode: 'recut' } });
    assert.equal(response.status, 200); assert.equal(response.body.data.productionMode, 'recut');
  });
  it('模式缺漏、非法值、額外欄位與惡意物件皆為 400', async () => {
    const script = seedScript(); const token = await teacherToken();
    for (const body of [{}, { productionMode: 'bad' }, { productionMode: { $ne: null } }, { productionMode: 'recut', status: 'published' }]) {
      const response = await jsonRequest(baseUrl, pathFor(script, '/production-mode'), { method: 'PATCH', token, body });
      assert.equal(response.status, 400); assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    }
  });
  it('啟動回 202 與任務 ID，可查任務、目前狀態及要求取消', async () => {
    const script = seedScript(); await installSteps(script); const token = await teacherToken();
    const response = await jsonRequest(baseUrl, pathFor(script, '/recut/generate'), { method: 'POST', token, body: {} });
    assert.equal(response.status, 202); const taskId = response.body.data.id; assert.match(taskId, /^[a-f0-9]{24}$/);
    assert.equal(response.body.data.callLimit, 5); assert.equal(response.body.data.status, 'queued');
    const query = await jsonRequest(baseUrl, pathFor(script, `/recut/tasks/${taskId}`), { token });
    assert.equal(query.status, 200); assert.equal(query.body.data.id, taskId); assert.equal(query.body.data.baseSnapshot, undefined);
    const state = await jsonRequest(baseUrl, pathFor(script, '/recut'), { token });
    assert.equal(state.body.data.recut.state, 'queued'); assert.equal(state.body.data.task.id, taskId);
    const cancel = await jsonRequest(baseUrl, pathFor(script, `/recut/tasks/${taskId}/cancel`), { method: 'POST', token, body: {} });
    assert.equal(cancel.status, 200); assert.equal(cancel.body.data.status, 'cancelled');
    assert.equal(script.recut.state, 'idle');
  });
  it('教師不得透過啟動 API 指定呼叫上限或任務類型', async () => {
    const script = seedScript(); const token = await teacherToken();
    const response = await jsonRequest(baseUrl, pathFor(script, '/recut/generate'), { method: 'POST', token, body: { callLimit: 100, type: 'apply_selection' } });
    assert.equal(response.status, 400); assert.equal(store.recutTasks.length, 0);
  });
  it('目前狀態帶出渲染失敗的錯誤代碼，不帶原始訊息', async () => {
    const script = seedScript(); const token = await teacherToken();
    const versionId = newObjectId();
    script.productionMode = 'recut';
    script.recut = { ...(script.recut || {}), state: 'render_failed', revision: 4, currentVersionId: versionId };
    store.recutRenderJobs.push({ _id: newObjectId(), scriptId: script._id, courseId: script.courseId, versionId, status: 'failed',
      planHash: 'h', attemptCount: 1, queuedAt: new Date(), finishedAt: new Date(),
      error: { code: 'RECUT_TEXT_OVERFLOW', message: 'card scene-3 overflow at 0.6x' } });
    const state = await jsonRequest(baseUrl, pathFor(script, '/recut'), { token });
    assert.equal(state.status, 200);
    assert.equal(state.body.data.render.status, 'failed');
    assert.equal(state.body.data.render.errorCode, 'RECUT_TEXT_OVERFLOW');
    assert.equal(JSON.stringify(state.body.data.render).includes('overflow at'), false);
  });
  it('尚未排入渲染時 render 為 null', async () => {
    const script = seedScript(); const token = await teacherToken();
    const state = await jsonRequest(baseUrl, pathFor(script, '/recut'), { token });
    assert.equal(state.body.data.render, null);
  });
  it('無效 ID 回 400，不存在或不屬於本腳本的任務回 404', async () => {
    const script = seedScript(); const other = seedScript(); await installSteps(other); const token = await teacherToken();
    const started = await jsonRequest(baseUrl, pathFor(other, '/recut/generate'), { method: 'POST', token, body: {} });
    assert.equal((await jsonRequest(baseUrl, '/api/v1/short-scripts/bad/recut', { token })).status, 400);
    assert.equal((await jsonRequest(baseUrl, pathFor(script, '/recut/tasks/bad'), { token })).status, 400);
    assert.equal((await jsonRequest(baseUrl, pathFor(script, `/recut/tasks/${newObjectId()}`), { token })).status, 404);
    assert.equal((await jsonRequest(baseUrl, pathFor(script, `/recut/tasks/${started.body.data.id}`), { token })).status, 404);
  });
  it('recut 不會誤走既有 8 拍同步生成或腳本審核路徑', async () => {
    const script = seedScript({ status: 'generated' }); const token = await teacherToken();
    const generated = await jsonRequest(baseUrl, pathFor(script, '/generate'), { method: 'POST', token, body: {} });
    const reviewed = await jsonRequest(baseUrl, pathFor(script, '/review'), { method: 'POST', token, body: { decision: 'dismiss' } });
    assert.equal(generated.status, 409); assert.equal(reviewed.status, 409);
    assert.equal(store.usageLogs.filter((log) => log.event === 'short_script_generate').length, 0);
  });
});
