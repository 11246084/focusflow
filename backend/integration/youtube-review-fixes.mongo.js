// Adapted from the independent 2026-10-26 repro. No memory model harness.
const { env, deferred, fakeYouTube } = require('./helpers/youtubeReviewFixture');
const assert = require('node:assert/strict');
const { before, beforeEach, after, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const mongoose = require('mongoose');
const { assertLoopbackMongoUri, openIsolatedYouTubeMongo } = require('./helpers/isolatedYouTubeMongo');
const uri = assertLoopbackMongoUri(process.env.YOUTUBE_TEST_MONGODB_URI);
const Video = require('../src/models/video.model');
const ShortAsset = require('../src/models/shortAsset.model');
const RuntimeSetting = require('../src/models/runtimeSetting.model');
const upload = require('../src/services/youtubeUpload.service');
const lifecycle = require('../src/services/youtubeLifecycle.service');
const shortUpload = require('../src/services/shortAssetPublish.service');
const shortService = require('../src/services/shortAsset.service');
const { cleanupShortAssetLocalFile } = require('../src/services/shortAssetCleanup.service');
const { restoreVideoSource, attachVideoToCourse, detachVideoFromCourse, createCourseVideoFromYouTube } = require('../src/services/video.service');
const { reserveYouTubeBackup } = require('../src/services/youtubeWorkOwnership.service');
let isolated; let root; let db;
const children = new Set();
const courseId = new mongoose.Types.ObjectId(); const teacherId = new mongoose.Types.ObjectId();
const course = { _id: courseId, title: 'Review course', teacherId, status: 'draft', videoIds: [] };
const mp4 = Buffer.concat(['ftyp', 'mdat', 'moov'].map((type) => { const b = Buffer.alloc(8); b.writeUInt32BE(8); b.write(type, 4); return b; }));
function file() { const p = path.join(root, `${new mongoose.Types.ObjectId()}.mp4`); fs.writeFileSync(p, mp4); return p; }
async function insert(kind, extra = {}) {
  const item = { _id: new mongoose.Types.ObjectId(), courseId, uploadedBy: teacherId, sourceType: 'upload', title: 'Fixture', filePath: file(),
    disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true }, youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 1, nextRetryAt: null },
    ...(kind === 'video' ? { processing: { status: 'completed' } } : { status: 'draft', generationVersion: 1 }), ...extra };
  await db.collection(kind === 'video' ? 'videos' : 'shortassets').insertOne(item); return item;
}
function worker(config) {
  const child = fork(path.join(__dirname, 'helpers/youtubeReviewWorker.js'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
  children.add(child);
  const ready = deferred(); const result = deferred(); const exited = deferred();
  child.on('message', (m) => { if (m.event === 'ready') ready.resolve(); else if (m.event === 'result' || m.event === 'error') result.resolve(m); });
  child.on('exit', (code) => { children.delete(child); exited.resolve(code); });
  child.send({ uri, dbName: isolated.databaseName, root, ...config });
  return { child, ready: ready.promise, result: result.promise, exited: exited.promise };
}
async function runWorker(config) { const w = worker(config); const result = await w.result; assert.equal(await w.exited, 0); return result; }
before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-review-regression-')); env.uploadDir = root;
  isolated = await openIsolatedYouTubeMongo(uri);
  await mongoose.connect(uri, { dbName: isolated.databaseName, autoIndex: false, autoCreate: false }); db = mongoose.connection.db;
  for (const name of ['videos', 'shortassets', 'users', 'courses', 'notifications', 'runtimesettings', 'youtubebackups', 'faqs']) await db.createCollection(name);
  await db.collection('shortassets').createIndex({ youtubeVideoId: 1 }, { unique: true, sparse: true });
  await db.collection('courses').insertOne(course);
  await db.collection('users').insertOne({ _id: teacherId, name: 'Teacher', email: 'review@example.invalid', role: 'teacher', isActive: true });
});
beforeEach(async () => {
  for (const name of ['videos', 'shortassets', 'runtimesettings', 'notifications', 'youtubebackups']) await db.collection(name).deleteMany({});
  await RuntimeSetting.create({ key: 'youtubeLifecycle.cleanup', value: true });
  upload.resetYouTubeUploadState(); lifecycle.resetYouTubeLifecycleStateForTests();
});
after(async () => {
  for (const child of children) child.kill();
  await mongoose.disconnect(); await isolated?.close();
  if (root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('ff-review-regression-')) fs.rmSync(root, { recursive: true, force: true });
});

