const { env, deferred } = require('./helpers/youtubeReviewFixture');
const { before, beforeEach, after, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { fork } = require('node:child_process'); const mongoose = require('mongoose');
const { openIsolatedYouTubeMongo } = require('./helpers/isolatedYouTubeMongo');
const Video = require('../src/models/video.model'); const Setting = require('../src/models/runtimeSetting.model');
const videoService = require('../src/services/video.service'); const processing = require('../src/services/videoProcessing.service');
const cleanup = require('../src/services/localSourceCleanup.service'); const upload = require('../src/services/youtubeUpload.service');
const settings = require('../src/services/youtubeLifecycleSettings.service');
const uri = process.env.YOUTUBE_TEST_MONGODB_URI; let isolated; let root; let db;
const courseId = new mongoose.Types.ObjectId(); const teacherId = new mongoose.Types.ObjectId(); const adminId = new mongoose.Types.ObjectId();
const children = new Set();
const collections = ['videos','shortassets','courses','users','enrollments','faqs','notifications','runtimesettings','youtubebackups'];
const mp4 = Buffer.concat(['ftyp','mdat','moov'].map(type => { const b = Buffer.alloc(8); b.writeUInt32BE(8); b.write(type,4); return b; }));
function file() { const filename = path.join(root, `${new mongoose.Types.ObjectId()}.mp4`); fs.writeFileSync(filename, mp4); return filename; }
async function video() {
  const item = { _id: new mongoose.Types.ObjectId(), courseId, uploadedBy: teacherId, title: 'F3 fixture', sourceType: 'upload', fileName: 'fixture.mp4', filePath: file(),
    youtubeVideoId: 'f3Backup001', videoSource: 'youtube', videoUrl: 'https://www.youtube.com/watch?v=f3Backup001',
    processing: { status: 'completed', attemptCount: 1 }, youtubeUpload: { status: 'uploaded', remoteState: 'ready', readyAt: new Date('2025-01-01'), uploadedAt: new Date('2025-01-01') } };
  await db.collection('videos').insertOne(item); return item;
}
function worker(config) {
  const child = fork(path.join(__dirname, 'helpers/youtubeF3F4Worker.js'), [], { stdio: ['ignore','inherit','inherit','ipc'], windowsHide: true });
  children.add(child); const ready = deferred(); const result = deferred(); const exit = deferred();
  child.on('message', message => { if (message.event === 'ready') ready.resolve(); else result.resolve(message); });
  child.on('exit', code => { children.delete(child); ready.resolve(); result.resolve({ event: 'exit', code }); exit.resolve(code); });
  child.send({ uri, dbName: isolated.databaseName, root, userId: String(teacherId), ...config });
  return { child, ready: ready.promise, result: result.promise, exit: exit.promise };
}
before(async () => {
  isolated = await openIsolatedYouTubeMongo(uri); root = fs.mkdtempSync(path.join(os.tmpdir(),'ff-f3-f4-mongo-')); env.uploadDir = root;
  await mongoose.connect(uri, { dbName: isolated.databaseName, autoIndex: false, autoCreate: false, directConnection: true }); db = mongoose.connection.db;
  for (const name of collections) await db.createCollection(name);
  await Setting.collection.createIndex({ key: 1 }, { unique: true });
});
beforeEach(async () => {
  for (const name of collections) await db.collection(name).deleteMany({});
  await db.collection('courses').insertOne({ _id: courseId, teacherId, title: 'F3 fixture', status: 'published' });
  await db.collection('users').insertOne({ _id: teacherId, role: 'teacher', name: 'Fixture' });
  await Setting.create({ key: 'youtubeLifecycle.cleanup', value: true });
});
after(async () => {
  for (const child of children) child.kill();
  await mongoose.disconnect(); await isolated?.close();
  if (root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('ff-f3-f4-mongo-')) fs.rmSync(root, { recursive: true, force: true });
});
it('F3-T1 真正 completed 清理、補回、重新處理到 completed，原影片與 YouTube 不變', async () => {
  const item = await video(); assert.equal((await upload.cleanupUploadedLocalVideo(String(item._id))).cleaned, true);
  assert.equal(fs.existsSync(item.filePath), false);
  const restoredAt = Date.now();
  await videoService.restoreVideoSource({ videoId: String(item._id), file: { path: file(), originalname: 'restored.mp4' }, user: { id: String(teacherId), role: 'teacher' } });
  const restored = await Video.findById(item._id).lean(); assert.equal(restored.processing.status, 'completed');
  assert.ok(restored.youtubeUpload.localSourceRestoredAt.getTime() >= restoredAt);
  const w = worker({ action: 'reprocess', id: String(item._id) }); await w.ready; w.child.send('continue');
  assert.deepEqual(await w.result, { event: 'result', spawned: 1 }); assert.equal(await w.exit, 0);
  await processing.startVideoProcessing(String(item._id)); await processing.completeVideoProcessing(String(item._id));
  assert.equal(await upload.autoUploadVideoToYouTube(String(item._id)), null);
  const completed = await Video.findById(item._id).lean();
  assert.equal(completed.processing.status, 'completed'); assert.equal(completed.youtubeVideoId, item.youtubeVideoId);
  assert.equal(completed.videoUrl, item.videoUrl); assert.ok(fs.existsSync(completed.filePath));
  assert.equal(completed.youtubeUpload.localSourceRestoredAt.getTime(), restored.youtubeUpload.localSourceRestoredAt.getTime());
});
it('F3-T3 兩個 Node 同時重新處理，只讓一個實際呼叫假的 STT spawn', async () => {
  const item = await video(); const a = worker({ action: 'reprocess', id: String(item._id) }); const b = worker({ action: 'reprocess', id: String(item._id), role: 'admin' });
  await Promise.all([a.ready,b.ready]); a.child.send('continue'); b.child.send('continue');
  const results = await Promise.all([a.result,b.result]); await Promise.all([a.exit,b.exit]);
  assert.equal(results.filter(r => r.event === 'result').length, 1); assert.equal(results.reduce((n,r) => n + r.spawned,0), 1);
  assert.equal(results.find(r => r.event === 'error').code, 'VIDEO_PROCESSING_TRANSITION_INVALID');
  assert.equal((await upload.cleanupUploadedLocalVideo(String(item._id))).cleaned, false);
  assert.ok(fs.existsSync(item.filePath));
});
it('F3-T3 來源檢查後另一 Backend 完成清理，舊重新處理不得排程', async () => {
  const item = await video(); const w = worker({ action: 'reprocess', id: String(item._id) }); await w.ready;
  assert.equal((await upload.cleanupUploadedLocalVideo(String(item._id))).cleaned, true);
  w.child.send('continue'); const result = await w.result; await w.exit;
  assert.equal(result.event, 'error'); assert.equal(result.spawned, 0);
  const current = await Video.findById(item._id).lean(); assert.equal(current.filePath, null); assert.equal(current.processing.status, 'completed');
});
it('F3-T3 清理 intent 阻擋重新處理，DB claim 失敗不更動完成狀態', async () => {
  const item = await video(); const owner = await cleanup.claimCleanupSource('video', item, await cleanup.inspectCleanupSource('video',item), {});
  try { await assert.rejects(videoService.retryExistingVideoProcessing(String(item._id), { id: String(teacherId), role: 'teacher' }), { code: 'VIDEO_PROCESSING_TRANSITION_INVALID' }); }
  finally { await owner.release(); }
  const original = Video.findOneAndUpdate; Video.findOneAndUpdate = async () => { throw new Error('injected queue DB failure'); };
  try { await assert.rejects(videoService.retryExistingVideoProcessing(String(item._id), { id: String(teacherId), role: 'teacher' }), /injected queue/); }
  finally { Video.findOneAndUpdate = original; }
  assert.equal((await Video.findById(item._id).lean()).processing.status, 'completed'); assert.ok(fs.existsSync(item.filePath));
});
it('F4-T3 兩個 Node 首次建立與既有值競爭，稽核連續且不重複', async () => {
  const a = worker({ action: 'history', userId: String(teacherId), email: 'one@example.test', values: [true,false,true,false] });
  const b = worker({ action: 'history', userId: String(adminId), email: 'two@example.test', values: [false,true,false,true] });
  await Promise.all([a.ready,b.ready]); a.child.send('continue'); b.child.send('continue');
  assert.equal((await a.result).event, 'result'); assert.equal((await b.result).event, 'result'); await Promise.all([a.exit,b.exit]);
  assert.equal(await Setting.countDocuments({ key: 'youtubeLifecycle.upload' }), 1);
  const doc = await Setting.findOne({ key: 'youtubeLifecycle.upload' }).lean(); assert.equal(doc.history.length, 8);
  assert.equal(doc.history[0].from, null);
  for (let i=1;i<doc.history.length;i++) assert.equal(doc.history[i].from, doc.history[i-1].to);
  assert.equal(doc.history.at(-1).to, doc.value);
  for (const entry of doc.history) { assert.ok([String(teacherId),String(adminId)].includes(String(entry.changedBy))); assert.ok(entry.changedAt instanceof Date); }
});
it('F4-T3 同值、舊缺欄位、50 筆上限及 DB 失敗均保持正確紀錄', async () => {
  await Setting.collection.insertOne({ key: 'youtubeLifecycle.upload' });
  for (let i=0;i<55;i++) await settings.setYouTubeLifecycleSwitch({ key: 'upload', enabled: i % 3 === 0, user: { id: String(adminId), email: 'admin@example.test' } });
  const before = await Setting.findOne({ key: 'youtubeLifecycle.upload' }).lean(); assert.equal(before.history.length, 50);
  for (let i=1;i<before.history.length;i++) assert.equal(before.history[i].from, before.history[i-1].to);
  const original = Setting.findOneAndUpdate; Setting.findOneAndUpdate = () => { throw new Error('injected setting DB failure'); };
  try { await assert.rejects(settings.setYouTubeLifecycleSwitch({ key: 'upload', enabled: true }), /injected setting/); }
  finally { Setting.findOneAndUpdate = original; }
  assert.deepEqual(await Setting.findOne({ key: 'youtubeLifecycle.upload' }).lean(), before);
});
