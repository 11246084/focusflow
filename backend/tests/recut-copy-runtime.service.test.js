'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { COPY_COLLECTIONS, createRecutCopyRuntime, createRecutLocalRepository } = require('../src/services/recutCopyRuntime.service');
const { main } = require('../src/scripts/recutCopyCourses');
const ids = ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'];
const localUri = 'mongodb://127.0.0.1:27131/recut_trial';
function fakeDriver({ failRead = false } = {}) {
  const reads = [], writes = [], connects = [], closed = [], localDocuments = {}; let sequence = 0;
  class ObjectId { constructor(value) { this.value = value || `${++sequence}`.padStart(24, '0'); } toString() { return this.value; } }
  const documents = { courses: ids.map((id) => ({ _id: new ObjectId(id), videoIds: [new ObjectId('cccccccccccccccccccccccc')] })),
    videos: [{ _id: new ObjectId('cccccccccccccccccccccccc'), videoId: 'pipeline-video' }], video_segments_text: [{ _id: 'leaf', videoId: 'pipeline-video', text: 'original' }],
    questions: [{ _id: 'q' }], shortscripts: [{ _id: new ObjectId(ids[0]), courseId: new ObjectId(ids[1]), topic: 'test', recut: { revision: 0, activeTaskId: null } }] };
  class MongoClient {
    constructor(uri) { this.uri = uri; }
    async connect() { connects.push(this.uri === localUri ? 'local' : 'source'); }
    async close() { closed.push(true); }
    db() { return { collection: (name) => ({
      find: (query) => ({ toArray: async () => { reads.push({ name, query, local: this.uri === localUri }); if (failRead) throw new Error(this.uri); return this.uri === localUri ? (localDocuments[name] || []).filter((row) => query._id.$in.some((id) => String(id) === String(row._id))) : documents[name] || []; } }),
      findOne: async () => documents[name]?.[0],
      bulkWrite: async (operations) => { assert.equal(this.uri, localUri); writes.push({ name, operations }); let upsertedCount = 0;
        const local = localDocuments[name] ||= [];
        for (const { updateOne } of operations) if (!local.some((row) => String(row._id) === String(updateOne.filter._id))) { local.push({ ...updateOne.update.$setOnInsert }); upsertedCount++; }
        return { upsertedCount }; },
      insertOne: async (row) => { assert.equal(this.uri, localUri); writes.push({ name, row }); },
      updateOne: async (query, update) => { assert.equal(this.uri, localUri); writes.push({ name, query, update }); return { matchedCount: 1 }; },
    }) }; }
  }
  return { driverLoader: () => ({ MongoClient, ObjectId }), reads, writes, connects, closed, localDocuments };
}
it('course-scoped native reader uses exact canonical collections, defaults dry-run, never exposes source writer', async () => {
  const f = fakeDriver(), tool = createRecutCopyRuntime({ ...f, sourceUri: 'mongodb+srv://secret:p@source/db', targetUri: localUri });
  assert.equal(f.connects.length, 0);
  const result = await tool.copy({ courseIds: ids });
  assert.deepEqual(f.reads.filter((r) => !r.local).map((r) => r.name), COPY_COLLECTIONS); assert.equal(f.writes.length, 0); assert.deepEqual(f.connects, ['source', 'local']);
  assert.deepEqual(f.reads[2].query, { videoId: { $in: ['cccccccccccccccccccccccc', 'pipeline-video'] } });
  assert.ok(f.reads[3].query.courseId.$in.length === 2); assert.equal(result.counts.video_segments_text, 1);
  assert.equal(JSON.stringify(result).includes('mongodb'), false);
  await tool.copy({ courseIds: ids, execute: true }); assert.equal(f.writes.length, 5); assert.equal(f.connects.at(-1), 'local');
  assert.equal(f.writes.find((w) => w.name === 'video_segments_text').operations[0].updateOne.update.$setOnInsert.text, 'original');
});
it('copy reruns are insert-only and dry-run reports existing/wouldInsert without changing teacher state', async () => {
  const f = fakeDriver(), tool = createRecutCopyRuntime({ ...f, sourceUri: 'source', targetUri: localUri });
  const first = await tool.copy({ courseIds: ids, execute: true }); assert.equal(first.inserted.shortscripts, 1);
  const script = f.localDocuments.shortscripts[0];
  script.recut = { revision: 7, currentVersionId: 'local-version', currentAssetId: 'local-asset', state: 'asset_approved', approval: { teacher: 'approved' }, pendingEditId: 'local-edit' };
  script.topic = '老師修改的問題'; script.versions = [{ no: 2 }];
  const before = JSON.stringify(script), writes = f.writes.length;
  const dry = await tool.copy({ courseIds: ids });
  assert.equal(dry.existing.shortscripts, 1); assert.equal(dry.wouldInsert.shortscripts, 0); assert.equal(f.writes.length, writes);
  const repeated = await tool.copy({ courseIds: ids, execute: true });
  assert.equal(repeated.inserted.shortscripts, 0); assert.equal(JSON.stringify(f.localDocuments.shortscripts[0]), before);
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

it('local trial budget reservation is atomic across processes, never refunded, and rejects earlier successful runs', async () => {
  const rows = new Map(), collections = new Set(); let closeCount = 0;
  class ObjectId { constructor(value) { this.value = value; } toString() { return this.value; } }
  const script = { _id: new ObjectId(ids[0]), courseId: new ObjectId(ids[1]) };
  let priorRun = false;
  class MongoClient {
    async connect() {} async close() { closeCount++; }
    db() { return { collection: (name) => { collections.add(name); return {
      findOne: async () => name === 'shortscripts' ? script : name === 'recuttrialruns' && priorRun ? { scriptId: script._id } : null,
      insertOne: async (row) => { const key = String(row._id); if (rows.has(key)) throw Object.assign(new Error('duplicate'), { code: 11000 }); rows.set(key, row); },
    }; } }; }
  }
  const policy = { modelId: 'gemini-3.8-flash', maxCalls: 5, maxRequestBytes: 100000, maxOutputTokens: 4096,
    budgetUsd: 0.5, inputPerMillion: 0.75, outputPerMillion: 3.75, validUntil: '2026-12-31' };
  const input = { scriptId: ids[0], courseId: ids[1] }, options = { targetUri: localUri, driverLoader: () => ({ MongoClient, ObjectId }) };
  const first = createRecutLocalRepository(options), parallel = createRecutLocalRepository(options);
  const claims = await Promise.allSettled([first.reserveTrialBudget({ input, policy }), parallel.reserveTrialBudget({ input, policy })]);
  assert.equal(claims.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(claims.find((r) => r.status === 'rejected').reason.code, 'RECUT_TRIAL_BUDGET_ALREADY_RESERVED');
  await first.close(); await parallel.close();
  const restarted = createRecutLocalRepository(options);
  // A new process or changed policy/output cannot restart a paid authorization.
  await assert.rejects(restarted.reserveTrialBudget({ input, policy: { ...policy, budgetUsd: 0.4 } }), { code: 'RECUT_TRIAL_BUDGET_ALREADY_RESERVED' });
  assert.equal(rows.size, 1); assert.equal(rows.get(ids[0]).refundable, false);
  assert.deepEqual([...collections].sort(), ['recuttrialbudgets', 'recuttrialruns', 'shortscripts']);
  await restarted.close();
  rows.clear(); priorRun = true;
  const historical = createRecutLocalRepository(options);
  await assert.rejects(historical.reserveTrialBudget({ input, policy }), { code: 'RECUT_TRIAL_BUDGET_ALREADY_RESERVED' });
  assert.equal(rows.size, 0); await historical.close(); assert.equal(closeCount, 4);
});
