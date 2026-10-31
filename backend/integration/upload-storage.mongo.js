const loopbackFetch = global.fetch;
const { env } = require('./helpers/youtubeReviewFixture');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const { assertLoopbackMongoUri } = require('./helpers/isolatedYouTubeMongo');
const { MongoClient } = require('mongodb');
const crypto = require('node:crypto');
const Setting = require('../src/models/runtimeSetting.model');
const storage = require('../src/services/uploadStorage.service');
let isolated; let root;
const originalStatfs = fs.promises.statfs;
before(async () => {
  const uri = assertLoopbackMongoUri(process.env.YOUTUBE_TEST_MONGODB_URI);
  const client = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const databaseName = `focusflow_youtube_test_${crypto.randomBytes(8).toString('hex')}`;
  const db = client.db(databaseName);
  await db.createCollection('testMarker');
  isolated = { databaseName, close: async () => {
    if (!/^focusflow_youtube_test_[a-f0-9]{16}$/.test(db.databaseName) || db.databaseName !== databaseName) throw new Error('Refusing to drop an unowned database.');
    try { await db.dropDatabase(); } finally { await client.close(); }
  } };
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-qc-mongo-'));
  env.uploadDir = root; env.uploadSpaceFactor = 1;
  // Isolate capacity math from unrelated Docker/log writes on the host disk.
  // Files and Mongo CAS remain real; only the available-space provider is fixed.
  fs.promises.statfs = async target => path.resolve(target).toLowerCase() === path.resolve(root).toLowerCase()
    ? { bavail: 10000000, bsize: 1 } : originalStatfs(target);
  env.uploadMinFreeGb = 9000000 / 1024 ** 3;
  await mongoose.connect(process.env.YOUTUBE_TEST_MONGODB_URI, { dbName: isolated.databaseName, autoIndex: false, autoCreate: false, directConnection: true });
  await mongoose.connection.db.createCollection('runtimesettings');
  await Setting.collection.createIndex({ key: 1 }, { unique: true });
});
after(async () => {
  fs.promises.statfs = originalStatfs;
  await mongoose.disconnect();
  await isolated?.close();
  if (root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('ff-qc-mongo-')) fs.rmSync(root, { recursive: true, force: true });
});
test('parallel Mongo reservations admit only one and release capacity', async () => {
  const results = await Promise.allSettled([storage.reserve(700000), storage.reserve(700000)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.find((item) => item.status === 'rejected').reason.code, 'UPLOAD_STORAGE_LOW');
  const token = results.find((item) => item.status === 'fulfilled').value;
  await storage.heartbeat(token);
  assert.equal((await storage.status()).reservedBytes, 700000);
  await storage.release(token);
  assert.equal((await storage.status()).reservedBytes, 0);
});


test('incoming cleanup removes only old, unreserved regular files', async () => {
  const incoming = path.join(root, '.incoming'); fs.mkdirSync(incoming, { recursive: true });
  const oldToken = crypto.randomUUID(); const active = await storage.reserve(100);
  const oldFile = path.join(incoming, `${oldToken}--orphan.mp4`);
  const activeFile = path.join(incoming, `${active}--active.mp4`);
  const recentFile = path.join(incoming, `${crypto.randomUUID()}--recent.mp4`);
  const finalFile = path.join(root, `${oldToken}--final.mp4`);
  for (const file of [oldFile, activeFile, recentFile, finalFile]) fs.writeFileSync(file, 'video');
  const oldDate = new Date(Date.now() - 4 * 60 * 60 * 1000);
  for (const file of [oldFile, activeFile, finalFile]) fs.utimesSync(file, oldDate, oldDate);
  await storage.cleanupIncoming();
  assert.equal(fs.existsSync(oldFile), false);
  for (const file of [activeFile, recentFile, finalFile]) assert.equal(fs.existsSync(file), true);
  await storage.release(active);
});
const express = require('express');
const { Writable } = require('node:stream');
const { uploadSingleVideo, uploadVideoBatch } = require('../src/middleware/upload.middleware');
async function uploadServer() {
  const app = express();
  app.post('/single', uploadSingleVideo, (req, res) => res.json({ file: req.file?.filename }));
  app.post('/batch', uploadVideoBatch, (req, res) => res.json({ files: req.files.map((file) => file.filename) }));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
function form(field, count = 1) {
  const data = new FormData();
  for (let i = 0; i < count; i += 1) data.append(field, new Blob(['test-media'], { type: 'video/mp4' }), `${i}.mp4`);
  return data;
}
test('ENOSPC is reported as 507 and releases reservation without a final file', async () => {
  const { server, base } = await uploadServer();
  const original = fs.createWriteStream;
  try {
    fs.createWriteStream = () => {
      const output = new Writable({ write(chunk, encoding, callback) { const error = new Error('disk full'); error.code = 'ENOSPC'; callback(error); } });
      return output;
    };
    const response = await loopbackFetch(`${base}/single`, { method: 'POST', body: form('video') });
    assert.equal(response.status, 507); assert.equal((await response.json()).code, 'UPLOAD_STORAGE_LOW');
    assert.equal((await storage.status()).reservedBytes, 0);
    assert.deepEqual(fs.readdirSync(root).filter((name) => name.endsWith('-0.mp4')), []);
  } finally { fs.createWriteStream = original; await new Promise((resolve) => server.close(resolve)); }
});
test('second batch rename failure removes both already moved and incoming files', async () => {
  const { server, base } = await uploadServer();
  const original = fs.promises.rename;
  let count = 0;
  try {
    fs.promises.rename = async (...args) => { if (++count === 2) { const error = new Error('rename failed'); error.code = 'EIO'; throw error; } return original(...args); };
    const response = await loopbackFetch(`${base}/batch`, { method: 'POST', body: form('videos', 2) });
    assert.equal(response.status, 500);
    assert.equal((await storage.status()).reservedBytes, 0);
    const created = fs.readdirSync(root).filter((name) => /-[01]\.mp4$/.test(name));
    assert.deepEqual(created, []);
    const incoming = fs.readdirSync(path.join(root, '.incoming')).filter((name) => /-[01]\.mp4$/.test(name));
    assert.deepEqual(incoming, []);
  } finally { fs.promises.rename = original; await new Promise((resolve) => server.close(resolve)); }
});
const http = require('node:http');
const multer = require('multer');
const { guardedUpload } = require('../src/middleware/upload.middleware');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test('continued upload renews reservation and idle request abort releases it', async () => {
  const app = express();
  app.post('/slow', guardedUpload(multer().none(), 1024, { idleMs: 180, heartbeatMs: 40 }), (req, res) => res.end('ok'));
  app.use((err, req, res, next) => res.status(err.statusCode || 500).end());
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const original = storage.heartbeat; let heartbeats = 0;
  storage.heartbeat = async (...args) => { heartbeats += 1; return original(...args); };
  try {
    const request = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/slow', headers: { 'content-type': 'multipart/form-data; boundary=slowtest', 'content-length': '500' } });
    const ended = new Promise((resolve) => { request.on('error', resolve); request.on('response', resolve); });
    request.write('--slowtest\r\nContent-Disposition: form-data; name="data"\r\n\r\na');
    await pause(100); request.write('b'); await pause(100); request.write('c'); await pause(100);
    assert.ok(heartbeats >= 2, `Expected heartbeat on progress, got ${heartbeats}`);
    assert.ok((await storage.status()).reservedBytes > 0);
    await ended;
    for (let i = 0; i < 20 && (await storage.status()).reservedBytes; i += 1) await pause(20);
    assert.equal((await storage.status()).reservedBytes, 0);
  } finally { storage.heartbeat = original; await new Promise((resolve) => server.close(resolve)); }
});
test('client disconnect during file upload removes partial file and releases reservation', async () => {
  const { server, base } = await uploadServer();
  try {
    const target = new URL(base);
    const request = http.request({ host: '127.0.0.1', port: target.port, method: 'POST', path: '/single', headers: { 'content-type': 'multipart/form-data; boundary=aborttest', 'content-length': '50000' } });
    request.on('error', () => {});
    request.write('--aborttest\r\nContent-Disposition: form-data; name="video"; filename="abort.mp4"\r\nContent-Type: video/mp4\r\n\r\npartial');
    for (let i = 0; i < 30 && (await storage.status()).reservedBytes === 0; i += 1) await pause(20);
    assert.ok((await storage.status()).reservedBytes > 0);
    request.destroy();
    for (let i = 0; i < 50 && (await storage.status()).reservedBytes > 0; i += 1) await pause(20);
    for (let i = 0; i < 50 && fs.readdirSync(path.join(root, '.incoming')).some((name) => name.endsWith('-abort.mp4')); i += 1) await pause(20);
    assert.equal((await storage.status()).reservedBytes, 0);
    assert.equal(fs.readdirSync(path.join(root, '.incoming')).some((name) => name.endsWith('-abort.mp4')), false);
    assert.equal(fs.readdirSync(root).some((name) => name.endsWith('-abort.mp4')), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test('completion waits for an in-flight heartbeat before releasing reservation', async () => {
  const app = express();
  app.post('/complete', guardedUpload(multer().none(), 1024, { idleMs: 1000, heartbeatMs: 20 }), (req, res) => res.end('ok'));
  app.use((err, req, res, next) => res.status(err.statusCode || 500).end());
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const original = storage.heartbeat; let heartbeatStarted = false;
  storage.heartbeat = async (...args) => { heartbeatStarted = true; await pause(100); return original(...args); };
  try {
    const start = '--hbtest\r\nContent-Disposition: form-data; name="data"\r\n\r\na';
    const middle = 'b'; const end = '\r\n--hbtest--\r\n';
    const result = new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/complete', headers: { 'content-type': 'multipart/form-data; boundary=hbtest', 'content-length': Buffer.byteLength(start + middle + end) } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      request.on('error', reject);
      request.write(start);
      setTimeout(() => { request.write(middle); setTimeout(() => request.end(end), 20); }, 60);
    });
    assert.equal(await result, 200); assert.equal(heartbeatStarted, true);
    assert.equal((await storage.status()).reservedBytes, 0);
  } finally { storage.heartbeat = original; await new Promise((resolve) => server.close(resolve)); }
});
