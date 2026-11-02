'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { assertLoopbackMongoTarget, fail } = require('./recutRuntime.service');
const { hashLocalFile, validateSnapshotCache } = require('./recutSnapshotCache.service');
const invalid = (code = 'RECUT_TRIAL_IMPORT_INVALID') => fail('本機影片試產匯入設定無效。', code);
async function inspectTrialVideo(videoPath, allowedRoot) {
  if (![videoPath, allowedRoot].every((p) => typeof p === 'string' && path.isAbsolute(p) && !/^[\\/]{2}/.test(p))) throw invalid();
  const root = await fs.realpath(allowedRoot), file = await fs.realpath(videoPath), relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/\.mp4$/i.test(file) || !(await fs.stat(file)).isFile()) throw invalid();
  return { filePath: file, sizeBytes: (await fs.stat(file)).size, sha256: await hashLocalFile(file) };
}
async function bootstrapRecutTrial({ input, targetUri, execute = false, password, sourceSnapshotCache, inspectFile = inspectTrialVideo,
  driverLoader = () => require('mongodb'), hashPassword = (value) => require('bcryptjs').hash(value, 10), now = () => new Date() } = {}) {
  const target = assertLoopbackMongoTarget(targetUri);
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(input?.trialId || '') || target.database !== `recut_trial_${input.trialId}`
    || typeof input.topic !== 'string' || !input.topic.trim() || input.topic.length > 200
    || !Number.isFinite(input.startSec) || !Number.isFinite(input.endSec) || input.startSec < 0 || input.endSec - input.startSec < 120 || input.endSec - input.startSec > 180) throw invalid();
  if (input.authorization?.scope !== 'local-trial-only' || input.authorization.originalAudio !== true || typeof input.authorization.reference !== 'string' || !input.authorization.reference.trim()) throw invalid('RECUT_TRIAL_AUTHORIZATION_REQUIRED');
  const video = await inspectFile(input.videoPath, input.allowedRoot);
  if (input.sourceSnapshotCache && !sourceSnapshotCache) throw invalid('RECUT_SOURCE_CACHE_INVALID');
  const cache = sourceSnapshotCache ? validateSnapshotCache({ ...sourceSnapshotCache,
    ...(input.excludedSentenceIds ? { excludedSentenceIds: [...new Set([...(sourceSnapshotCache.excludedSentenceIds || []), ...input.excludedSentenceIds])] } : {}) },
  { sourceSha256: video.sha256, startSec: input.startSec, endSec: input.endSec }) : null;
  const hex = (kind) => crypto.createHash('sha256').update(`focusflow-local-recut-trial-v1:${input.trialId}:${kind}`).digest('hex').slice(0, 24);
  const ids = Object.fromEntries(['teacher', 'course', 'video', 'script', 'segment', 'source', 'audit'].map((kind) => [kind, hex(kind)]));
  const email = `recut-${input.trialId}@trial.invalid`;
  const manifest = { dryRun: !execute, trialId: input.trialId, database: target.database, ids, teacherEmail: email,
    counts: { users: 1, courses: 1, videos: 1, video_segments_text: 1, shortscripts: 1, recutlocaltrials: 1 },
    input: { courseId: ids.course, scriptId: ids.script }, source: { filePath: video.filePath, sizeBytes: video.sizeBytes, startSec: input.startSec, endSec: input.endSec },
    authorization: { reference: input.authorization.reference, scope: 'local-trial-only', originalAudio: true, publicationAllowed: false, formalTeacherConsentAccepted: false },
    transcriptStatus: cache ? cache.asrProvenance.kind === 'fresh-local-asr' ? 'fresh-local-asr-snapshot-explicitly-reused' : 'historical-cache-explicitly-reused' : 'not-transcribed', estimatedModelCalls: 0,
    sourceSnapshot: cache ? { sourceSha256: cache.sourceSha256, transcriptVersion: cache.transcriptVersion, sentenceCount: cache.sentences.length, excludedSentenceIds: cache.excludedSentenceIds, asrProvenance: cache.asrProvenance } : null,
    passwordMode: password ? 'explicit-local-password' : 'generated-unrevealed-local-password' };
  if (cache) manifest.counts.recutsources = 1;
  if (!execute) return manifest;
  if (password !== undefined && (typeof password !== 'string' || password.length < 12 || password.length > 128)) throw invalid('RECUT_TRIAL_PASSWORD_REQUIRED');
  const localPassword = password || crypto.randomBytes(32).toString('hex');
  let client;
  try {
    const { MongoClient, ObjectId } = driverLoader();
    const id = (kind) => new ObjectId(ids[kind]), at = now();
    client = new MongoClient(targetUri, { serverSelectionTimeoutMS: 10000 }); await client.connect();
    const db = client.db(), common = { localTrialId: input.trialId, createdAt: at, updatedAt: at };
    const account = await db.collection('users').findOne({ email });
    if (account && (String(account._id) !== ids.teacher || account.localTrialId !== input.trialId)) throw invalid('RECUT_TRIAL_ACCOUNT_CONFLICT');
    const documents = {
      users: { ...common, _id: id('teacher'), name: '本機 recut 試產教師', email, passwordHash: await hashPassword(localPassword),
        role: 'teacher', isActive: true, mustChangePassword: false, emailVerifiedAt: at, tokenVersion: 0 },
      courses: { ...common, _id: id('course'), title: `本機試產：${input.trialId}`, description: '獨立本機測試資料；不是正式課程或內容授權驗收。', teacherId: id('teacher'), videoIds: [id('video')], status: 'draft', deletedAt: null },
      videos: { ...common, _id: id('video'), courseId: id('course'), uploadedBy: id('teacher'), title: path.basename(video.filePath),
        sourceType: 'upload', filePath: video.filePath, deletedAt: null, activeTranscriptVersion: 'legacy',
        processing: { status: 'failed', errorCode: 'LOCAL_TRIAL_WINDOW_ONLY', errorMessage: '僅建立手動試產視窗，尚未執行完整影片轉錄。' } },
      video_segments_text: { ...common, _id: id('segment'), courseId: id('course'), videoId: ids.video,
        chunkId: `local-trial-${input.trialId}-window`, segmentId: `local-trial-${input.trialId}-window`, startSec: input.startSec, endSec: input.endSec,
        text: '', transcriptVersion: 'legacy', provenance: 'manual-local-trial-window-not-transcript' },
      shortscripts: { ...common, _id: id('script'), courseId: id('course'), topic: input.topic.trim(), topicKey: `local-trial-${input.trialId}`, status: 'evidence_ready',
        createdBy: id('teacher'), productionMode: 'recut', recut: { state: 'idle', revision: 0, currentVersionId: null, currentAssetId: null, activeTaskId: null }, versions: [], sourceQuestions: [],
        evidenceFrozenAt: at, evidence: [{ code: 'E1', chunkId: `local-trial-${input.trialId}-window`, videoId: ids.video,
          videoTitle: path.basename(video.filePath), startSec: input.startSec, endSec: input.endSec, rawText: '', expandedFrom: null }] },
      recutlocaltrials: { ...common, _id: id('audit'), authorization: manifest.authorization, videoId: id('video'), scriptId: id('script'),
        sourceRange: { startSec: input.startSec, endSec: input.endSec }, sourcePath: video.filePath, transcriptStatus: manifest.transcriptStatus, notFormalConsent: true },
    };
    if (cache) {
      const namespace = (value) => `local-trial-${input.trialId}-${value}`;
      documents.recutsources = { ...common, _id: id('source'), scriptId: id('script'), videoId: id('video'), startSec: input.startSec, endSec: input.endSec, frozenAt: at,
        hitChunkIds: [], sourceSha256: cache.sourceSha256, transcriptVersion: cache.transcriptVersion, asrProvenance: cache.asrProvenance,
        excludedSentenceIds: cache.excludedSentenceIds, sourceCheck: { passed: false, results: null, checkedAt: null },
        transcriptChunks: (cache.window.segments || []).map((s) => ({ ...s, chunkId: namespace(s.chunkId) })),
        sentences: cache.sentences.map((s) => ({ ...s, chunkIds: s.chunkIds.map(namespace) })) };
      documents.shortscripts.localTrialSourceId = id('source');
    }
    // Preflight every deterministic identity before the first write. A normal
    // local account/course can never be repurposed as trial data.
    for (const [name, document] of Object.entries(documents)) {
      const existing = await db.collection(name).findOne({ _id: document._id });
      if (existing && existing.localTrialId !== input.trialId) throw invalid('RECUT_TRIAL_DATA_CONFLICT');
    }
    const inserted = {};
    for (const [name, document] of Object.entries(documents)) {
      assertLoopbackMongoTarget(targetUri);
      const result = await db.collection(name).updateOne({ _id: document._id }, { $setOnInsert: document }, { upsert: true });
      inserted[name] = result.upsertedCount || 0;
    }
    return { ...manifest, inserted };
  } catch (error) { throw invalid(/^RECUT_[A-Z_]+$/.test(error.code || '') ? error.code : 'RECUT_TRIAL_IMPORT_FAILED'); }
  finally { await client?.close().catch(() => {}); }
}
module.exports = { bootstrapRecutTrial, inspectTrialVideo };
