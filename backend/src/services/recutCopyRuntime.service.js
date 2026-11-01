'use strict';
const { assertLoopbackMongoTarget, fail } = require('./recutRuntime.service');
const COPY_COLLECTIONS = Object.freeze(['courses', 'videos', 'video_segments_text', 'questions', 'shortscripts']);
const safe = (code) => fail('本機試產資料操作失敗；請檢查具名連線設定與授權範圍。', code);
function validateCourses(courseIds) {
  if (!Array.isArray(courseIds) || courseIds.length !== 2 || new Set(courseIds).size !== 2 || courseIds.some((id) => !/^[a-f\d]{24}$/i.test(id))) throw safe('RECUT_COURSES_INVALID');
}
function driverDefault() { return require('mongodb'); }
function createRecutCopyRuntime({ sourceUri, targetUri, driverLoader = driverDefault } = {}) {
  assertLoopbackMongoTarget(targetUri);
  // Keep URIs solely in this closure, never in the manifest, errors or logs.
  return { async copy({ courseIds, execute = false } = {}) {
    validateCourses(courseIds);
    const { MongoClient, ObjectId } = driverLoader();
    let source, target;
    try {
      const ids = courseIds.map((id) => new ObjectId(id));
      source = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 10000 });
      await source.connect();
      const db = source.db();
      // The only operations exposed to the source are find/toArray; no generic
      // callback receives the source client or database handle.
      const read = (name, query) => db.collection(name).find(query).toArray();
      const courses = await read('courses', { _id: { $in: ids } });
      if (courses.length !== 2) throw safe('RECUT_COURSES_NOT_FOUND');
      const refs = courses.flatMap((c) => c.videoIds || []);
      const videos = await read('videos', { $or: [{ courseId: { $in: ids } }, { _id: { $in: refs } }] });
      const videoIds = [...new Set(videos.flatMap((v) => [String(v._id), v.videoId, v.video_id]).filter(Boolean))];
      const rows = { courses, videos,
        video_segments_text: await read('video_segments_text', { videoId: { $in: videoIds } }),
        questions: await read('questions', { courseId: { $in: ids } }),
        shortscripts: await read('shortscripts', { courseId: { $in: ids } }) };
      // Read local identities even in dry-run, so the preview distinguishes new
      // snapshots from documents that must preserve local review and approvals.
      assertLoopbackMongoTarget(targetUri);
      target = new MongoClient(targetUri, { serverSelectionTimeoutMS: 10000 });
      await target.connect();
      const existing = {}, wouldInsert = {}, inserted = {};
      for (const name of COPY_COLLECTIONS) {
        const local = target.db().collection(name);
        const found = rows[name].length ? await local.find({ _id: { $in: rows[name].map((d) => d._id) } }, { projection: { _id: 1 } }).toArray() : [];
        existing[name] = new Set(found.map((d) => String(d._id))).size;
        wouldInsert[name] = rows[name].length - existing[name];
        inserted[name] = 0;
        if (execute && rows[name].length) {
          // Atomic insert-only upsert also preserves a local document created
          // between this preview and the write. Never overwrite source chunks,
          // teacher edits, recut state, approvals or version/asset references.
          assertLoopbackMongoTarget(targetUri);
          const result = await local.bulkWrite(rows[name].map((document) => ({ updateOne: {
            filter: { _id: document._id }, update: { $setOnInsert: document }, upsert: true } })), { ordered: true });
          inserted[name] = result.upsertedCount;
        }
      }
      return { dryRun: !execute, courseIds: [...courseIds], counts: Object.fromEntries(COPY_COLLECTIONS.map((name) => [name, rows[name].length])), existing, wouldInsert, inserted };
    } catch (error) { throw safe(/^RECUT_[A-Z_]+$/.test(error.code || '') ? error.code : 'RECUT_COPY_FAILED'); }
    finally { for (const client of [target, source]) if (client) await client.close().catch(() => {}); }
  } };
}

