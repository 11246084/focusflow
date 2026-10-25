const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { it } = require('node:test');
const { resetStore, store, ids, env, startServer, stopServer, loginAs, jsonRequest } = require('./helpers/backendTestHarness');
const { listExpressRoutes } = require('./helpers/expressRouteInventory');
const app = require('../src/app');

it('GET 盤點：只允許影片批次做伺服器計算、與輸入無關的冪等狀態同步', async () => {
  resetStore(); const server = await startServer();
  const token = await loginAs(server.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');
  const batchId = 'batch_20261024000000_abcdef01';
  store.videoBatches.push({ _id: '507f191e810c19729de860ff', batchId,
    courseId: ids.teacherCourse, createdBy: ids.teacher, status: 'processing', items: [] });
  const originalFlag = env.shortScriptAutomationEnabled;
  env.shortScriptAutomationEnabled = true;
  const restore = []; const writes = [];
  for (const [name, model] of Object.entries(mongoose.models)) {
    for (const method of ['create', 'insertMany', 'bulkWrite', 'findOneAndUpdate', 'findByIdAndUpdate', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
      const original = model[method];
      model[method] = function (...args) { writes.push({ name, method, args }); return original.apply(this, args); };
      restore.push(() => { model[method] = original; });
    }
  }
  try {
    const routes = listExpressRoutes(app).filter((route) => route.method === 'GET' && route.openApiPath
      && (route.openApiPath.startsWith('/api/v1') || route.openApiPath === '/health'));
    assert.ok(routes.length >= 25);
    for (const route of routes) {
      const path = route.openApiPath.replace(/\{([^}]+)\}/g, (_, key) => ({
        courseId: ids.teacherCourse, videoId: ids.teacherVideo, batchId, userId: ids.student,
      })[key] || ids.teacherVideo);
      writes.length = 0;
      await jsonRequest(server.baseUrl, `${path}?status=attacker&isActive=false`, { token });
      const batchRoute = /\/video-batches(?:\/|$)/.test(path);
      if (!batchRoute) assert.deepEqual(writes, [], `${route.openApiPath} must not mutate stored data`);
      for (const write of writes) {
        assert.equal(write.name, 'VideoBatch'); assert.equal(write.method, 'findOneAndUpdate');
        assert.deepEqual(write.args[1], { $set: { status: 'failed' } });
      }
    }
    assert.equal(store.videoBatches[0].status, 'failed');
    writes.length = 0;
    await jsonRequest(server.baseUrl, `/api/v1/video-batches/${batchId}?status=completed`, { token });
    assert.deepEqual(writes, [], 'Repeated reads with different input must not cause another update');
  } finally {
    restore.reverse().forEach((fn) => fn()); env.shortScriptAutomationEnabled = originalFlag;
    await stopServer(server.server);
  }
});