for (const secondKind of ['video', 'short_asset']) it(`FR01 two processes reserve one backup for video/${secondKind}`, { timeout: 45_000 }, async () => {
  const a = await insert('video', { youtubeUpload: { status: 'failed', retrySafe: false, attemptCount: 1 } });
  const b = await insert(secondKind, { youtubeUpload: { status: 'failed', retrySafe: false, attemptCount: 1 } });
  const wa = worker({ action: 'apply', kind: 'video', id: String(a._id) }); const wb = worker({ action: 'apply', kind: secondKind, id: String(b._id) });
  await Promise.all([wa.ready, wb.ready]); wa.child.send('continue'); wb.child.send('continue');
  const results = await Promise.all([wa.result, wb.result]); await Promise.all([wa.exited, wb.exited]);
  assert.equal(results.filter((r) => r.event === 'result').length, 1);
  assert.equal(results.find((r) => r.event === 'error').error.code, 'YOUTUBE_QUARANTINE_VIDEO_IN_USE');
  assert.equal(await Video.countDocuments({ youtubeVideoId: 'sharedYt001' }) + await ShortAsset.countDocuments({ youtubeVideoId: 'sharedYt001' }), 1);
});
it('FR01 ambiguous finalization retains reservation, same content resumes, next generation cannot reuse it', async () => {
  const a = await insert('short_asset'); const b = await insert('video');
  await reserveYouTubeBackup('ownedYt001', 'short_asset', a);
  await assert.rejects(reserveYouTubeBackup('ownedYt001', 'video', b), { code: 'YOUTUBE_QUARANTINE_VIDEO_IN_USE' });
  await reserveYouTubeBackup('ownedYt001', 'short_asset', a);
  await assert.rejects(reserveYouTubeBackup('ownedYt001', 'short_asset', { ...a, generationVersion: 2 }), { code: 'YOUTUBE_QUARANTINE_VIDEO_IN_USE' });
  assert.equal(await db.collection('youtubebackups').countDocuments(), 1);
});
it('FR02 another process cannot restore draft after cleanup ownership verification', { timeout: 45_000 }, async () => {
  const archivedAt = new Date();
  const asset = await insert('short_asset', { status: 'archived', archiveReason: 'course_deleted', archivedAt,
    youtubeVideoId: 'backupYt001', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') } });
  const original = RuntimeSetting.findOne; const ready = deferred(); const gate = deferred(); let reads = 0;
  RuntimeSetting.findOne = function (...args) { const query = original.apply(this, args); if (++reads !== 2) return query;
    return { lean: async () => { const result = await query.lean(); ready.resolve(); await gate.promise; return result; } }; };
  const cleaning = cleanupShortAssetLocalFile(String(asset._id));
  let duringStatus;
  try {
    await ready.promise;
    await runWorker({ action: 'rollback', id: String(asset._id), archivedAt: archivedAt.toISOString() });
    duringStatus = (await ShortAsset.findById(asset._id).lean()).status;
  } finally { gate.resolve(); RuntimeSetting.findOne = original; }
  const deletion = await cleaning;
  assert.equal(duringStatus, 'archived');
  assert.equal(deletion.cleaned, true);
  await runWorker({ action: 'rollback', id: String(asset._id), archivedAt: archivedAt.toISOString() });
  assert.equal((await ShortAsset.findById(asset._id).lean()).status, 'archived', 'cleaned source must not become draft');
});
it('FR03 archive between uploaded CAS and publish remains archived', async () => {
  const asset = await insert('short_asset', { reviewStatus: 'approved', reviewedGenerationVersion: 1 });
  const original = ShortAsset.findOneAndUpdate; let once = true;
  ShortAsset.findOneAndUpdate = async function (query, update, options) {
    const value = await original.call(this, query, update, options);
    if (once && update.$set?.['youtubeUpload.status'] === 'uploaded') { once = false; await shortService.archiveForCourseDeletion(course); }
    return value;
  };
  try { await shortUpload.uploadShortAssetToYouTube({ assetId: String(asset._id), fetchImpl: fakeYouTube() }); }
  finally { ShortAsset.findOneAndUpdate = original; }
  assert.equal((await ShortAsset.findById(asset._id).lean()).status, 'archived');
});
it('FR03 new generation committed by another process cannot be published by old work', { timeout: 45_000 }, async () => {
  const asset = await insert('short_asset', { reviewStatus: 'approved', reviewedGenerationVersion: 1 });
  const ready = deferred(); const gate = deferred(); const one = ShortAsset.findOneAndUpdate; const byId = ShortAsset.findByIdAndUpdate;
  const intercept = (original) => async function (...args) { if (args[1].$set?.status === 'published') { ready.resolve(); await gate.promise; } return original.apply(this, args); };
  ShortAsset.findOneAndUpdate = intercept(one); ShortAsset.findByIdAndUpdate = intercept(byId);
  const publishing = shortUpload.uploadShortAssetToYouTube({ assetId: String(asset._id), fetchImpl: fakeYouTube() });
  try { await ready.promise; const regenerated = await runWorker({ action: 'regenerate', id: String(asset._id), filePath: file() }); assert.equal(regenerated.event, 'result'); }
  finally { gate.resolve(); }
  try { await publishing; } finally { ShortAsset.findOneAndUpdate = one; ShortAsset.findByIdAndUpdate = byId; }
  const current = await ShortAsset.findById(asset._id).lean();
  assert.equal(current.generationVersion, 2); assert.equal(current.status, 'draft'); assert.equal(current.reviewStatus, 'pending'); assert.equal(current.youtubeVideoId, undefined);
});
for (const kind of ['video', 'short_asset']) it(`FR04 foreign recovery cannot quarantine live ${kind} upload`, { timeout: 45_000 }, async () => {
  const item = await insert(kind); const ready = deferred(); const gate = deferred(); const counters = {};
  const fetchImpl = fakeYouTube({ counters, waitPut: async () => { ready.resolve(); await gate.promise; } });
  const sending = kind === 'video' ? upload.autoUploadVideoToYouTube(String(item._id), { fetchImpl }) : shortUpload.uploadShortAssetToYouTube({ assetId: String(item._id), fetchImpl });
  await ready.promise;
  let result;
  try { result = await runWorker({ action: 'recover', kind }); }
  finally { gate.resolve(); }
  const sent = await sending;
  assert.equal(result.event, 'result'); assert.equal(result.result.quarantined, 0); assert.ok(sent);
  assert.equal((await (kind === 'video' ? Video : ShortAsset).findById(item._id).lean()).youtubeUpload.status, 'uploaded');
  assert.equal(counters.puts, 1);
});
for (const heartbeat of ['expired', 'missing']) it(`FR04 ${heartbeat} owner is quarantined without another upload`, async () => {
  const item = await insert('video', { youtubeUpload: { status: 'uploading', attemptId: 'dead-worker', lastAttemptAt: new Date('2025-01-01'),
    ...(heartbeat === 'expired' ? { heartbeatAt: new Date('2025-01-01') } : {}) } });
  const result = await runWorker({ action: 'recover', kind: 'video' });
  assert.equal(result.result.quarantined, 1);
  const current = await Video.findById(item._id).lean(); assert.equal(current.youtubeUpload.retrySafe, false); assert.equal(current.youtubeVideoId, undefined);
});
for (const kind of ['video', 'short_asset']) it(`FR05 ${kind} repairs lost DB finalization with enough space and cleanup disabled`, async () => {
  const item = await insert(kind, { ...(kind === 'short_asset' ? { status: 'published' } : {}),
    youtubeVideoId: 'backupYt001', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') } });
  const model = kind === 'video' ? Video : ShortAsset; const original = model.findOneAndUpdate; let once = true;
  model.findOneAndUpdate = function (query, update, options) { if (once && update.$set?.['youtubeUpload.localCleanupAt']) { once = false; throw new Error('Injected finalization failure'); } return original.call(this, query, update, options); };
  let first; try { first = await lifecycle.runYouTubeCleanup({ getFreeBytes: async () => 0 }); } finally { model.findOneAndUpdate = original; }
  assert.equal(first.results[0].skipReason, 'state_write_failed'); assert.equal(fs.existsSync(item.filePath), false);
  await RuntimeSetting.updateOne({ key: 'youtubeLifecycle.cleanup' }, { $set: { value: false } });
  await lifecycle.runYouTubeCleanup({ getFreeBytes: async () => 2 * 1024 ** 3 });
  const repaired = await model.findById(item._id).lean(); assert.ok(repaired.youtubeUpload.localCleanupAt); assert.equal(repaired.youtubeUpload.cleanupIntent, undefined);
  if (kind === 'video') {
    assert.equal(repaired.filePath, null);
    await restoreVideoSource({ videoId: String(item._id), file: { path: file(), originalname: 'restore.mp4' }, user: { id: String(teacherId), role: 'admin' } });
    assert.ok(fs.existsSync((await Video.findById(item._id).lean()).filePath));
  } else assert.equal(repaired.filePath, item.filePath);
});
it('FR06 space recovered in final reference query prevents unlink', async () => {
  const item = await insert('video', { youtubeVideoId: 'backupYt001', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') } });
  let freeBytes = 0; let freeReads = 0; let refsAfterFirstRead = 0; const original = ShortAsset.find;
  ShortAsset.find = function (query, ...args) { if (freeReads > 0 && query.filePath && ++refsAfterFirstRead === 2) freeBytes = 2 * 1024 ** 3; return original.call(this, query, ...args); };
  let result; try { result = await lifecycle.runYouTubeCleanup({ getFreeBytes: async () => { freeReads++; return freeBytes; } }); } finally { ShortAsset.find = original; }
  assert.equal(freeBytes, 2 * 1024 ** 3); assert.equal(result.cleaned, 0); assert.ok(fs.existsSync(item.filePath));
});
it('FR06 production final statfs failure keeps the original', async () => {
  const item = await insert('video', { youtubeVideoId: 'backupYt001', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') } });
  const asyncStat = fs.promises.statfs; const syncStat = fs.statfsSync;
  fs.promises.statfs = async () => ({ bavail: 0, bsize: 4096 }); fs.statfsSync = () => { throw new Error('Injected statfs error'); };
  let result; try { result = await lifecycle.runYouTubeCleanup(); } finally { fs.promises.statfs = asyncStat; fs.statfsSync = syncStat; }
  assert.equal(result.cleaned, 0); assert.ok(fs.existsSync(item.filePath));
});

it('FR01 backup ownership permits multi-course attach/detach and shared imported YouTube URLs', async () => {
  const otherCourseId = new mongoose.Types.ObjectId();
  await db.collection('courses').insertOne({ ...course, _id: otherCourseId });
  const item = await insert('video', { youtubeVideoId: 'backupYt001', youtubeUpload: { status: 'uploaded' } });
  await reserveYouTubeBackup(item.youtubeVideoId, 'video', item);
  const user = { id: String(teacherId), role: 'admin' };
  await attachVideoToCourse({ courseId: String(otherCourseId), videoId: String(item._id), user });
  assert.ok((await db.collection('courses').findOne({ _id: otherCourseId })).videoIds.some((id) => String(id) === String(item._id)));
  await detachVideoFromCourse({ courseId: String(otherCourseId), videoId: String(item._id), user });
  assert.equal((await db.collection('courses').findOne({ _id: otherCourseId })).videoIds.length, 0);
  assert.equal(await db.collection('youtubebackups').countDocuments(), 1);
  for (const id of [courseId, otherCourseId]) await createCourseVideoFromYouTube({ courseId: String(id), youtubeUrl: 'https://www.youtube.com/watch?v=imported001', uploadedBy: String(teacherId), user });
  assert.equal(await Video.countDocuments({ youtubeVideoId: 'imported001' }), 2);
});
for (const kind of ['video', 'short_asset']) for (const mode of ['missing', 'null']) it(`legacy ${kind} ${mode} attempt/source-version can upload, clean and restore`, async () => {
  const metadata = { status: 'failed', retrySafe: true, attemptCount: 1, nextRetryAt: null };
  if (mode === 'null') Object.assign(metadata, { attemptId: null, localSourceVersion: null, heartbeatAt: null, cleanupIntent: null });
  const item = await insert(kind, { youtubeUpload: metadata, ...(kind === 'short_asset' ? { reviewStatus: 'approved', reviewedGenerationVersion: 1 } : {}) });
  const model = kind === 'video' ? Video : ShortAsset;
  const result = kind === 'video' ? await upload.autoUploadVideoToYouTube(String(item._id), { fetchImpl: fakeYouTube() })
    : await shortUpload.uploadShortAssetToYouTube({ assetId: String(item._id), fetchImpl: fakeYouTube() });
  assert.ok(result); assert.equal((await model.findById(item._id).lean()).youtubeUpload.status, 'uploaded');
  if (kind === 'short_asset') assert.equal((await model.findById(item._id).lean()).status, 'published');
  await model.collection.updateOne({ _id: item._id }, { $set: { 'youtubeUpload.uploadedAt': new Date('2025-01-01') } });
  const cleaned = kind === 'video' ? await upload.cleanupUploadedLocalVideo(String(item._id)) : await cleanupShortAssetLocalFile(String(item._id));
  assert.equal(cleaned.cleaned, true);
  if (kind === 'video') await restoreVideoSource({ videoId: String(item._id), file: { path: file(), originalname: 'legacy-restored.mp4' }, user: { id: String(teacherId), role: 'admin' } });
});
it('FR03 hydrated legacy approved short without attemptId can publish', async () => {
  const item = await insert('short_asset', { youtubeVideoId: 'legacyYt001', reviewStatus: 'approved', reviewedGenerationVersion: 1, youtubeUpload: { status: 'uploaded' } });
  await ShortAsset.collection.updateOne({ _id: item._id }, { $unset: { generationVersion: 1 } });
  const legacy = await ShortAsset.findById(item._id);
  assert.equal(legacy.generationVersion, 1); assert.equal(legacy.youtubeUpload.attemptId, null);
  assert.ok(await shortUpload.publishApprovedShortAsset(legacy));
  assert.equal((await ShortAsset.findById(item._id).lean()).status, 'published');
});
it('FR02 failed unlink cancels intent so rollback can preserve draft', async () => {
  const archivedAt = new Date(); const item = await insert('short_asset', { status: 'archived', archiveReason: 'course_deleted', archivedAt,
    youtubeVideoId: 'backupYt001', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') } });
  const original = fs.unlinkSync; fs.unlinkSync = () => { throw new Error('Injected unlink failure'); };
  try { assert.equal((await cleanupShortAssetLocalFile(String(item._id))).reason, 'delete_failed'); } finally { fs.unlinkSync = original; }
  const result = await runWorker({ action: 'rollback', id: String(item._id), archivedAt: archivedAt.toISOString() });
  assert.equal(result.event, 'result'); assert.equal((await ShortAsset.findById(item._id).lean()).status, 'draft'); assert.ok(fs.existsSync(item.filePath));
});
it('FR05 another storage cannot finalize a pending deletion from its own missing path', async () => {
  const item = await insert('video', { youtubeVideoId: 'backupYt001', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01'),
    cleanupIntent: { id: 'foreign', storageKey: 'other-server', file: { pathKey: 'unknown' } }, cleanupClaimedAt: new Date('2025-01-01') } });
  fs.unlinkSync(item.filePath);
  await lifecycle.runYouTubeCleanup({ getFreeBytes: async () => 2 * 1024 ** 3 });
  const current = await Video.findById(item._id).lean(); assert.equal(current.filePath, item.filePath); assert.equal(current.youtubeUpload.localCleanupAt, undefined);
});
it('FR04 heartbeat renewal uses Mongo clock and aborts when attempt ownership is lost', async (t) => {
  const { keepUploadAlive, UPLOAD_HEARTBEAT_MS } = require('../src/services/youtubeWorkOwnership.service');
  const item = await insert('video', { youtubeUpload: { status: 'uploading', attemptId: 'owner', heartbeatAt: new Date('2025-01-01') } });
  const original = Video.findOneAndUpdate; let renewed = deferred();
  Video.findOneAndUpdate = async function (...args) { const value = await original.apply(this, args); renewed.resolve(); return value; };
  t.mock.timers.enable({ apis: ['setInterval'] });
  const heartbeat = keepUploadAlive(Video, { _id: item._id, 'youtubeUpload.status': 'uploading', 'youtubeUpload.attemptId': 'owner' });
  try {
    t.mock.timers.tick(UPLOAD_HEARTBEAT_MS); await renewed.promise;
    assert.ok((await Video.findById(item._id).lean()).youtubeUpload.heartbeatAt > new Date('2025-01-01'));
    await Video.collection.updateOne({ _id: item._id }, { $set: { 'youtubeUpload.attemptId': 'new-owner' } });
    renewed = deferred(); t.mock.timers.tick(UPLOAD_HEARTBEAT_MS); await renewed.promise;
  } finally { await heartbeat.stop(); t.mock.timers.reset(); Video.findOneAndUpdate = original; }
  assert.equal(heartbeat.signal.aborted, true);
});
it('FR02 expired cleanup owner cannot delete after another process rolls back the archive', async (t) => {
  const { performance } = require('node:perf_hooks');
  const { CLEANUP_LEASE_MS, repairCleanupIntents } = require('../src/services/localSourceCleanup.service');
  const archivedAt = new Date(); const item = await insert('short_asset', { status: 'archived', archiveReason: 'course_deleted', archivedAt,
    youtubeVideoId: 'backupYt001', youtubeUpload: { status: 'uploaded', uploadedAt: new Date('2025-01-01') } });
  let monotonicNow = 0; t.mock.method(performance, 'now', () => monotonicNow);
  const original = RuntimeSetting.findOne; const ready = deferred(); const gate = deferred(); let reads = 0;
  RuntimeSetting.findOne = function (...args) { const query = original.apply(this, args); if (++reads !== 2) return query;
    return { lean: async () => { const result = await query.lean(); ready.resolve(); await gate.promise; return result; } }; };
  const cleaning = cleanupShortAssetLocalFile(String(item._id));
  try {
    await ready.promise;
    monotonicNow = CLEANUP_LEASE_MS + 1;
    await ShortAsset.collection.updateOne({ _id: item._id }, { $set: { 'youtubeUpload.cleanupClaimedAt': new Date('2025-01-01') } });
    await repairCleanupIntents();
    const rolledBack = await runWorker({ action: 'rollback', id: String(item._id), archivedAt: archivedAt.toISOString() });
    assert.equal(rolledBack.event, 'result');
  } finally { gate.resolve(); RuntimeSetting.findOne = original; }
  assert.equal((await cleaning).cleaned, false);
  assert.equal((await ShortAsset.findById(item._id).lean()).status, 'draft'); assert.ok(fs.existsSync(item.filePath));
});
it('FR01 regeneration cannot inherit the old generation backup even for a legacy row', async () => {
  const item = await insert('short_asset', { youtubeVideoId: 'oldGenYt001', youtubeUpload: { status: 'uploaded' } });
  await assert.rejects(shortService.recordShortAssetRegeneration(String(item._id), { filePath: file(), youtubeVideoId: 'oldGenYt001' }), { code: 'YOUTUBE_QUARANTINE_VIDEO_IN_USE' });
  const changed = await shortService.recordShortAssetRegeneration(String(item._id), { filePath: file() });
  assert.equal(changed.generationVersion, 2); assert.equal(changed.youtubeVideoId, undefined); assert.equal(changed.youtubeUpload.status, null);
});
