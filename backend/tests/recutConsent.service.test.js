const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, ids } = require('./helpers/recutConsentFake');
const { createRecutConsentService } = require('../src/services/recutConsent.service');
const { TERMS_VERSION } = require('../src/constants/recutConsent');
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test('內容同意為上傳前提，歷史 disclosure 不能推定聲音同意', async () => {
  const f = fixture();
  await rejectsCode(f.service.assertConsentForWork({ courseId: ids.course, contentOnly: true }), 'RECUT_CONTENT_CONSENT_REQUIRED');
  await f.grant();
  await f.service.assertConsentForWork({ courseId: ids.course, contentOnly: true });
  await rejectsCode(f.service.assertConsentForWork({ courseId: ids.course, voiceMode: 'original', consentConfirmed: true }), 'RECUT_VOICE_CONSENT_REQUIRED');
});

test('聲音偏好按教師全域記憶，改選保留原紀錄，合成語音未就緒不得退回原音', async () => {
  const f = fixture();
  await f.grant();
  await f.grant('voice', 'original');
  assert.equal((await f.service.getConsent({ ...f.base, courseId: ids.secondCourse })).voiceMode, 'original');
  await f.service.assertConsentForWork({ courseId: ids.course, voiceMode: 'original' });
  await f.grant('voice', 'synthetic', { courseId: ids.secondCourse });
  await rejectsCode(f.service.assertConsentForWork({ courseId: ids.course, voiceMode: 'original' }), 'RECUT_VOICE_CONSENT_REQUIRED');
  await rejectsCode(f.service.assertConsentForWork({ courseId: ids.course, syntheticReady: true }), 'RECUT_SYNTHETIC_VOICE_NOT_READY');
  const state = await f.repository.read(ids.teacher);
  assert.deepEqual(state.records.filter((item) => item.kind === 'voice').map((item) => item.choice), ['original', 'synthetic']);
  assert.equal(state.records[0].actorId, ids.teacher);
  assert.equal(state.records[0].termsVersion, TERMS_VERSION);
  assert.ok(Number.isFinite(Date.parse(state.records[0].recordedAt)));
});

test('數位分身肖像與聲音複製同意分開，原音同意不能替代', async () => {
  const f = fixture();
  await f.grant();
  await f.grant('voice', 'original');
  await f.grant('avatarLikeness');
  await rejectsCode(f.service.assertConsentForWork({ courseId: ids.course, avatar: true }), 'RECUT_AVATAR_CONSENT_REQUIRED');
  await f.grant('voiceClone');
  await f.service.assertConsentForWork({ courseId: ids.course, avatar: true });
  assert.equal((await f.service.getConsent(f.base)).decisions.voiceClone.choice, 'granted');
});

test('課程教師與管理員隔離，來源必須屬於該課程，禁止指定別人的 teacherId', async () => {
  const f = fixture();
  for (const user of [{ id: ids.teacher, role: 'student' }, { id: ids.otherTeacher, role: 'teacher' }]) {
    await rejectsCode(f.service.getConsent({ ...f.base, user }), 'COURSE_MANAGE_DENIED');
  }
  await rejectsCode(f.grant('content', 'granted', { videoId: ids.otherVideo }), 'VIDEO_NOT_FOUND');
  await rejectsCode(f.grant('content', 'granted', { sourceId: 'foreign-lecture' }), 'VIDEO_NOT_FOUND');
  await rejectsCode(f.grant('voice', 'original', { teacherId: ids.otherTeacher }), 'COURSE_MANAGE_DENIED');
  await f.grant('content', 'granted', { user: f.admin, evidenceRef: '教授書面同意 登記單A' });
  await rejectsCode(f.grant('content', 'granted', { evidenceRef: 'fake' }), 'VALIDATION_ERROR');
  await rejectsCode(f.service.assertConsentForWork({ courseId: ids.course, contentOnly: true, teacherId: ids.otherTeacher }), 'COURSE_MANAGE_DENIED');
});

test('影片與 sourceId 同義解析，影片同意不外溢至整門課', async () => {
  const f = fixture();
  await f.grant('content', 'granted', { videoId: ids.video });
  await f.service.assertConsentForWork({ courseId: ids.course, sourceId: 'lecture-one', contentOnly: true });
  await rejectsCode(f.service.assertConsentForWork({ courseId: ids.course, contentOnly: true }), 'RECUT_CONTENT_CONSENT_REQUIRED');
  await rejectsCode(f.service.assertConsentForWork({ courseId: ids.secondCourse, contentOnly: true }), 'RECUT_CONTENT_CONSENT_REQUIRED');
});

