'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { COPY_COLLECTIONS, createRecutCopyRuntime, createRecutLocalRepository } = require('../src/services/recutCopyRuntime.service');
const { main } = require('../src/scripts/recutCopyCourses');
const ids = ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'];
const localUri = 'mongodb://127.0.0.1:27131/recut_trial';
function fakeDriver({ failRead = false } = {}) {
  const reads = [], writes = [], connects = [], closed = []; let sequence = 0;
  class ObjectId { constructor(value) { this.value = value || `${++sequence}`.padStart(24, '0'); } toString() { return this.value; } }
  const documents = { courses: ids.map((id) => ({ _id: new ObjectId(id), videoIds: [new ObjectId('cccccccccccccccccccccccc')] })),
    videos: [{ _id: new ObjectId('cccccccccccccccccccccccc'), videoId: 'pipeline-video' }], video_segments_text: [{ _id: 'leaf', videoId: 'pipeline-video', text: 'original' }],
    questions: [{ _id: 'q' }], shortscripts: [{ _id: new ObjectId(ids[0]), courseId: new ObjectId(ids[1]), topic: 'test', recut: { revision: 0, activeTaskId: null } }] };
  class MongoClient {
    constructor(uri) { this.uri = uri; }
    async connect() { connects.push(this.uri === localUri ? 'local' : 'source'); }
    async close() { closed.push(true); }
    db() { return { collection: (name) => ({
      find: (query) => ({ toArray: async () => { reads.push({ name, query }); if (failRead) throw new Error(this.uri); return documents[name] || []; } }),
      findOne: async () => documents[name]?.[0],
      bulkWrite: async (operations) => { assert.equal(this.uri, localUri); writes.push({ name, operations }); },
      insertOne: async (row) => { assert.equal(this.uri, localUri); writes.push({ name, row }); },
      updateOne: async (query, update) => { assert.equal(this.uri, localUri); writes.push({ name, query, update }); return { matchedCount: 1 }; },
    }) }; }
  }
  return { driverLoader: () => ({ MongoClient, ObjectId }), reads, writes, connects, closed };
}
it('course-scoped native reader uses exact canonical collections, defaults dry-run, never exposes source writer', async () => {
  const f = fakeDriver(), tool = createRecutCopyRuntime({ ...f, sourceUri: 'mongodb+srv://secret:p@source/db', targetUri: localUri });
  assert.equal(f.connects.length, 0);
  const result = await tool.copy({ courseIds: ids });
  assert.deepEqual(f.reads.map((r) => r.name), COPY_COLLECTIONS); assert.equal(f.writes.length, 0); assert.deepEqual(f.connects, ['source']);
  assert.deepEqual(f.reads[2].query, { videoId: { $in: ['cccccccccccccccccccccccc', 'pipeline-video'] } });
  assert.ok(f.reads[3].query.courseId.$in.length === 2); assert.equal(result.counts.video_segments_text, 1);
  assert.equal(JSON.stringify(result).includes('mongodb'), false);
  await tool.copy({ courseIds: ids, execute: true }); assert.equal(f.writes.length, 5); assert.equal(f.connects.at(-1), 'local');
  assert.equal(f.writes.find((w) => w.name === 'video_segments_text').operations[0].replaceOne.replacement.text, 'original');
});
it('rejects shared targets, URI authority tricks and invalid courses before connecting', async () => {
  const f = fakeDriver();
  for (const uri of ['mongodb+srv://shared/db', 'mongodb://127.0.0.1:27131@shared/db', 'mongodb://shared@127.0.0.1:27131/db', 'mongodb://127.0.0.1:27131,shared:27017/db', 'mongodb://127.0.0.1%2f@shared/db', 'mongodb://localhost:27131/db?directConnection=false']) {
    assert.throws(() => createRecutCopyRuntime({ ...f, sourceUri: 'secret', targetUri: uri }), { code: 'RECUT_LOCAL_DB_REQUIRED' });
  }
  await assert.rejects(createRecutCopyRuntime({ ...f, sourceUri: 'secret', targetUri: localUri }).copy({ courseIds: ['one', 'two'] }), { code: 'RECUT_COURSES_INVALID' }); assert.equal(f.connects.length, 0);
});
it('driver failure hides connection URI and closes source client', async () => {
  const f = fakeDriver({ failRead: true });
  await assert.rejects(createRecutCopyRuntime({ ...f, sourceUri: 'mongodb+srv://private:p@source/db', targetUri: localUri }).copy({ courseIds: ids }), (e) => e.code === 'RECUT_COPY_FAILED' && !e.message.includes('mongodb') && !JSON.stringify(e).includes('private'));
  assert.equal(f.closed.length, 1);
});
it('native local snapshot defaults transcriptVersion legacy, preserves chunks and creates RC8 version/asset/suggestions/run references', async () => {
  const f = fakeDriver(), repository = createRecutLocalRepository({ ...f, targetUri: localUri });
  await repository.saveSource({ scriptId: ids[0], videoId: ids[1], sentences: [], transcriptChunks: [{ chunkId: 'leaf' }] });
  assert.equal(f.writes[0].name, 'recutsources'); assert.equal(f.writes[0].row.transcriptVersion, 'legacy');
  assert.deepEqual(f.writes[0].row.transcriptChunks, [{ chunkId: 'leaf' }]);
  const refs = await repository.persistLocal({ input: { scriptId: ids[0], courseId: ids[1] }, result: { version: { sourceId: ids[1], selection: { answerable: true }, plan: {} },
    state: 'script_review', asset: { filePath: 'D:/local/final.mp4' }, callsUsed: 3, attempts: [], suggestions: [{ suggestionType: 'x', proposal: { kind: 'presentation' } }] } });
  assert.ok(refs.versionId); assert.ok(refs.assetId);
  assert.deepEqual(f.writes.map((w) => w.name), ['recutsources', 'recutversions', 'recutreviewevents', 'shortassets', 'shortscripts', 'recuttrialruns']);
  const script = f.writes.find((w) => w.update); assert.equal(script.update.$set['recut.state'], 'script_review');
  assert.equal(f.writes.some((w) => w.name === 'video_segments_text'), false); await repository.close();
});
it('copy CLI uses only named environment entries and emits only safe manifest', async () => {
  let options;
  const result = await main(['--source-uri-env', 'RECUT_SOURCE', '--target-uri-env', 'RECUT_LOCAL', '--courses', ids.join(',')], {
    env: { RECUT_SOURCE: 'private', RECUT_LOCAL: localUri }, runtimeFactory: (args) => { options = args; return { copy: async (args) => ({ dryRun: !args.execute }) }; } });
  assert.equal(options.sourceUri, 'private'); assert.deepEqual(result, { dryRun: true });
});
