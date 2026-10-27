// Regression of the independent NR01/NR02 review. Real Mongo, independent Node
// processes, fake YouTube, and sources owned exclusively by this test suite.
const { env, deferred, fakeYouTube } = require('./helpers/youtubeReviewFixture');
const assert = require('node:assert/strict');
const { before, beforeEach, after, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const mongoose = require('mongoose');
const { assertLoopbackMongoUri, openIsolatedYouTubeMongo } = require('./helpers/isolatedYouTubeMongo');
const Video = require('../src/models/video.model');
const ShortAsset = require('../src/models/shortAsset.model');
const Setting = require('../src/models/runtimeSetting.model');
const cleanup = require('../src/services/localSourceCleanup.service');
const lifecycle = require('../src/services/youtubeLifecycle.service');
const upload = require('../src/services/youtubeUpload.service');
const shortCleanup = require('../src/services/shortAssetCleanup.service');
const { restoreVideoSource } = require('../src/services/video.service');
const { deleteCourse } = require('../src/services/course.service');
const Course = require('../src/models/course.model');
const Job = require('../src/models/courseDeletionJob.model');
const Faq = require('../src/models/faq.model');
const VideoSegment = require('../src/models/videoSegment.model');
const VideoSegmentVideo = require('../src/models/videoSegmentVideo.model');
const { runCourseDeletionJobs } = require('../src/services/courseDeletionJobs.service');
const { reserveYouTubeBackup } = require('../src/services/youtubeWorkOwnership.service');
const uri = assertLoopbackMongoUri(process.env.YOUTUBE_TEST_MONGODB_URI);
let isolated; let db; let root;
const children = new Set();
const courseId = new mongoose.Types.ObjectId(); const teacherId = new mongoose.Types.ObjectId();
const course = { _id: courseId, teacherId, title: 'Atomicity fixture', status: 'published', videoIds: [] };
const collections = ['videos', 'shortassets', 'runtimesettings', 'courses', 'users', 'notifications', 'youtubebackups', 'enrollments', 'faqs', 'coursedeletionjobs', 'testRemoteWrites', VideoSegment.collection.name, VideoSegmentVideo.collection.name];
const mp4 = Buffer.concat(['ftyp', 'mdat', 'moov'].map((type) => { const b = Buffer.alloc(8); b.writeUInt32BE(8); b.write(type, 4); return b; }));
function file() { const p = path.join(root, `${new mongoose.Types.ObjectId()}.mp4`); fs.writeFileSync(p, mp4); return p; }
async function insert(kind, extra = {}) {
  const item = { _id: new mongoose.Types.ObjectId(), courseId, uploadedBy: teacherId, title: 'Fixture', sourceType: 'upload', filePath: file(),
    youtubeVideoId: 'backup00001', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') },
    ...(kind === 'video' ? { processing: { status: 'completed' } } : { status: 'published', generationVersion: 1 }), ...extra };
  await db.collection(kind === 'video' ? 'videos' : 'shortassets').insertOne(item); return item;
}
function worker(config) {
  const child = fork(path.join(__dirname, 'helpers/youtubeAtomicityWorker.js'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
  children.add(child); const ready = deferred(); const result = deferred(); const exited = deferred();
  child.on('message', (m) => { if (m.event === 'ready') ready.resolve(); else result.resolve(m); });
  child.on('exit', (code) => { children.delete(child); exited.resolve(code); result.resolve({ event: 'exit', code }); ready.resolve(); });
  child.send({ uri, dbName: isolated.databaseName, root, courseId: String(courseId), teacherId: String(teacherId), ...config });
  return { child, ready: ready.promise, result: result.promise, exited: exited.promise };
}
async function runWorker(config) { const w = worker(config); const r = await w.result; assert.equal(await w.exited, 0); return r; }
before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-atomicity-')); env.uploadDir = root;
  isolated = await openIsolatedYouTubeMongo(uri);
  await mongoose.connect(uri, { dbName: isolated.databaseName, autoIndex: false, autoCreate: false }); db = mongoose.connection.db;
  for (const name of collections) await db.createCollection(name);
  await db.collection('shortassets').createIndex({ youtubeVideoId: 1 }, { unique: true, sparse: true });
});
beforeEach(async () => {
  for (const name of collections) await db.collection(name).deleteMany({});
  await db.collection('courses').insertOne(course);
  await db.collection('users').insertOne({ _id: teacherId, name: 'Fixture', role: 'admin', isActive: true });
  await Setting.create({ key: 'youtubeLifecycle.cleanup', value: true });
  lifecycle.resetYouTubeLifecycleStateForTests(); upload.resetYouTubeUploadState();
  env.youtubePrivatizeOnDelete = false;
});
after(async () => {
  for (const child of children) child.kill();
  await mongoose.disconnect(); await isolated?.close();
  if (root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('ff-atomicity-')) fs.rmSync(root, { recursive: true, force: true });
});

for (const kind of ['video', 'short_asset']) it(`NR01 ${kind} 過期接管遇到已 unlink 未收尾時保留恢復依據`, { timeout: 180_000 }, async () => {
  const archivedAt = new Date();
  const item = await insert(kind, kind === 'short_asset' ? { status: 'archived', archiveReason: 'course_deleted', archivedAt } : {});
  const model = kind === 'video' ? Video : ShortAsset;
  const originalSetting = Setting.findOne; const originalCas = model.findOneAndUpdate;
  const verified = deferred(); const allowUnlink = deferred(); const unlinked = deferred(); const allowFinalize = deferred(); let reads = 0;
  Setting.findOne = function (...args) {
    const query = originalSetting.apply(this, args); if (++reads !== 2) return query;
    return { lean: async () => { const value = await query.lean(); verified.resolve(); await allowUnlink.promise; return value; } };
  };
  model.findOneAndUpdate = async function (q, u, o) {
    if (u.$set?.['youtubeUpload.localCleanupAt']) { unlinked.resolve(); await allowFinalize.promise; }
    return originalCas.call(this, q, u, o);
  };
  const cleaning = kind === 'video' ? upload.cleanupUploadedLocalVideo(String(item._id)) : shortCleanup.cleanupShortAssetLocalFile(String(item._id));
  try {
    await verified.promise;
    const claimedAt = (await model.findById(item._id).lean()).youtubeUpload.cleanupClaimedAt;
    const repair = worker({ action: 'repair', kind, pause: true }); await repair.ready;
    allowUnlink.resolve(); await unlinked.promise;
    assert.equal(fs.existsSync(item.filePath), false);
    if (process.env.YOUTUBE_TEST_REAL_LEASE === 'true') {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, claimedAt.getTime() + cleanup.CLEANUP_LEASE_MS + 1500 - Date.now())));
    } else {
      // Deterministic lease-expiry fixture only; no source/status/intent mutation.
      await model.collection.updateOne({ _id: item._id }, { $set: { 'youtubeUpload.cleanupClaimedAt': new Date('2025-01-01') } });
    }
    repair.child.send('continue'); assert.equal((await repair.result).event, 'result'); assert.equal(await repair.exited, 0);
  } finally { allowUnlink.resolve(); allowFinalize.resolve(); Setting.findOne = originalSetting; }
  try { await cleaning; } finally { model.findOneAndUpdate = originalCas; }
  await Setting.updateOne({ key: 'youtubeLifecycle.cleanup' }, { $set: { value: false } });
  await lifecycle.runYouTubeCleanup({ getFreeBytes: async () => 2 * 1024 ** 3 });
  const current = await model.findById(item._id).lean();
  if (kind === 'video') {
    assert.equal(current.filePath, null, 'deleted video must be recoverable, not retain a phantom path');
    assert.ok(current.youtubeUpload.localCleanupAt);
    await restoreVideoSource({ videoId: String(item._id), file: { path: file(), originalname: 'restore.mp4' }, user: { id: String(teacherId), role: 'admin' } });
    assert.ok(fs.existsSync((await Video.findById(item._id).lean()).filePath));
  } else {
    const rollback = await runWorker({ action: 'rollback', id: String(item._id), archivedAt: archivedAt.toISOString() });
    assert.equal(rollback.event, 'error', 'deleted short source must not become a usable draft');
    assert.equal((await model.findById(item._id).lean()).status, 'archived');
    assert.ok(current.youtubeUpload.localCleanupAt);
  }
});