test('條款版本與requestId驗證，重送冪等而不同內容衝突', async () => {
  const f = fixture();
  const input = { ...f.base, kind: 'voice', choice: 'original', requestId: 'stable-choice' };
  await f.service.recordConsent(input);
  await f.service.recordConsent(input);
  assert.equal((await f.repository.read(ids.teacher)).records.length, 1);
  await rejectsCode(f.service.recordConsent({ ...input, choice: 'synthetic' }), 'RECUT_CONSENT_IDEMPOTENCY_CONFLICT');
  await rejectsCode(f.service.recordConsent({ ...input, termsVersion: 'old' }), 'RECUT_CONSENT_TERMS_OUTDATED');
  await rejectsCode(f.service.recordConsent({ ...input, requestId: '' }), 'VALIDATION_ERROR');
});

test('撤回先寫禁止狀態，預設不選任何成品，但停止所有處理中及未上架工作', async () => {
  const f = fixture();
  await f.grant();
  await f.grant('voice', 'original');
  const list = await f.service.listWithdrawalAssets({ ...f.base, kind: 'voice' });
  assert.equal(list.selectAll, false);
  assert.ok(list.assets.every((item) => item.selected === false));
  f.lifecycle.stopWork = async (scope) => {
    assert.equal(scope.courseId, null);
    await rejectsCode(f.service.assertConsentForWork({ courseId: ids.course, voiceMode: 'original' }), 'RECUT_VOICE_CONSENT_REQUIRED');
    f.calls.push(['stopWork']);
  };
  f.service.configureLifecycle(f.lifecycle);
  const job = await f.withdraw();
  assert.equal(job.status, 'completed');
  assert.deepEqual(job.selectedAssetIds, []);
  assert.equal(f.calls.filter((item) => item[0] === 'stopWork').length, 1);
  assert.equal(f.calls.filter((item) => item[0] === 'archiveAsset' || item[0] === 'makeYouTubePrivate').length, 0);
  assert.equal((await f.repository.read(ids.teacher)).records.at(-1).choice, 'withdrawn');
});

test('逐支與顯式全選凍結選單，拒絕外課成品', async () => {
  const f = fixture();
  await rejectsCode(f.withdraw({ selectedAssetIds: [ids.foreignAsset] }), 'RECUT_WITHDRAWAL_ASSET_DENIED');
  const first = await f.withdraw({ selectedAssetIds: [ids.asset] });
  assert.deepEqual(first.selectedAssetIds, [ids.asset]);
  const all = await f.withdraw({ selectAll: true });
  assert.deepEqual(all.selectedAssetIds, [ids.asset, ids.secondAsset]);
  assert.deepEqual(f.calls.filter((item) => item[0] === 'archiveAsset').map((item) => item[1]), [ids.asset, ids.asset, ids.secondAsset]);
});

test('轉私人失敗逐位通知admin並持久化手動待辦，重試清待辦不重複通知', async () => {
  const f = fixture();
  f.setPrivacyFails(true);
  const input = { ...f.base, kind: 'voice', requestId: 'privacy-failure', selectedAssetIds: [ids.asset] };
  const failed = await f.service.withdraw(input);
  assert.equal(failed.status, 'pending');
  assert.deepEqual(f.calls.filter((item) => item[0] === 'notifyAdmin').map((item) => item[1]).sort(), [ids.admin, ids.secondAdmin].sort());
  const pending = await f.service.listManualActions({ user: f.admin });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].assetId, ids.asset);
  await rejectsCode(f.service.listManualActions({ user: f.teacher }), 'FORBIDDEN');
  await rejectsCode(f.grant('voice', 'original'), 'RECUT_CONSENT_WITHDRAWAL_PENDING');
  await f.service.withdraw(input);
  assert.equal(f.calls.filter((item) => item[0] === 'notifyAdmin').length, 2);
  f.setPrivacyFails(false);
  const resumed = createRecutConsentService({ repository: f.repository, lifecycle: f.lifecycle });
  assert.equal((await resumed.recoverPendingWithdrawals())[0].status, 'completed');
  assert.deepEqual(await resumed.listManualActions({ user: f.admin }), []);
  assert.equal(f.calls.filter((item) => item[0] === 'archiveAsset').length, 1);
  assert.equal((await f.repository.read(ids.teacher)).records.length, 1);
});