// Native-driver local repository. All writes stay on one validated loopback
// connection; no Mongoose connect/autoIndex or source-chunk mutation is used.
function createRecutLocalRepository({ targetUri, driverLoader = driverDefault } = {}) {
  assertLoopbackMongoTarget(targetUri);
  let client, db, ObjectId;
  const ready = async () => {
    if (!db) {
      const driver = driverLoader(); ObjectId = driver.ObjectId;
      client = new driver.MongoClient(targetUri, { serverSelectionTimeoutMS: 10000 }); await client.connect(); db = client.db();
    }
    return db;
  };
  const guarded = (action) => async (...args) => {
    try { assertLoopbackMongoTarget(targetUri); await ready(); return await action(...args); }
    catch (error) { throw safe(/^RECUT_[A-Z_]+$/.test(error.code || '') ? error.code : 'RECUT_LOCAL_DB_FAILED'); }
  };
  const id = (value) => new ObjectId(String(value));
  const find = (name, value) => db.collection(name).findOne({ _id: id(value) });
  return {
    loadSource: guarded((value) => find('recutsources', value)),
    loadBaseVersion: guarded((value) => find('recutversions', value)),
    loadScript: guarded((value) => find('shortscripts', value)),
    resolveSourcePath: guarded(async (value) => {
      const video = await find('videos', value);
      if (!(video?.filePath || video?.file_path)) throw safe('RECUT_SOURCE_UNAVAILABLE');
      return video.filePath || video.file_path;
    }),
    saveSource: guarded(async (source) => {
      const row = { ...source, _id: new ObjectId(), scriptId: id(source.scriptId), videoId: id(source.videoId), transcriptVersion: source.transcriptVersion || 'legacy', createdAt: new Date(), updatedAt: new Date() };
      await db.collection('recutsources').insertOne(row); return row;
    }),
    loadInputs: guarded(async (task) => {
      const script = await find('shortscripts', task.scriptId);
      if (!script || String(script.courseId) !== String(task.courseId)) throw safe('RECUT_SOURCE_UNAVAILABLE');
      const course = await find('courses', task.courseId);
      const hitRows = (script.evidence || []).filter((s) => s.expandedFrom == null);
      const videos = await db.collection('videos').find({ $or: [{ courseId: id(task.courseId) }, { _id: { $in: course?.videoIds || [] } }] }).toArray();
      const video = videos.find((v) => hitRows.every((h) => [String(v._id), v.videoId, v.video_id].includes(String(h.videoId))));
      if (!hitRows.length || !video || !(video.filePath || video.file_path)) throw safe('RECUT_SOURCE_UNAVAILABLE');
      const aliases = [String(video._id), video.videoId, video.video_id].filter(Boolean);
      const segments = await db.collection('video_segments_text').find({ videoId: { $in: aliases } }).toArray();
      return { script, video: { ...video, filePath: video.filePath || video.file_path },
        hits: hitRows.map((h) => ({ ...h, videoId: String(video._id) })), segments: segments.map((s) => ({ ...s, videoId: String(video._id) })) };
    }),
    persistLocal: guarded(async ({ result, input }) => {
      const script = await find('shortscripts', input.scriptId);
      if (!script || String(script.courseId) !== String(input.courseId) || script.recut?.activeTaskId) throw safe('RECUT_STATE_INVALID');
      const now = new Date(), versionId = new ObjectId();
      const version = { ...result.version, _id: versionId, scriptId: id(input.scriptId), sourceId: id(result.version.sourceId), taskId: null, createdAt: now, updatedAt: now };
      await db.collection('recutversions').insertOne(version);
      for (const suggestion of result.suggestions || []) await db.collection('recutreviewevents').insertOne({ ...suggestion, _id: new ObjectId(), scriptId: script._id,
        versionId, kind: 'suggestion', adopted: null, createdAt: now, updatedAt: now, occurredAt: now });
      let assetId = null;
      if (result.asset?.filePath) {
        assetId = new ObjectId();
        await db.collection('shortassets').insertOne({ _id: assetId, courseId: script.courseId, title: script.topic,
          sourceScriptId: script._id, recutVersionId: versionId, filePath: result.asset.filePath, status: 'draft', reviewStatus: 'pending', generationVersion: 1, createdAt: now, updatedAt: now });
      }
      const update = await db.collection('shortscripts').updateOne({ _id: script._id, 'recut.revision': script.recut?.revision ?? { $exists: false }, 'recut.activeTaskId': null },
        { $set: { productionMode: 'recut', 'recut.state': result.state, 'recut.currentVersionId': versionId, 'recut.currentAssetId': assetId,
          'recut.currentAssetGenerationVersion': assetId ? 1 : null, 'recut.activeTaskId': null, updatedAt: now }, $inc: { 'recut.revision': 1 } });
      if (update.matchedCount !== 1) throw safe('RECUT_STATE_INVALID');
      await db.collection('recuttrialruns').insertOne({ _id: new ObjectId(), scriptId: script._id, versionId, assetId, callsUsed: result.callsUsed, attempts: result.attempts, createdAt: now });
      return { versionId: String(versionId), assetId: assetId && String(assetId) };
    }),
    close: async () => { if (client) await client.close().catch(() => {}); db = null; client = null; },
  };
}
module.exports = { COPY_COLLECTIONS, createRecutCopyRuntime, createRecutLocalRepository };
