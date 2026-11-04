// Explicitly invoked with npm run test:line-login-mongo; never imports the stub harness.
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, it } = require('node:test');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const { ensureLineLoginStates } = require('../src/scripts/ensureLineLoginStates');
const User = require('../src/models/user.model');
const LineBindToken = require('../src/models/lineBindToken.model');
const LineLoginState = require('../src/models/lineLoginState.model');
const { bindLineAccount } = require('../src/services/line.service');

const uri = process.env.LINE_LOGIN_TEST_MONGODB_URI;
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(uri || '')) {
  throw new Error('LINE_LOGIN_TEST_MONGODB_URI must be a bare loopback MongoDB URI with an explicit port; Atlas is forbidden.');
}
const databaseName = `focusflow_line_login_test_${crypto.randomBytes(8).toString('hex')}`;
let client; let db;

async function createStudent(label) {
  // Native insertion leaves lineUserId missing, like imported accounts on Atlas.
  const { insertedId } = await db.collection('users').insertOne({
    name: label, email: `${label}-${crypto.randomUUID()}@example.invalid`,
    passwordHash: 'unused', role: 'student', isActive: true,
  });
  return String(insertedId);
}

// mongodb 與 mongoose 各帶一份 bson，ObjectId 不能互傳，一律經 mongoose 讀回。
function readUser(userId) {
  return User.findById(userId).lean();
}

before(async () => {
  client = new MongoClient(uri);
  await client.connect(); db = client.db(databaseName);
  await mongoose.connect(uri, { dbName: databaseName, autoIndex: false, autoCreate: false });
  await User.createCollection();
  await User.syncIndexes();
  await LineBindToken.createCollection();
});
after(async () => {
  await mongoose.disconnect();
  if (db && /^focusflow_line_login_test_[a-f0-9]{16}$/.test(db.databaseName)) await db.dropDatabase();
  await client?.close();
});

it('隔離 Mongo：建立索引可重複執行，TTL 設定衝突必須停止', async () => {
  const first = await ensureLineLoginStates(db); const second = await ensureLineLoginStates(db);
  assert.deepEqual(first, second);
  assert.equal(first.find((index) => index.key.expiresAt === 1).expireAfterSeconds, 0);
  const conflicting = client.db(`${databaseName}_conflict`);
  try {
    await conflicting.createCollection('lineLoginStates');
    await conflicting.collection('lineLoginStates').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 60 });
    await assert.rejects(ensureLineLoginStates(conflicting), /conflicting options/);
  } finally { await conflicting.dropDatabase(); }
});

it('A12 隔離 Mongo：同一個 state 同時消耗 20 次，只有一次拿得到紀錄', async () => {
  const _id = crypto.randomBytes(32).toString('hex');
  await LineLoginState.create({
    _id, userId: new mongoose.Types.ObjectId(), sid: 'a'.repeat(32), nonce: 'nonce',
    codeVerifier: 'verifier', expiresAt: new Date(Date.now() + 60000),
  });
  const results = await Promise.all(Array.from({ length: 20 }, () => LineLoginState.findOneAndDelete({ _id })));
  assert.equal(results.filter(Boolean).length, 1);
});

it('A12 隔離 Mongo：舊綁定碼同時兌換 20 次，只有一次拿得到紀錄', async () => {
  const token = crypto.randomBytes(32).toString('hex');
  await LineBindToken.create({ token, userId: new mongoose.Types.ObjectId(), expiresAt: new Date(Date.now() + 60000) });
  const results = await Promise.all(Array.from({ length: 20 }, () => LineBindToken.findOneAndDelete({ token })));
  assert.equal(results.filter(Boolean).length, 1);
});

it('A13 隔離 Mongo：同一個 LINE 同時綁 8 個帳號，unique index 只讓一個成功', async () => {
  const lineUserId = `U${crypto.randomBytes(16).toString('hex')}`;
  const userIds = await Promise.all(Array.from({ length: 8 }, (_, index) => createStudent(`race-${index}`)));
  const results = await Promise.all(userIds.map((userId) => bindLineAccount({ userId, lineUserId })));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.reason === 'line_bound_to_other_account').length, 7);
  assert.equal(await db.collection('users').countDocuments({ lineUserId }), 1);
});

it('A10 隔離 Mongo：同一個帳號同時改綁兩個 LINE，只有一個生效', async () => {
  const userId = await createStudent('replace');
  await bindLineAccount({ userId, lineUserId: `U${crypto.randomBytes(16).toString('hex')}` });
  const candidates = [`U${crypto.randomBytes(16).toString('hex')}`, `U${crypto.randomBytes(16).toString('hex')}`];
  const results = await Promise.all(candidates.map((lineUserId) => bindLineAccount({ userId, lineUserId, replaceExisting: true })));
  assert.equal(results.filter((result) => result.ok).length, 1);
  const stored = await readUser(userId);
  assert.equal(stored.lineUserId, candidates[results.findIndex((result) => result.ok)]);
});

it('A9 隔離 Mongo：拒絕搶綁時另一個帳號的綁定不變', async () => {
  const lineUserId = `U${crypto.randomBytes(16).toString('hex')}`;
  const owner = await createStudent('owner'); const other = await createStudent('other');
  await bindLineAccount({ userId: owner, lineUserId });
  const result = await bindLineAccount({ userId: other, lineUserId });
  assert.deepEqual(result, { ok: false, reason: 'line_bound_to_other_account' });
  assert.equal((await readUser(owner)).lineUserId, lineUserId);
  assert.equal((await readUser(other)).lineUserId, undefined);
});