it('NR02 另一 backend 遇到短片清理衝突時刪課程不得部分破壞資料', { timeout: 45_000 }, async () => {
  const video = await insert('video', { youtubeVideoId: undefined });
  const a = await insert('short_asset'); const b = await insert('short_asset', { youtubeVideoId: 'backup00002' });
  await db.collection('enrollments').insertOne({ courseId, studentId: teacherId, status: 'active' });
  await db.collection('faqs').insertOne({ courseId, question: 'Fixture' });
  const source = await cleanup.inspectCleanupSource('short_asset', a);
  const owner = await cleanup.claimCleanupSource('short_asset', a, source, {}); assert.ok(owner);
  let result;
  try { result = await runWorker({ action: 'delete-course' }); } finally { await owner.release(); }
  assert.equal(result.error?.code, 'SHORT_ASSET_REVIEW_CONFLICT');
  assert.ok(await db.collection('courses').findOne({ _id: courseId }));
  assert.ok(await Video.findById(video._id).lean(), '409 must retain the course video');
  assert.equal(await db.collection('enrollments').countDocuments({ courseId }), 1);
  assert.equal(await db.collection('faqs').countDocuments({ courseId }), 1);
  assert.equal((await ShortAsset.findById(b._id).lean()).status, 'published');
  assert.equal(await db.collection('coursedeletionjobs').countDocuments(), 0);
});

