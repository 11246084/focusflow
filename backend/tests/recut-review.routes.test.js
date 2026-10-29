const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids, newObjectId, jsonRequest, loginAs, startServer, stopServer } = require('./helpers/backendTestHarness');
const { makeReview, suggest, assetFor } = require('./helpers/recutReviewFixtures');
const { snapshot } = require('./helpers/recutFixtures');
const { recutQueue } = require('../src/services/recutQueue.service');
const { registerRecutReviewSteps } = require('../src/services/recutReviewSteps.service');
const env = require('../src/config/env');
let server, baseUrl, flag;
const pathFor = (f, tail) => `/api/v1/short-scripts/${f.script._id}/recut/${tail}`;
const bodyFor = (f, extra = {}) => ({ versionId: String(snapshot(f.script).currentVersionId), expectedRevision: snapshot(f.script).revision, ...extra });
const requests = (f) => [
  ['GET', 'review'], ['PATCH', 'selection', bodyFor(f, { changes: [{ sentenceId: 's7', action: 'add' }] })],
  ['POST', 'selection/restore', bodyFor(f)], ['POST', 'selection/apply', bodyFor(f)],
  ['POST', 'suggestions/apply', bodyFor(f, { suggestionIds: [newObjectId()] })], ['POST', 'approve-script', bodyFor(f)],
  ['POST', 'render', bodyFor(f)], ['POST', 'approve-asset', bodyFor(f, { assetId: newObjectId(), generationVersion: 1 })],
  ['POST', 'review-time', bodyFor(f, { action: 'start', phase: 'script_review' })],
];
const login = () => loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
describe('recut 教師審閱 API 與契約', () => {
  before(async () => { ({ server, baseUrl } = await startServer()); flag = env.shortScriptAutomationEnabled; });
  after(async () => { await recutQueue.idle(); await stopServer(server); env.shortScriptAutomationEnabled = flag; });
  beforeEach(async () => { await resetStore(); env.shortScriptAutomationEnabled = true; recutQueue.stop(); });
  afterEach(async () => { await recutQueue.idle(); });
  it('九個端點功能關閉回404', async () => {
    const f = await makeReview(); env.shortScriptAutomationEnabled = false;
    for (const [method, tail, body] of requests(f)) assert.equal((await jsonRequest(baseUrl, pathFor(f, tail), { method, body })).status, 404);
  });
  it('九個端點未登入回401', async () => {
    const f = await makeReview();
    for (const [method, tail, body] of requests(f)) assert.equal((await jsonRequest(baseUrl, pathFor(f, tail), { method, body })).status, 401);
  });
  for (const [email, password, who] of [['student@focusflow.local', 'Student123!', '學生'], ['teacher2@focusflow.local', 'Teacher123!', '其他教師']]) {
    it(`${who}操作九端點均403、不寫修改或核准`, async () => {
      const f = await makeReview(), token = await loginAs(baseUrl, email, password);
      for (const [method, tail, body] of requests(f)) assert.equal((await jsonRequest(baseUrl, pathFor(f, tail), { method, body, token })).status, 403, tail);
      assert.equal(store.recutReviewEvents.length, 0); assert.equal(store.recutApprovals.length, 0);
    });
  }
  it('教師讀取、修改、復原可重讀；過時revision回409', async () => {
    const f = await makeReview(), token = await login();
    const original = await jsonRequest(baseUrl, pathFor(f, 'review'), { token }); assert.equal(original.status, 200);
    assert.equal(original.body.data.current.durationSec, 37); assert.equal(original.body.data.draft, null);
    const old = bodyFor(f, { changes: [{ sentenceId: 's7', action: 'add' }] });
    const changed = await jsonRequest(baseUrl, pathFor(f, 'selection'), { method: 'PATCH', token, body: old });
    assert.equal(changed.status, 200); assert.equal(changed.body.data.draft.durationSec, 42);
    assert.equal((await jsonRequest(baseUrl, pathFor(f, 'selection'), { method: 'PATCH', token, body: old })).status, 409);
    const read = await jsonRequest(baseUrl, pathFor(f, 'review'), { token }); assert.equal(read.body.data.draft.id, changed.body.data.draft.id);
    const restore = await jsonRequest(baseUrl, pathFor(f, 'selection/restore'), { method: 'POST', token, body: bodyFor(f) });
    assert.equal(restore.status, 200); assert.equal(restore.body.data.draft, null);
  });
  it('管理員可審閱其他課程，兩次動作先核准講稿再排製作', async () => {
    const f = await makeReview(), token = await loginAs(baseUrl, 'admin@focusflow.local', 'Admin123!');
    assert.equal((await jsonRequest(baseUrl, pathFor(f, 'review'), { token })).status, 200);
    assert.equal((await jsonRequest(baseUrl, pathFor(f, 'approve-script'), { method: 'POST', token, body: bodyFor(f) })).status, 200);
    const render = await jsonRequest(baseUrl, pathFor(f, 'render'), { method: 'POST', token, body: bodyFor(f) });
    assert.equal(render.status, 200); assert.equal(render.body.data.recut.state, 'render_queued');
  });
  it('未套用修改核准409，未註冊RC4時套用503', async () => {
    const f = await makeReview(), token = await login();
    await jsonRequest(baseUrl, pathFor(f, 'selection'), { method: 'PATCH', token, body: bodyFor(f, { changes: [{ sentenceId: 's7', action: 'add' }] }) });
    assert.equal((await jsonRequest(baseUrl, pathFor(f, 'approve-script'), { method: 'POST', token, body: bodyFor(f) })).status, 409);
    assert.equal((await jsonRequest(baseUrl, pathFor(f, 'selection/apply'), { method: 'POST', token, body: bodyFor(f) })).status, 503);
  });
  it('套用回202任務，可用既有取消API回原版並保留草稿', async () => {
    const f = await makeReview(), token = await login();
    registerRecutReviewSteps({ cards: { id: 'route-review-cards', stage: 'cards', run: async () => ({}) },
      wholeCheck: { id: 'route-review-check', stage: 'wholeCheck', run: async () => { throw new Error('測試只排隊不執行'); } } });
    await jsonRequest(baseUrl, pathFor(f, 'selection'), { method: 'PATCH', token, body: bodyFor(f, { changes: [{ sentenceId: 's7', action: 'add' }] }) });
    const result = await jsonRequest(baseUrl, pathFor(f, 'selection/apply'), { method: 'POST', token, body: bodyFor(f) });
    assert.equal(result.status, 202); assert.equal(result.body.data.status, 'queued'); assert.equal(result.body.data.callLimit, 5);
    const cancel = await jsonRequest(baseUrl, pathFor(f, `tasks/${result.body.data.id}/cancel`), { method: 'POST', token, body: {} });
    assert.equal(cancel.status, 200); assert.equal(cancel.body.data.status, 'cancelled'); assert.ok(snapshot(f.script).pendingEditId);
  });
  it('整批採納建議回202並可取消，不直接製作或發布', async () => {
    const f = await makeReview(), s = await suggest(f), token = await login();
    const response = await jsonRequest(baseUrl, pathFor(f, 'suggestions/apply'), { method: 'POST', token, body: bodyFor(f, { suggestionIds: [String(s._id)] }) });
    assert.equal(response.status, 202); assert.equal(response.body.data.type, 'apply_suggestions');
    assert.equal((await jsonRequest(baseUrl, pathFor(f, `tasks/${response.body.data.id}/cancel`), { method: 'POST', token, body: {} })).status, 200);
  });
  it('實際成品精確核准回200，錯誤generation拒絕且不發布', async () => {
    const f = await makeReview(), token = await login();
    await jsonRequest(baseUrl, pathFor(f, 'approve-script'), { method: 'POST', token, body: bodyFor(f) });
    await jsonRequest(baseUrl, pathFor(f, 'render'), { method: 'POST', token, body: bodyFor(f) }); const asset = await assetFor(f);
    const send = (generationVersion) => jsonRequest(baseUrl, pathFor(f, 'approve-asset'), { method: 'POST', token, body: bodyFor(f, { assetId: String(asset._id), generationVersion }) });
    assert.equal((await send(2)).status, 409); const result = await send(1); assert.equal(result.status, 200);
    assert.equal(result.body.data.recut.state, 'asset_approved'); assert.equal(asset.status, 'draft');
  });
  it('惡意物件、額外欄位、未知句子、重複修改、錯誤原因及revision回400', async () => {
    const f = await makeReview(), token = await login();
    for (const body of [bodyFor(f, { changes: [{ sentenceId: { $ne: null }, action: 'add' }] }), bodyFor(f, { changes: [{ sentenceId: 's999', action: 'add' }] }),
      bodyFor(f, { changes: [{ sentenceId: 's7', action: 'add', reasonLabel: 'bad' }] }), bodyFor(f, { expectedRevision: true, changes: [{ sentenceId: 's7', action: 'add' }] }),
      bodyFor(f, { changes: [{ sentenceId: 's7', action: 'add' }, { sentenceId: 's7', action: 'remove' }] }), bodyFor(f, { changes: [], callLimit: 100 })]) {
      assert.equal((await jsonRequest(baseUrl, pathFor(f, 'selection'), { method: 'PATCH', token, body })).status, 400);
    }
    assert.equal(store.recutReviewEvents.length, 0);
  });
  it('舊版本建議與多餘確認ID拒絕，無權採納其他版本內容', async () => {
    const f = await makeReview(), other = await makeReview(), suggestion = await suggest(other), token = await login();
    for (const body of [bodyFor(f, { suggestionIds: [String(suggestion._id)] }), bodyFor(f, { suggestionIds: [newObjectId()], confirmedSelectionChangeIds: [newObjectId()] })]) {
      assert.equal((await jsonRequest(baseUrl, pathFor(f, 'suggestions/apply'), { method: 'POST', token, body })).status, 400);
    }
  });
  it('計時開始缺revision或停止缺timingId回400，不能自訂duration', async () => {
    const f = await makeReview(), token = await login();
    for (const body of [{ versionId: String(f.version._id), action: 'start', phase: 'script_review' },
      bodyFor(f, { action: 'stop', phase: 'script_review' }), bodyFor(f, { action: 'start', phase: 'script_review', durationMs: 3 })]) {
      assert.equal((await jsonRequest(baseUrl, pathFor(f, 'review-time'), { method: 'POST', token, body })).status, 400);
    }
    const start = await jsonRequest(baseUrl, pathFor(f, 'review-time'), { method: 'POST', token, body: bodyFor(f, { action: 'start', phase: 'script_review' }) });
    assert.equal(start.status, 200); assert.equal(start.body.data.durationMs, null);
    const stop = await jsonRequest(baseUrl, pathFor(f, 'review-time'), { method: 'POST', token, body: { versionId: String(f.version._id), action: 'stop', phase: 'script_review', timingId: start.body.data.id } });
    assert.equal(stop.status, 200); assert.ok(stop.body.data.durationMs >= 0);
  });
  it('不存在與格式錯誤的script ID分別回404、400', async () => {
    const token = await login();
    assert.equal((await jsonRequest(baseUrl, `/api/v1/short-scripts/${newObjectId()}/recut/review`, { token })).status, 404);
    assert.equal((await jsonRequest(baseUrl, '/api/v1/short-scripts/bad/recut/review', { token })).status, 400);
  });
});
