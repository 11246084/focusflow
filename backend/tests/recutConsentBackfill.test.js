const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runBackfill } = require('../src/scripts/recutConsentBackfill');
const { fixture, ids } = require('./helpers/recutConsentFake');
const entries = [{ teacherId: ids.teacher, courseId: ids.course, kind: 'voice', choice: 'original', evidenceRef: '教授書面同意 登記A', requestId: 'paper-consent-A-voice' }];

test('補登預設dry-run零寫入，不從舊disclosure推定聲音同意', async () => {
  let calls = 0;
  const result = await runBackfill({ entries, service: { recordConsent: async () => { calls += 1; } } });
  assert.equal(result.writes, 0);
  assert.equal(calls, 0);
  assert.equal(result.plan[0].choice, 'original');
  await assert.rejects(runBackfill({ entries: [{ ...entries[0], choice: undefined, consentConfirmed: true }] }), /explicit choice/);
});

test('執行需另行授權與isolated-local，fake repository可驗證冪等寫入', async () => {
  const f = fixture();
  const input = { entries, service: f.service, user: f.admin, dryRun: false, authorized: true, target: 'isolated-local' };
  await assert.rejects(runBackfill({ ...input, authorized: false }), /separate authorization/);
  await assert.rejects(runBackfill({ ...input, target: 'shared-atlas' }), /Shared Atlas is prohibited/);
  await runBackfill(input);
  await runBackfill(input);
  assert.equal((await f.repository.read(ids.teacher)).records.length, 1);
  assert.equal((await f.repository.read(ids.teacher)).records[0].actorId, ids.admin);
});