for (const kind of ['video', 'short_asset']) for (const pauseAt of ['before-unlink', 'after-unlink']) {
  it(`NR01 ${kind} 程序在 ${pauseAt} 中斷後另一行程可接手`, { timeout: 45_000 }, async () => {
    const item = await insert(kind, kind === 'short_asset' ? { status: 'archived' } : {});
    const model = kind === 'video' ? Video : ShortAsset;
    const w = worker({ action: 'cleanup', kind, id: String(item._id), pauseAt }); await w.ready;
    const pending = await model.findById(item._id).lean(); assert.ok(pending.youtubeUpload.cleanupIntent);
    w.child.kill(); await w.exited;
    await model.collection.updateOne({ _id: item._id }, { $set: { 'youtubeUpload.cleanupClaimedAt': new Date('2025-01-01') } });
    assert.equal((await runWorker({ action: 'repair', kind })).event, 'result');
    const current = await model.findById(item._id).lean();
    assert.equal(current.youtubeUpload.cleanupIntent, undefined);
    assert.equal(fs.existsSync(item.filePath), pauseAt === 'before-unlink');
    assert.equal(Boolean(current.youtubeUpload.localCleanupAt), pauseAt === 'after-unlink');
    if (kind === 'video') assert.equal(current.filePath, pauseAt === 'before-unlink' ? item.filePath : null);
  });
}

it('NR01 恢復 owner 接管後死亡仍能再次接管，不會遺失缺檔收尾', { timeout: 45_000 }, async () => {
  const item = await insert('video');
  const owner = await cleanup.claimCleanupSource('video', item, await cleanup.inspectCleanupSource('video', item), {});
  assert.ok(owner); fs.unlinkSync(item.filePath);
  await Video.collection.updateOne({ _id: item._id }, { $set: { 'youtubeUpload.cleanupClaimedAt': new Date('2025-01-01') } });
  const repair = worker({ action: 'repair', kind: 'video', pauseAfterClaim: true }); await repair.ready;
  const taken = await Video.findById(item._id).lean(); assert.equal(taken.youtubeUpload.cleanupIntent.phase, 'recovering');
  repair.child.kill(); await repair.exited;
  await Video.collection.updateOne({ _id: item._id }, { $set: { 'youtubeUpload.cleanupClaimedAt': new Date('2025-01-01') } });
  await runWorker({ action: 'repair', kind: 'video' });
  const current = await Video.findById(item._id).lean(); assert.equal(current.filePath, null); assert.ok(current.youtubeUpload.localCleanupAt);
});

