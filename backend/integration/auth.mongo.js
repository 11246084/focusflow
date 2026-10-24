// Explicitly invoked with npm run test:auth-mongo; never imports the stub harness.
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, it } = require('node:test');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const { ensureAuthSessions } = require('../src/scripts/ensureAuthSessions');
const User = require('../src/models/user.model');
const AuthSession = require('../src/models/authSession.model');
const Audit = require('../src/models/adminAuditLog.model');
const { issueSession, revokeAll } = require('../src/services/authTokens.service');
const pending = require('../src/services/pendingVerification.service');
const mailer = require('../src/services/mailer.service');
const { reserveMail } = require('../src/services/verificationMail.service');

const uri = process.env.AUTH_TEST_MONGODB_URI;
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(uri || '')) {
  throw new Error('AUTH_TEST_MONGODB_URI must be a bare loopback MongoDB URI with an explicit port; Atlas is forbidden.');
}
const databaseName = `focusflow_auth_test_${crypto.randomBytes(8).toString('hex')}`;
let client; let db; let user; let code;
before(async () => {
  client = new MongoClient(uri);
  await client.connect(); db = client.db(databaseName);
  await mongoose.connect(uri, { dbName: databaseName, autoIndex: false, autoCreate: false });
  await User.createCollection(); await Audit.createCollection();
  mailer.setTransportForTests({ sendMail: async (mail) => { code = mail.subject.match(/^\d{6}/)[0]; } });
  // Native insertion deliberately leaves all new fields missing, as on Atlas
  // before rollout. Mongoose defaults must not prevent CAS on these accounts.
  const inserted = await db.collection('users').insertOne({ name: 'Local test', email: 'local@example.invalid',
    passwordHash: 'unused', role: 'student', isActive: true });
  user = await User.findById(String(inserted.insertedId));
});
after(async () => {
  mailer.setTransportForTests(null);
  await mongoose.disconnect();
  if (db && /^focusflow_auth_test_[a-f0-9]{16}$/.test(db.databaseName)) await db.dropDatabase();
  await client?.close();
});
it('隔離 Mongo：建立索引可重複執行，TTL 設定衝突必須停止', async () => {
  const first = await ensureAuthSessions(db); const second = await ensureAuthSessions(db);
  assert.deepEqual(first, second);
  assert.equal(first.find((index) => index.key.expiresAt === 1).expireAfterSeconds, 0);
  const conflicting = client.db(`${databaseName}_conflict`);
  try {
    await conflicting.createCollection('authSessions');
    await conflicting.collection('authSessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 60 });
    await assert.rejects(ensureAuthSessions(conflicting), /conflicting options/);
    assert.equal((await conflicting.collection('authSessions').indexes()).find((index) => index.key.expiresAt).expireAfterSeconds, 60);
  } finally { await conflicting.dropDatabase(); }
});
it('隔離 Mongo：過期 session 由真實 TTL monitor 清除', async () => {
  const id = crypto.randomBytes(16).toString('hex');
  await AuthSession.create({ _id: id, userId: user._id, createdAt: new Date(), expiresAt: new Date(Date.now() - 1000) });
  const deadline = Date.now() + 15000;
  while (await AuthSession.exists({ _id: id })) {
    if (Date.now() > deadline) throw new Error('TTL monitor did not delete the expired session within 15 seconds.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});
it('隔離 Mongo：同帳號 80 次並行簽發後最多 20 筆', async () => {
  await Promise.all(Array.from({ length: 80 }, () => issueSession(user)));
  assert.ok(await AuthSession.countDocuments({ userId: user._id }) <= 20);
});
it('隔離 Mongo：舊帳號原子驗證碼只能成功消耗一次', async () => {
  const started = await pending.begin(user, 'email_verify');
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => pending.verify({ token: started.pendingToken, code })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await User.findById(user._id)).pendingVerification, null);
});
it('隔離 Mongo：重寄限制的原子更新與 legacy 預設值', async () => {
  // Successful verification resets to -1: one initial email plus five resends.
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => reserveMail(user._id)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 6);
  assert.equal((await User.findById(user._id)).verificationMail.resendCount, 5);
});
it('隔離 Mongo：並行 $inc 不遺失版本，撤銷後沒有 session', async () => {
  await Promise.all(Array.from({ length: 10 }, () => revokeAll(user._id)));
  assert.equal((await User.findById(user._id)).tokenVersion, 10);
  assert.equal(await AuthSession.countDocuments({ userId: user._id }), 0);
});
it('隔離 Mongo：同時停用其他管理員仍保留至少一位啟用中的管理員', async () => {
  const adminService = require('../src/services/admin.service');
  const admins = await User.create([
    { name: 'Local admin A', email: 'admin-a@example.invalid', role: 'admin', isActive: true, passwordHash: 'unused', mustChangePassword: false },
    { name: 'Local admin B', email: 'admin-b@example.invalid', role: 'admin', isActive: true, passwordHash: 'unused', mustChangePassword: false },
  ]);
  const results = await Promise.allSettled([
    adminService.updateUser(String(admins[0]._id), { isActive: false }, { id: String(admins[1]._id) }),
    adminService.updateUser(String(admins[1]._id), { isActive: false }, { id: String(admins[0]._id) }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await User.countDocuments({ role: 'admin', isActive: true }), 1);
});
