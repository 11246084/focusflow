'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { bootstrapRecutTrial } = require('../src/services/recutTrialBootstrap.service');
const { validateSnapshotCache } = require('../src/services/recutSnapshotCache.service');
const { createRecutLocalRuntime } = require('../src/services/recutLocalRuntime.service');
const { runSingleTopicTrial } = require('../src/services/recutRuntimeTrial.service');
const { main } = require('../src/scripts/recutBootstrapTrial');
const { fixture, fakeRenderer } = require('./helpers/recutPipelineFixtures');
const sha = 'A'.repeat(64), targetUri = 'mongodb://127.0.0.1:27131/recut_trial_professor-siri';
const input = () => ({ trialId: 'professor-siri', videoPath: 'D:/local/professor-5.mp4', allowedRoot: 'D:/local', topic: 'Siri 如何處理問題？', startSec: 0, endSec: 150,
  authorization: { scope: 'local-trial-only', originalAudio: true, reference: '當次使用者本機試產授權；未驗收教授正式內容同意' } });
const inspectFile = async () => ({ filePath: 'D:/local/professor-5.mp4', sizeBytes: 123, sha256: sha });
function cache() { const f = fixture(); return { sourceSha256: sha, transcriptVersion: 'historical-small-cache', asrProvenance: { kind: 'historical-cache', freshAsr: false },
  window: { startSec: 0, endSec: 150, segments: [{ chunkId: 'legacy-seg-1', startSec: 0, endSec: 150 }] }, sentences: f.source.sentences, excludedSentenceIds: ['s1'] }; }