it('NR01 接管後 DB 收尾失敗仍保留 intent，舊 owner release 不得取消新 owner', async () => {
  const item = await insert('video');
  const owner = await cleanup.claimCleanupSource('video', item, await cleanup.inspectCleanupSource('video', item), {});
  fs.unlinkSync(item.filePath); await owner.deferFinalization();
  const original = Video.findOneAndUpdate;
  Video.findOneAndUpdate = function (q, u, o) { if (u.$set?.['youtubeUpload.localCleanupAt']) throw new Error('injected repair DB failure'); return original.call(this, q, u, o); };
  try { assert.equal((await cleanup.repairCleanupIntents()).unresolved, 1); } finally { Video.findOneAndUpdate = original; }
  await owner.release();
  assert.equal((await Video.findById(item._id).lean()).youtubeUpload.cleanupIntent.phase, 'recovering');
  await Video.collection.updateOne({ _id: item._id }, { $set: { 'youtubeUpload.cleanupClaimedAt': new Date('2025-01-01') } });
  await cleanup.repairCleanupIntents(); assert.equal((await Video.findById(item._id).lean()).filePath, null);
});

async function deletionFixture() {
  const v = await insert('video'); await insert('short_asset', { youtubeVideoId: 'short000001' });
  await db.collection('enrollments').insertOne({ courseId, studentId: teacherId });
  await db.collection('faqs').insertOne({ courseId, question: 'fixture' });
  await db.collection('notifications').insertOne({ videoId: String(v._id) });
  await db.collection(VideoSegment.collection.name).insertOne({ videoId: String(v._id), text: 'fixture' });
  await db.collection(VideoSegmentVideo.collection.name).insertOne({ video_id: String(v._id) });
  await db.collection('users').updateOne({ _id: teacherId }, { $set: { activeCourseId: courseId } });
  await db.collection('courses').insertOne({ ...course, _id: new mongoose.Types.ObjectId(), videoIds: [v._id] });
  return v;
}
async function snapshot() {
  const result = {};
  for (const name of collections) result[name] = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
  return JSON.stringify(result);
}
for (const kind of ['video', 'short_asset']) it(`NR02 ${kind} 在刪課交易快照後取得清理權時必須整筆回滾`, { timeout: 45_000 }, async () => {
  const video = await deletionFixture();
  const item = kind === 'video' ? video : await ShortAsset.findOne({ courseId }).lean();
  // Course was already read in the transaction. The other backend's later
  // source claim must invalidate the stale transaction through write conflict.
  const deleting = worker({ action: 'delete-course', pauseAt: 'before-write' }); await deleting.ready;
  const owner = await cleanup.claimCleanupSource(kind, item, await cleanup.inspectCleanupSource(kind, item), {});
  assert.ok(owner); const claimedState = await snapshot();
  try {
    deleting.child.send('continue'); const result = await deleting.result; assert.equal(await deleting.exited, 0);
    assert.equal(result.error?.code, kind === 'video' ? 'COURSE_DELETE_CONFLICT' : 'SHORT_ASSET_REVIEW_CONFLICT');
    assert.equal(await snapshot(), claimedState, 'no cascade changes may escape the aborted transaction');
  } finally { await owner.release(); }
});
for (const faultAt of ['faq', 'outbox', 'course']) it(`NR02 ${faultAt} DB 失敗時全筆回滾且沒有外部工作`, async () => {
  await deletionFixture(); const beforeState = await snapshot();
  const model = faultAt === 'faq' ? Faq : faultAt === 'outbox' ? Job : Course;
  const method = faultAt === 'faq' ? 'deleteMany' : faultAt === 'outbox' ? 'insertMany' : 'deleteOne';
  const original = model[method]; model[method] = async () => { throw new Error(`injected ${faultAt}`); };
  try { await assert.rejects(deleteCourse(String(courseId), { id: String(teacherId), role: 'admin' }), /injected/); }
  finally { model[method] = original; }
  assert.equal(await snapshot(), beforeState);
});

