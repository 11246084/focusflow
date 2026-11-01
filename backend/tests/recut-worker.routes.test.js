const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids, startServer, stopServer, loginAs, jsonRequest, newObjectId } = require('./helpers/backendTestHarness');
const { makeReview, teacher } = require('./helpers/recutReviewFixtures');
const { snapshot } = require('./helpers/recutFixtures');
const service = require('../src/services/recutWorker.service');
const review = require('../src/services/recutReview.service');
const env = require('../src/config/env');
let server, baseUrl, previous;
const base = '/api/v1/recut-worker/jobs';
const versions = { shortRenderVersion: 'fixture', assetVersions: {} };
describe('recut worker 專用 API 權限', () => {
  before(async () => { ({ server, baseUrl } = await startServer()); previous = env.shortScriptAutomationEnabled; });
  after(async () => { env.shortScriptAutomationEnabled = previous; await stopServer(server); });
  beforeEach(async () => { await resetStore(); env.shortScriptAutomationEnabled = true; });
  it('功能關閉404，無key401；一般教師JWT不能使用worker API', async () => {
    env.shortScriptAutomationEnabled = false;
    assert.equal((await jsonRequest(baseUrl, `${base}/claim`, { method: 'POST', body: versions })).status, 404);
    env.shortScriptAutomationEnabled = true;
    assert.equal((await jsonRequest(baseUrl, `${base}/claim`, { method: 'POST', body: versions })).status, 401);
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    assert.equal((await jsonRequest(baseUrl, `${base}/claim`, { method: 'POST', token, body: versions })).status, 401);
  });
  it('worker key不能使用學生、教師或管理員API', async () => {
    const made = await service.createWorker({ user: { id: ids.admin }, name: 'limited key' });
    for (const route of ['/api/v1/admin/recut-workers', '/api/v1/courses', '/api/v1/shorts']) {
      assert.equal((await jsonRequest(baseUrl, route, { token: made.key })).status, 401, route);
    }
  });
  it('教師不能建立key；admin建立只回一次key，列表不回hash', async () => {
    const teacherToken = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    assert.equal((await jsonRequest(baseUrl, '/api/v1/admin/recut-workers', { method: 'POST', token: teacherToken, body: { name: 'fake' } })).status, 403);
    const token = await loginAs(baseUrl, 'admin@focusflow.local', 'Admin123!');
    const result = await jsonRequest(baseUrl, '/api/v1/admin/recut-workers', { method: 'POST', token, body: { name: 'fake' } });
    assert.equal(result.status, 201); assert.match(result.body.data.key, /^rw_/);
    const list = await jsonRequest(baseUrl, '/api/v1/admin/recut-workers', { token });
    assert.equal(list.status, 200); assert.equal(list.body.data.items[0].keyHash, undefined); assert.equal(list.body.data.items[0].key, undefined);
    const paused = await jsonRequest(baseUrl, `/api/v1/admin/recut-workers/${result.body.data.id}`, { method: 'PATCH', token, body: { accepting: false } });
    assert.equal(paused.status, 200);
    const claim = await jsonRequest(baseUrl, `${base}/claim`, { method: 'POST', token: result.body.data.key, body: versions });
    assert.equal(claim.status, 200); assert.equal(claim.body.data, null);
  });
  it('未知欄位或越權lease拒絕，上傳前即拒絕過期／無owner工作', async () => {
    const made = await service.createWorker({ user: { id: ids.admin }, name: 'fake' });
    assert.equal((await jsonRequest(baseUrl, `${base}/claim`, { method: 'POST', token: made.key, body: { ...versions, filePath: 'forbidden' } })).status, 400);
    const result = await jsonRequest(baseUrl, `${base}/${newObjectId()}/result`, { method: 'POST', token: made.key, body: {} });
    assert.equal(result.status, 409); assert.equal(result.body.error.code, 'RECUT_LEASE_INVALID');
  });
  it('領工作回凍結逐字資料，lease header才可heartbeat；撤銷後立即401', async () => {
    const f = await makeReview();
    const options = () => ({ scriptId: f.script._id, user: teacher, versionId: f.version._id, expectedRevision: snapshot(f.script).revision });
    await review.approveScript(options()); await review.queueRender(options());
    const made = await service.createWorker({ user: { id: ids.admin }, name: 'fake' });
    const result = await jsonRequest(baseUrl, `${base}/claim`, { method: 'POST', token: made.key, body: versions });
    assert.equal(result.status, 200); const job = result.body.data; assert.ok(job.source.sentences.length);
    const heartbeat = await fetch(`${baseUrl}${base}/${job.jobId}/heartbeat`, { method: 'POST', headers: { Authorization: `Bearer ${made.key}`, 'X-Recut-Lease': job.leaseToken, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(heartbeat.status, 200);
    await service.updateWorker({ user: { id: ids.admin }, workerId: made.id, isActive: false });
    assert.equal((await jsonRequest(baseUrl, `${base}/claim`, { method: 'POST', token: made.key, body: versions })).status, 401);
  });
});