function driver() {
  const docs = {}, writes = []; let connections = 0;
  class ObjectId { constructor(v) { this.value = v; } toString() { return this.value; } }
  class MongoClient {
    constructor(uri) { assert.equal(uri, targetUri); }
    async connect() { connections++; } async close() {}
    db() { return { collection: (name) => ({ findOne: async (query) => (docs[name] || []).find((d) => query.email ? d.email === query.email : String(d._id) === String(query._id)) || null,
      updateOne: async (query, update) => { writes.push(name); const rows = docs[name] ||= [];
        if (rows.some((d) => String(d._id) === String(query._id))) return { upsertedCount: 0 };
        rows.push(update.$setOnInsert); return { upsertedCount: 1 }; } }) }; }
  }
  return { driverLoader: () => ({ MongoClient, ObjectId }), docs, writes, connections: () => connections };
}
it('bootstrap defaults dry-run with no DB/hash/model work and keeps authorization separate from formal consent', async () => {
  let hash = false, db = false;
  const result = await bootstrapRecutTrial({ input: input(), targetUri, inspectFile, hashPassword: async () => { hash = true; }, driverLoader: () => { db = true; } });
  assert.equal(result.dryRun, true); assert.equal(hash, false); assert.equal(db, false); assert.equal(result.estimatedModelCalls, 0);
  assert.equal(result.authorization.formalTeacherConsentAccepted, false); assert.equal(result.authorization.publicationAllowed, false);
  assert.equal(result.teacherEmail, 'recut-professor-siri@trial.invalid'); assert.equal(result.passwordMode, 'generated-unrevealed-local-password');
});
it('bootstrap only permits dedicated loopback DB, explicit local-audio authorization and 2–3 minute window', async () => {
  for (const uri of ['mongodb+srv://shared/db', 'mongodb://127.0.0.1:27131/focusflow', 'mongodb://127.0.0.1:27131/recut_trial_other']) await assert.rejects(bootstrapRecutTrial({ input: input(), targetUri: uri, inspectFile }));
  await assert.rejects(bootstrapRecutTrial({ input: { ...input(), authorization: {} }, targetUri, inspectFile }), { code: 'RECUT_TRIAL_AUTHORIZATION_REQUIRED' });
  await assert.rejects(bootstrapRecutTrial({ input: { ...input(), endSec: 20 }, targetUri, inspectFile }), { code: 'RECUT_TRIAL_IMPORT_INVALID' });
});
it('native insert-only bootstrap creates independent local teacher/course/candidate and preserves rerun edits', async () => {
  const d = driver(); let secret;
  const result = await bootstrapRecutTrial({ input: input(), targetUri, execute: true, inspectFile, ...d, hashPassword: async (value) => { secret = value; return 'fake-hash-only'; } });
  assert.equal(secret.length, 64); assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(result).includes('fake-hash-only'));
  assert.equal(d.docs.users[0].role, 'teacher'); assert.equal(d.docs.users[0].email.endsWith('@trial.invalid'), true);
  assert.equal(d.docs.videos[0].processing.errorCode, 'LOCAL_TRIAL_WINDOW_ONLY'); assert.equal(d.docs.video_segments_text[0].text, '');
  assert.equal(String(d.docs.courses[0].teacherId), result.ids.teacher); assert.equal(String(d.docs.shortscripts[0].courseId), result.ids.course);
  d.docs.shortscripts[0].recut = { revision: 7, state: 'asset_approved', currentVersionId: 'keep-version', currentAssetId: 'keep-asset' };
  const before = JSON.stringify(d.docs.shortscripts[0]);
  const again = await bootstrapRecutTrial({ input: input(), targetUri, execute: true, inspectFile, ...d, hashPassword: async () => 'new-hash-not-written' });
  assert.equal(again.inserted.shortscripts, 0); assert.equal(JSON.stringify(d.docs.shortscripts[0]), before); assert.equal(d.docs.users[0].passwordHash, 'fake-hash-only');
});
it('explicit historical cache requires source fingerprint/window and retains provenance/excluded boundary sentences', async () => {
  const d = driver(), result = await bootstrapRecutTrial({ input: input(), sourceSnapshotCache: cache(), targetUri, execute: true, inspectFile, ...d, hashPassword: async () => 'hash' });
  assert.equal(result.transcriptStatus, 'historical-cache-explicitly-reused'); assert.equal(result.sourceSnapshot.asrProvenance.freshAsr, false);
  assert.equal(d.docs.recutsources[0].sourceCheck.passed, false); assert.deepEqual(d.docs.recutsources[0].excludedSentenceIds, ['s1']);
  assert.ok(d.docs.recutsources[0].sentences[0].chunkIds[0].startsWith('local-trial-professor-siri-'));
  assert.equal(String(d.docs.shortscripts[0].localTrialSourceId), result.ids.source);
  assert.throws(() => validateSnapshotCache({ ...cache(), sourceSha256: 'B'.repeat(64) }, { sourceSha256: sha, startSec: 0, endSec: 150 }), { code: 'RECUT_SOURCE_CACHE_INVALID' });
  await assert.rejects(bootstrapRecutTrial({ input: input(), sourceSnapshotCache: cache(), targetUri, inspectFile: async () => ({ ...await inspectFile(), sha256: 'B'.repeat(64) }) }), { code: 'RECUT_SOURCE_CACHE_INVALID' });
});
it('fresh snapshot keeps fresh provenance, derives documented clipped boundaries and never fabricates invalid word times', async () => {
  const fresh = cache(); delete fresh.excludedSentenceIds;
  fresh.asrProvenance = { kind: 'fresh-local-asr', limitations: ['First and last sentences clipped by window; do not select'],
    excludedWords: [{ word: '到', start: 149.98, end: 149.98 }] };
  const result = await bootstrapRecutTrial({ input: input(), sourceSnapshotCache: fresh, targetUri, inspectFile });
  assert.equal(result.transcriptStatus, 'fresh-local-asr-snapshot-explicitly-reused'); assert.deepEqual(result.sourceSnapshot.excludedSentenceIds, ['s1', 's6']);
  assert.equal(result.sourceSnapshot.asrProvenance.excludedWords[0].start, result.sourceSnapshot.asrProvenance.excludedWords[0].end);
  const invalid = cache(); invalid.sentences[2].words[0].endSec = invalid.sentences[2].words[0].startSec;
  assert.throws(() => validateSnapshotCache(invalid, { sourceSha256: sha, startSec: 0, endSec: 150 }), { code: 'RECUT_SOURCE_CACHE_INVALID' });
});
it('cached runtime skips ASR, verifies source, preserves historical provenance and rejects excluded sentence selection', async () => {
  const f = fixture(), snapshot = { ...f.source, ...cache(), startSec: 0, endSec: 150, transcriptChunks: cache().window.segments }; let verified = 0, asr = 0, stored, calls = 0;
  const selection = structuredClone(f.selection); delete selection.lockedSentenceIds;
  const valid = structuredClone(selection); valid.ranges = [{ from: 's2', to: 's6' }]; valid.sentenceLabels[0].label = '離題';
  const outputs = [selection, valid, f.cards, { issues: [] }];
  const repository = { loadInputs: async () => ({ script: { topic: 'Siri' }, video: { _id: 'video', filePath: 'fake.mp4' }, cachedSource: snapshot,
    hits: [{ chunkId: 'manual', videoId: 'video', startSec: 0, endSec: 150 }], segments: [{ chunkId: 'manual', videoId: 'video', startSec: 0, endSec: 150 }] }),
    saveSource: async (value) => (stored = { ...value, _id: 'new-source' }), loadSource: async () => stored, loadScript: async () => ({ _id: 'script', topic: 'Siri' }) };
  const runtime = createRecutLocalRuntime({ repository, model: { provider: 'gemini', model: 'fake' }, renderer: fakeRenderer(), allowModel: true,
    verifyCachedSource: async () => { verified++; }, provider: async () => { calls++; return { output: outputs.shift() }; },
    media: { probe: async () => ({ streams: [{ codec_type: 'audio' }], format: { duration: 150 } }), decode: async () => {}, measure: async () => ({ integratedLufs: -18, truePeakDbtp: -4 }), transcribe: async () => { asr++; } } });
  const result = await runSingleTopicTrial({ ...runtime, input: { scriptId: 'script', courseId: 'course' }, allowModel: true });
  assert.equal(asr, 0); assert.equal(verified, 1); assert.equal(calls, 4); assert.equal(result.state, 'script_review');
  assert.equal(stored.asrProvenance.freshAsr, false); assert.equal(stored.sourceCheck.passed, true); assert.equal(result.version.selection.ranges[0].from, 's2');
});
it('bootstrap CLI dry-run never reads password or creates output files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-bootstrap-test-'));
  try {
    const file = path.join(directory, 'input.json'); await fs.writeFile(file, JSON.stringify(input()));
    const result = await main(['--input', file, '--target-uri-env', 'RECUT_LOCAL', '--teacher-password-env', 'TRIAL_PASSWORD', '--output', path.join(directory, 'out')], {
      env: new Proxy({}, { get(_object, key) { if (key !== 'RECUT_LOCAL') throw new Error('password must not be read'); return targetUri; } }),
      bootstrap: (args) => bootstrapRecutTrial({ ...args, inspectFile }) });
    assert.equal(result.dryRun, true); assert.deepEqual(await fs.readdir(directory), ['input.json']);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
