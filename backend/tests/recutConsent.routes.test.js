const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const AppError = require('../src/utils/appError');
const { createRecutConsentRouter } = require('../src/routes/recut-consent.routes');
const { fixture, ids } = require('./helpers/recutConsentFake');

// Real loopback HTTP/router/role guard, fake identity and repository; no production app.
async function api(run) {
  const f = fixture();
  const users = { teacher: f.teacher, admin: f.admin, student: { id: ids.teacher, role: 'student' }, other: { id: ids.otherTeacher, role: 'teacher' } };
  const app = express();
  app.use(express.json());
  app.use(createRecutConsentRouter({ service: f.service, authentication(req, res, next) {
    req.user = users[req.headers['x-test-user']];
    next(req.user ? undefined : new AppError('Authentication required.', 401, 'UNAUTHORIZED'));
  } }));
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ success: false, error: { code: err.code } }));
  const server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const request = async (path, { user = 'teacher', method = 'GET', body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try { await run(f, request); } finally { await new Promise((resolve) => server.close(resolve)); }
}
const base = `/courses/${ids.course}/recut-consent`;
const endpoints = [['GET', '/recut-consent/terms'], ['GET', base], ['POST', base], ['GET', `${base}/withdrawal-assets?kind=voice`],
  ['POST', `${base}/withdrawals`], ['POST', `${base}/withdrawals/fake/retry`], ['GET', '/admin/recut-consent/manual-actions']];

test('同意API所有端點拒絕匿名與學生', () => api(async (f, request) => {
  for (const [method, path] of endpoints) {
    assert.equal((await request(path, { method, user: null })).status, 401, path);
    assert.equal((await request(path, { method, user: 'student' })).status, 403, path);
  }
  assert.equal(f.store.size, 0);
}));

test('教師讀取條款與自己課程；其他教師、外課與偽造teacherId均拒絕', () => api(async (f, request) => {
  assert.equal((await request('/recut-consent/terms')).body.data.version, f.base.termsVersion);
  assert.equal((await request(base)).body.data.voiceMode, null);
  for (const [method, path] of endpoints.filter(([, path]) => path.startsWith('/courses'))) {
    assert.equal((await request(path, { method, user: 'other' })).status, 403);
  }
  assert.equal((await request(`/courses/${ids.otherCourse}/recut-consent`)).status, 403);
  assert.equal((await request(`${base}?teacherId=${ids.otherTeacher}`)).status, 403);
  assert.equal((await request(`${base}?videoId=${ids.otherVideo}`)).status, 404);
  assert.equal((await request(`${base}?sourceId=foreign-lecture`)).status, 404);
  assert.equal((await request(`${base}?sourceId[$ne]=x`)).status, 400);
}));

test('API按教師保存原音及合成偏好，request重送不增加歷史且不採信舊disclosure', () => api(async (f, request) => {
  const body = { kind: 'voice', choice: 'original', requestId: 'api-original', termsVersion: f.base.termsVersion };
  assert.equal((await request(base, { method: 'POST', body })).status, 200);
  await request(base, { method: 'POST', body });
  assert.equal((await request(`/courses/${ids.secondCourse}/recut-consent`)).body.data.voiceMode, 'original');
  const synthetic = await request(base, { method: 'POST', body: { ...body, choice: 'synthetic', requestId: 'api-synthetic', consentConfirmed: true } });
  assert.equal(synthetic.body.data.voiceMode, 'synthetic');
  assert.equal(synthetic.body.data.syntheticReady, false);
  assert.equal((await f.repository.read(ids.teacher)).records.length, 2);
  assert.equal((await request(base, { method: 'POST', body: { ...body, termsVersion: 'old' } })).status, 409);
}));

test('管理員可明確代登書面依據，內容同意限指定來源，外課來源不能補登', () => api(async (f, request) => {
  const body = { kind: 'content', choice: 'granted', requestId: 'api-paper', termsVersion: f.base.termsVersion, sourceId: 'lecture-one', evidenceRef: '教授書面同意 登記A' };
  assert.equal((await request(base, { method: 'POST', user: 'admin', body })).status, 200);
  assert.equal((await f.repository.read(ids.teacher)).records[0].actorId, ids.admin);
  assert.equal((await request(base, { method: 'POST', user: 'admin', body: { ...body, sourceId: 'foreign-lecture' } })).status, 404);
  assert.equal((await request(base, { method: 'POST', body: { ...body, requestId: 'forbidden-evidence' } })).status, 400);
}));

test('撤回API清單預設不勾、逐支下架與全選；重試及管理員待辦隔離', () => api(async (f, request) => {
  const list = await request(`${base}/withdrawal-assets?kind=voice`);
  assert.equal(list.body.data.selectAll, false);
  assert.ok(list.body.data.assets.every((asset) => !asset.selected));
  f.setPrivacyFails(true);
  const body = { kind: 'voice', requestId: 'api-withdraw', termsVersion: f.base.termsVersion, selectedAssetIds: [ids.asset] };
  const withdrawal = await request(`${base}/withdrawals`, { method: 'POST', body });
  assert.equal(withdrawal.status, 200);
  assert.equal(withdrawal.body.data.status, 'pending');
  assert.equal((await request('/admin/recut-consent/manual-actions')).status, 403);
  assert.equal((await request('/admin/recut-consent/manual-actions', { user: 'admin' })).body.data.length, 1);
  f.setPrivacyFails(false);
  assert.equal((await request(`${base}/withdrawals/${withdrawal.body.data.id}/retry`, { method: 'POST' })).body.data.status, 'completed');
  assert.equal((await request(`${base}/withdrawals`, { method: 'POST', body: { ...body, requestId: 'api-all', selectedAssetIds: undefined, selectAll: true } })).body.data.selectedAssetIds.length, 2);
  assert.equal((await request(`${base}/withdrawals`, { method: 'POST', body: { ...body, requestId: 'api-foreign', selectedAssetIds: [ids.foreignAsset] } })).status, 403);
}));
