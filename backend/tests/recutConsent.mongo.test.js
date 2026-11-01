const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { connect } = require('./helpers/recutConsentMongo');
const { fixture, ids } = require('./helpers/recutConsentFake');
const { createRecutConsentService } = require('../src/services/recutConsent.service');

function child(dbName, worker) {
  return new Promise((resolve, reject) => {
    const task = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures/recutConsentNoDotenv.cjs'),
      path.join(__dirname, 'fixtures/recutConsentMongoChild.cjs'), dbName, worker], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = ''; let errors = '';
    task.stdout.on('data', (data) => { output += data; });
    task.stderr.on('data', (data) => { errors += data; });
    task.once('error', reject);
    task.once('close', (code) => code === 0 ? resolve(output) : reject(new Error(`child ${worker} exited ${code}: ${errors}`)));
  });
}

test('專用loopback Mongo跨程序CAS保留16筆，混合完成與待辦仍可恢復', {
  skip: process.env.RECUT_CONSENT_LOCAL_MONGO_TEST !== '1' ? 'Explicit dedicated loopback Mongo opt-in required.' : false,
  timeout: 30000,
}, async () => {
  const dbName = `recut_consent_test_${randomBytes(8).toString('hex')}`;
  const f = await connect(dbName);
  try {
    // Index writes are explicit and confined to this random dedicated local DB.
    await f.models.ConsentModel.createCollection();
    await f.models.ConsentModel.collection.createIndex({ teacherId: 1 }, { unique: true });
    await f.models.CourseModel.create({ _id: ids.course, teacherId: ids.teacher, title: 'RC10 isolated test' });
    const output = await Promise.all([child(dbName, 'a'), child(dbName, 'b')]);
    assert.deepEqual(output.sort(), ['worker-a:8\n', 'worker-b:8\n']);
    const before = await f.repository.read(ids.teacher);
    assert.equal(before.records.length, 16);
    assert.equal(before.revision, 16);
    assert.equal(new Set(before.records.map((record) => record.requestId)).size, 16);
    const fake = fixture();
    const service = createRecutConsentService({ repository: f.repository, lifecycle: fake.lifecycle });
    const input = { ...fake.base, kind: 'voice', requestId: 'mongo-completed' };
    assert.equal((await service.withdraw(input)).status, 'completed');
    fake.setPrivacyFails(true);
    const pending = await service.withdraw({ ...input, requestId: 'mongo-pending', selectedAssetIds: [ids.asset] });
    assert.equal(pending.status, 'pending');
    assert.equal((await f.repository.listPending()).length, 1);
    assert.equal((await service.listManualActions({ user: fake.admin })).length, 1);
    fake.setPrivacyFails(false);
    const restarted = createRecutConsentService({ repository: f.repository, lifecycle: fake.lifecycle });
    assert.equal((await restarted.recoverPendingWithdrawals())[0].status, 'completed');
    assert.equal((await f.repository.read(ids.teacher)).records.length, 18);
    assert.equal((await f.repository.listPending()).length, 0);
    assert.equal((await f.repository.listManualActions()).length, 0);
    assert.equal(fake.calls.filter((call) => call[0] === 'notifyAdmin').length, 2);
  } finally { await f.connection.close(); }
});