it('NR02 兩個 backend 同時刪課程只有一筆 transaction 與 outbox 成功', { timeout: 45_000 }, async () => {
  await deletionFixture();
  const a = worker({ action: 'delete-course', pauseAt: 'before-write' }); const b = worker({ action: 'delete-course', pauseAt: 'before-write' });
  await Promise.all([a.ready, b.ready]); a.child.send('continue'); b.child.send('continue');
  const results = await Promise.all([a.result, b.result]); await Promise.all([a.exited, b.exited]);
  assert.equal(results.filter((r) => r.event === 'result').length, 1);
  assert.equal(results.find((r) => r.event === 'error').error.code, 'COURSE_NOT_FOUND');
  assert.equal(await Course.countDocuments({ _id: courseId }), 0);
  assert.equal(await Job.countDocuments(), 1); assert.equal(await db.collection('testRemoteWrites').countDocuments(), 0);
});

it('NR02 transaction 中程序死亡時未提交刪除不可見', { timeout: 45_000 }, async () => {
  await deletionFixture(); const beforeState = await snapshot();
  const w = worker({ action: 'delete-course', pauseAt: 'in-transaction' }); await w.ready;
  w.child.kill(); await w.exited;
  assert.equal(await snapshot(), beforeState);
});

it('NR02 DB 提交後程序死亡，另一 backend 仍會執行持久的轉私人工作', { timeout: 45_000 }, async () => {
  await deletionFixture(); const w = worker({ action: 'delete-course', pauseAt: 'after-commit' }); await w.ready;
  w.child.kill(); await w.exited;
  assert.equal(await Course.countDocuments({ _id: courseId }), 0); assert.equal(await Job.countDocuments({ status: 'pending' }), 1);
  const result = await runWorker({ action: 'jobs' }); assert.equal(result.result.completed, 1);
  assert.equal(await Job.countDocuments({ status: 'completed' }), 1);
  assert.equal(await db.collection('testRemoteWrites').countDocuments(), 1);
});

it('NR02 遠端成功後程序死亡，過期工作可重試同一 private 動作', { timeout: 45_000 }, async () => {
  await deletionFixture(); await deleteCourse(String(courseId), { id: String(teacherId), role: 'admin' });
  const w = worker({ action: 'jobs', pauseAfterRemote: true }); await w.ready;
  w.child.kill(); await w.exited;
  assert.equal(await Job.countDocuments({ status: 'running' }), 1);
  await Job.collection.updateOne({}, { $set: { claimedAt: new Date('2025-01-01') } });
  const result = await runWorker({ action: 'jobs' }); assert.equal(result.result.completed, 1);
  const writes = await db.collection('testRemoteWrites').find({}).toArray();
  assert.equal(writes.length, 2); assert.ok(writes.every((w) => w.status.privacyStatus === 'private'));
  assert.equal(await Job.countDocuments({ status: 'completed' }), 1);
});