test('管理員列舉與通知失敗留下outbox，可在新service恢復', async () => {
  const f = fixture();
  f.setPrivacyFails(true);
  f.lifecycle.listAdmins = async () => { throw new Error('offline'); };
  f.service.configureLifecycle(f.lifecycle);
  const job = await f.withdraw({ selectedAssetIds: [ids.asset] });
  assert.equal(job.adminEnumerationError, true);
  f.lifecycle.listAdmins = async () => [ids.admin, ids.secondAdmin];
  const delivered = [];
  f.lifecycle.notifyAdmin = async (adminId) => {
    if (adminId === ids.secondAdmin) throw new Error('delivery unavailable');
    delivered.push(adminId);
  };
  const service = createRecutConsentService({ repository: f.repository, lifecycle: f.lifecycle });
  const pending = await service.retryWithdrawal({ ...f.base, withdrawalId: job.id });
  assert.equal(pending.actions.filter((item) => item.type === 'notifyAdmin' && item.status === 'failed').length, 1);
  f.setPrivacyFails(false);
  f.lifecycle.notifyAdmin = async (adminId) => { delivered.push(adminId); };
  const restart = createRecutConsentService({ repository: f.repository, lifecycle: f.lifecycle });
  const done = await restart.retryWithdrawal({ ...f.base, withdrawalId: job.id });
  assert.equal(done.status, 'completed');
  assert.deepEqual(delivered, [ids.admin, ids.secondAdmin]);
});

test('不同service同時撤回相同request只記一筆且lease防止重複副作用', async () => {
  const f = fixture();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  f.lifecycle.stopWork = async () => { f.calls.push(['stopWork']); entered(); await gate; };
  f.service.configureLifecycle(f.lifecycle);
  const other = createRecutConsentService({ repository: f.repository, lifecycle: f.lifecycle });
  const input = { ...f.base, kind: 'voice', requestId: 'race' };
  const first = f.service.withdraw(input);
  await started;
  const second = await other.withdraw(input);
  assert.equal(second.status, 'processing');
  release();
  assert.equal((await first).status, 'completed');
  assert.equal(f.calls.filter((item) => item[0] === 'stopWork').length, 1);
  assert.equal((await f.repository.read(ids.teacher)).records.length, 1);
});

test('外部動作後持久化中斷，lease到期後以穩定operationId恢復', async () => {
  const f = fixture();
  const commit = f.repository.commit;
  let crash = false;
  f.lifecycle.archiveAsset = async (id, scope, context) => { f.calls.push(['archiveAsset', id, context]); crash = true; };
  f.repository.commit = async (...args) => { if (crash) throw new Error('simulated database interruption'); return commit(...args); };
  f.service.configureLifecycle(f.lifecycle);
  await assert.rejects(f.withdraw({ selectedAssetIds: [ids.asset] }), /database interruption/);
  crash = false;
  f.repository.commit = commit;
  f.lifecycle.archiveAsset = async (id, scope, context) => { f.calls.push(['archiveAsset', id, context]); };
  const recovered = createRecutConsentService({ repository: f.repository, lifecycle: f.lifecycle, now: () => new Date(Date.now() + 60000) });
  assert.equal((await recovered.recoverPendingWithdrawals())[0].status, 'completed');
  const archive = f.calls.filter((item) => item[0] === 'archiveAsset');
  assert.equal(archive.length, 2);
  assert.equal(archive[0][2].operationId, archive[1][2].operationId);
});

test('併發同意與撤回使用CAS，所有紀錄保留且最後撤回禁止新工作', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 12 }, (_, index) => f.grant('voice', index % 2 ? 'original' : 'synthetic')));
  assert.equal((await f.repository.read(ids.teacher)).records.length, 12);
  await f.grant();
  await f.withdraw();
  await rejectsCode(f.service.assertConsentForWork({ courseId: ids.course, voiceMode: 'original' }), 'RECUT_VOICE_CONSENT_REQUIRED');
  assert.equal((await f.repository.read(ids.teacher)).records.length, 14);
});

test('未接生命周期時fail closed，不能把未執行動作當完成', async () => {
  const f = fixture();
  const service = createRecutConsentService({ repository: f.repository });
  await rejectsCode(service.withdraw({ ...f.base, kind: 'voice', requestId: 'not-configured' }), 'RECUT_CONSENT_LIFECYCLE_UNAVAILABLE');
});