it('NR02 轉私人失敗或回寫失敗時保留工作，關閉開關不發送，重新允許後可恢復', async () => {
  await deletionFixture(); await deleteCourse(String(courseId), { id: String(teacherId), role: 'admin' });
  let puts = 0; const fake = fakeYouTube();
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'PUT' && String(url).startsWith(upload.YOUTUBE_VIDEOS_URL)) puts++;
    return fake(url, options);
  };
  assert.equal((await runCourseDeletionJobs({ fetchImpl })).deferred, true); assert.equal(puts, 0);
  env.youtubePrivatizeOnDelete = true;
  await runCourseDeletionJobs({ fetchImpl: async () => { throw new Error('fake remote unavailable'); } });
  assert.equal(await Job.countDocuments({ status: 'pending' }), 1); assert.equal(puts, 0);
  await Job.collection.updateOne({}, { $set: { nextAttemptAt: new Date('2025-01-01') } });
  const original = Job.findOneAndUpdate;
  Job.findOneAndUpdate = function (q, u, o) { if (u.$set?.status === 'completed') throw new Error('fake completion DB failure'); return original.call(this, q, u, o); };
  try { assert.equal((await runCourseDeletionJobs({ fetchImpl })).completed, 0); } finally { Job.findOneAndUpdate = original; }
  assert.equal(puts, 1); assert.equal(await Job.countDocuments({ status: 'pending' }), 1);
  await Job.collection.updateOne({}, { $set: { nextAttemptAt: new Date('2025-01-01') } });
  assert.equal((await runCourseDeletionJobs({ fetchImpl })).completed, 1); assert.equal(puts, 2);
});

it('NR02 刪除 legacy Video 時同 transaction 保留備份歸屬，不讓延遲工作碰到其他內容', async () => {
  const old = await deletionFixture();
  // Cold deployment: neither new collection exists yet. Do not let setup's
  // createCollection hide transaction/implicit-creation incompatibilities.
  await db.collection('youtubebackups').drop();
  await db.collection('coursedeletionjobs').drop();
  await deleteCourse(String(courseId), { id: String(teacherId), role: 'admin' });
  const other = await insert('video', { youtubeVideoId: undefined, youtubeUpload: { status: 'failed', retrySafe: false } });
  await assert.rejects(reserveYouTubeBackup(old.youtubeVideoId, 'video', other), { code: 'YOUTUBE_QUARANTINE_VIDEO_IN_USE' });
  assert.equal(await Job.countDocuments({ status: 'pending' }), 1);
});

it('NR02 Video 有清理 intent 時整批刪除回滾，不會丟失檔案收尾依據', async () => {
  const v = await deletionFixture();
  const owner = await cleanup.claimCleanupSource('video', v, await cleanup.inspectCleanupSource('video', v), {}); assert.ok(owner);
  const beforeState = await snapshot();
  try { await assert.rejects(deleteCourse(String(courseId), { id: String(teacherId), role: 'admin' }), { code: 'COURSE_DELETE_CONFLICT' }); }
  finally { assert.equal(await snapshot(), beforeState); await owner.release(); }
});

for (const stallAt of ['fetch', 'body']) it(`NR02 轉私人 ${stallAt} 無回應時保留待辦並繼續處理下一筆`, async () => {
  await deletionFixture(); await insert('video', { youtubeVideoId: 'backup00002' });
  await deleteCourse(String(courseId), { id: String(teacherId), role: 'admin' });
  env.youtubePrivatizeOnDelete = true;
  const gate = deferred(); const fake = fakeYouTube(); let stalled = false; let signal; let deadlineTimer;
  const fetchImpl = async (url, options = {}) => {
    if (!stalled) {
      stalled = true; signal = options.signal;
      if (stallAt === 'fetch') await gate.promise;
      else return { ok: true, status: 200, json: async () => { await gate.promise; return { access_token: 'fake' }; } };
    }
    return fake(url, options);
  };
  const running = runCourseDeletionJobs({ fetchImpl, requestTimeoutMs: 20 });
  try {
    const result = await Promise.race([running, new Promise((resolve) => { deadlineTimer = setTimeout(() => resolve({ hung: true }), 1000); })]);
    assert.equal(result.completed, 1, 'one stalled request must not pin all persisted privacy work');
    assert.ok(signal.aborted, 'the stalled HTTP operation must also receive cancellation');
    assert.equal(await Job.countDocuments({ status: 'pending' }), 1);
    assert.equal(await Job.countDocuments({ status: 'completed' }), 1);
  } finally { clearTimeout(deadlineTimer); gate.resolve(); await running; }
});
