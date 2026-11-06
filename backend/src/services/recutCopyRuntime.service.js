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
  const scriptSignature = (script) => require('./recutTrialResume.service').canonicalSha256({
    _id: script._id, courseId: script.courseId, topic: script.topic, status: script.status, recut: script.recut });
  const verifyResumeState = async (resume, requireTicket = true) => {
    const { canonicalSha256 } = require('./recutTrialResume.service');
    const cp = resume.checkpoint, input = resume.input;
    const script = await find('shortscripts', input.scriptId), source = await find('recutsources', cp.source._id);
    const budget = await find('recuttrialbudgets', input.scriptId);
    if (!script || !source || !budget || String(script.courseId) !== input.courseId
      || canonicalSha256(source) !== resume.identity.sourceCanonicalSha256
      || canonicalSha256({ _id: script._id, recut: script.recut, status: script.status }) !== canonicalSha256(cp.script)
      || script.topic !== resume.frozenQuestion
      || canonicalSha256([...(script.sourceQuestions || [])].sort((a, b) => b.askCount - a.askCount).slice(0, 5).map(({ question, askCount }) => ({ question, askCount }))) !== canonicalSha256(resume.frozenVariants)
      || await db.collection('recuttrialruns').findOne({ scriptId: script._id })) throw safe('RECUT_TRIAL_RESUME_INVALID');
    const projection = Object.fromEntries(Object.keys(cp.budget).map((key) => [key, budget[key]]));
    if (canonicalSha256(projection) !== canonicalSha256(cp.budget)) throw safe('RECUT_TRIAL_RESUME_INVALID');
    if (requireTicket && (!budget.resumeClaimed || budget.resumeTicketHash !== resume.ticketHash
      || budget.originalReportSha256 !== resume.identity.originalReportSha256
      || budget.resumeProviderCalls !== resume.identity.providerCalls || !Number.isFinite(budget.resumeReservedUsd) || Math.abs(budget.resumeReservedUsd - resume.identity.reservedUsd) > 1e-10
      || budget.resumeWorkflowCallsUsed !== resume.identity.workflowCallsUsed || budget.maxAdditionalCalls !== 2
      || budget.resumeOutput !== resume.ticket.output || budget.sourceCanonicalSha256 !== resume.identity.sourceCanonicalSha256
      || canonicalSha256(budget.resumeIdentity) !== canonicalSha256(resume.identity))) throw safe('RECUT_TRIAL_RESUME_INVALID');
    return { script, source, budget };
  };
  return {
    // One authorization owns at most one budget for this local script, even
    // after process crashes or a caller changes the output directory.
    reserveTrialBudget: guarded(async ({ input, policy, identity }) => {
      require('./recutTrialGuard.service').createRecutTrialGuard(policy);
      const script = await find('shortscripts', input.scriptId);
      if (!script || String(script.courseId) !== String(input.courseId)) throw safe('RECUT_SOURCE_UNAVAILABLE');
      if (await db.collection('recuttrialruns').findOne({ scriptId: script._id })) throw safe('RECUT_TRIAL_BUDGET_ALREADY_RESERVED');
      try {
        await db.collection('recuttrialbudgets').insertOne({ _id: script._id, scriptId: script._id, courseId: script.courseId,
          modelId: policy.modelId, maxCalls: policy.maxCalls, budgetUsd: policy.budgetUsd,
          maxRequestBytes: policy.maxRequestBytes, maxOutputTokens: policy.maxOutputTokens,
          status: 'reserved', createdAt: new Date(), refundable: false, providerCallsUsed: 0, cumulativeBudgetReservationUsd: 0,
          ...(identity ? { initialCheckpointIdentity: identity } : {}) });
      } catch (error) {
        if (error.code === 11000) throw safe('RECUT_TRIAL_BUDGET_ALREADY_RESERVED');
        throw error;
      }
      return { modelId: policy.modelId, maxCalls: policy.maxCalls, budgetUsd: policy.budgetUsd, status: 'reserved' };
    }),
    recordTrialFailure: guarded(async ({ input, reportSha256, checkpointSha256, workflowCallsUsed, providerCallsUsed, reservedUsd }) => {
      if (!/^[a-f0-9]{64}$/.test(reportSha256 || '') || !/^[a-f0-9]{64}$/.test(checkpointSha256 || '')) throw safe('RECUT_TRIAL_RESUME_INVALID');
      const saved = await db.collection('recuttrialbudgets').updateOne({ _id: id(input.scriptId), status: 'reserved',
        resumeClaimed: { $exists: false }, failureReportSha256: { $exists: false },
      }, { $set: { failureReportSha256: reportSha256, failureCheckpointSha256: checkpointSha256,
        workflowCallsUsed, providerCallsUsed, cumulativeBudgetReservationUsd: reservedUsd } });
      if (saved.matchedCount !== 1) throw safe('RECUT_TRIAL_RESUME_ALREADY_CLAIMED');
    }),
    recordTrialReservation: guarded(async ({ input, request, resume }) => {
      const budget = await find('recuttrialbudgets', input.scriptId);
      if (!budget || (resume && (!budget.resumeClaimed || budget.resumeTicketHash !== resume.ticketHash))
        || !Number.isInteger(request.trialModelCalls) || request.trialModelCalls !== budget.providerCallsUsed + 1
        || request.trialModelCalls > budget.maxCalls || request.requestedModelId !== budget.modelId
        || !Number.isFinite(request.budgetReservationUsd) || request.budgetReservationUsd <= 0
        || !Number.isFinite(request.cumulativeBudgetReservationUsd) || request.cumulativeBudgetReservationUsd > budget.budgetUsd
        || request.cumulativeBudgetReservationUsd <= budget.cumulativeBudgetReservationUsd
        || Math.abs(request.cumulativeBudgetReservationUsd - budget.cumulativeBudgetReservationUsd - request.budgetReservationUsd) > 1e-10) throw safe('RECUT_TRIAL_RESUME_INVALID');
      const saved = await db.collection('recuttrialbudgets').updateOne({ _id: budget._id,
        providerCallsUsed: budget.providerCallsUsed, cumulativeBudgetReservationUsd: budget.cumulativeBudgetReservationUsd,
        ...(resume ? { resumeTicketHash: resume.ticketHash } : { resumeClaimed: { $exists: false } }),
      }, { $set: { providerCallsUsed: request.trialModelCalls, cumulativeBudgetReservationUsd: request.cumulativeBudgetReservationUsd,
        lastReservation: request, reservationRecordedAt: new Date() } });
      if (saved.matchedCount !== 1) throw safe('RECUT_TRIAL_RESUME_ALREADY_CLAIMED');
    }),
    claimTrialResume: guarded(async (resume) => {
      const { script, budget } = await verifyResumeState(resume, false);
      if (budget.resumeClaimed) throw safe('RECUT_TRIAL_RESUME_ALREADY_CLAIMED');
      if ((budget.providerCallsUsed !== undefined && budget.providerCallsUsed !== resume.identity.providerCalls)
        || (budget.cumulativeBudgetReservationUsd !== undefined && Math.abs(budget.cumulativeBudgetReservationUsd - resume.identity.reservedUsd) > 1e-10)) throw safe('RECUT_TRIAL_RESUME_INVALID');
      const result = await db.collection('recuttrialbudgets').updateOne({ _id: script._id,
        status: 'reserved', modelId: resume.config.model.model, maxCalls: 5, budgetUsd: 0.5,
        maxRequestBytes: 100000, maxOutputTokens: 4096, refundable: false,
        createdAt: new Date(resume.checkpoint.budget.createdAt), resumeClaimed: { $exists: false },
        providerCallsUsed: budget.providerCallsUsed === undefined ? { $exists: false } : budget.providerCallsUsed,
        cumulativeBudgetReservationUsd: budget.cumulativeBudgetReservationUsd === undefined ? { $exists: false } : budget.cumulativeBudgetReservationUsd,
      }, { $set: { resumeClaimed: true, resumeTicketHash: resume.ticketHash,
        originalReportSha256: resume.identity.originalReportSha256,
        resumeProviderCalls: resume.identity.providerCalls, resumeReservedUsd: resume.identity.reservedUsd,
        resumeWorkflowCallsUsed: resume.identity.workflowCallsUsed, maxAdditionalCalls: 2,
        providerCallsUsed: resume.identity.providerCalls, cumulativeBudgetReservationUsd: resume.identity.reservedUsd,
        sourceCanonicalSha256: resume.identity.sourceCanonicalSha256, resumeIdentity: resume.identity,
        resumeOutput: resume.ticket.output, resumeClaimedAt: new Date() } });
      if (result.matchedCount !== 1) throw safe('RECUT_TRIAL_RESUME_ALREADY_CLAIMED');
      // Catch a source/script edit which raced the claim; the ticket is never released.
      await verifyResumeState(resume);
      return { ticketHash: resume.ticketHash };
    }),
    verifyTrialResume: guarded((resume) => verifyResumeState(resume)),
    recordResumeGeneration: guarded(async (resume, generation) => {
      const { script } = await verifyResumeState(resume);
      if (generation.providerCallsUsed > 5 || generation.cumulativeBudgetReservationUsd > 0.5) throw safe('RECUT_TRIAL_RESUME_INVALID');
      const saved = await db.collection('recuttrialbudgets').updateOne({ _id: id(resume.input.scriptId),
        resumeClaimed: true, resumeTicketHash: resume.ticketHash, resumeGenerationSha256: { $exists: false },
      }, { $set: { resumeGenerationSha256: generation.sha256, resumeGenerationArtifact: generation.artifact,
        generationSha256: generation.sha256, generationScriptSha256: scriptSignature(script),
        generationSourceSha256: resume.identity.sourceCanonicalSha256,
        providerCallsUsed: generation.providerCallsUsed, workflowCallsUsed: generation.workflowCallsUsed,
        cumulativeBudgetReservationUsd: generation.cumulativeBudgetReservationUsd, generationVerifiedAt: new Date() } });
      if (saved.matchedCount !== 1) throw safe('RECUT_TRIAL_RESUME_ALREADY_CLAIMED');
    }),
    recordTrialGeneration: guarded(async ({ input, source, generation }) => {
      const { canonicalSha256 } = require('./recutTrialResume.service');
      const script = await find('shortscripts', input.scriptId), currentSource = await find('recutsources', source._id);
      if (!script || String(script.courseId) !== input.courseId || script.recut?.activeTaskId
        || canonicalSha256(currentSource) !== canonicalSha256(source)) throw safe('RECUT_TRIAL_RESUME_INVALID');
      const saved = await db.collection('recuttrialbudgets').updateOne({ _id: script._id, status: 'reserved', generationSha256: { $exists: false } },
        { $set: { generationSha256: generation.sha256, generationArtifact: generation.artifact,
          generationScriptSha256: scriptSignature(script), generationSourceSha256: canonicalSha256(source) } });
      if (saved.matchedCount !== 1) throw safe('RECUT_TRIAL_RESUME_ALREADY_CLAIMED');
    }),
    // Trials without a paid policy have no budget row. Their verified generation is
    // bound in an insert-only ledger keyed by the checkpoint hash, with the same
    // source and script signatures the budget path records.
    // Same eligibility rule as recordLocalGeneration, checked before any model call.
    assertLocalGenerationAllowed: guarded(async ({ input }) => {
      const script = await find('shortscripts', input.scriptId);
      if (!script || String(script.courseId) !== input.courseId) throw safe('RECUT_SOURCE_UNAVAILABLE');
      if (await db.collection('recuttrialbudgets').findOne({ _id: script._id })) throw safe('RECUT_TRIAL_RESUME_INVALID');
    }),
    recordLocalGeneration: guarded(async ({ input, source, generation }) => {
      const { canonicalSha256 } = require('./recutTrialResume.service');
      const script = await find('shortscripts', input.scriptId), currentSource = await find('recutsources', source._id);
      if (!script || String(script.courseId) !== input.courseId || script.recut?.activeTaskId || !generation?.sha256
        || canonicalSha256(currentSource) !== canonicalSha256(source)) throw safe('RECUT_TRIAL_RESUME_INVALID');
      if (await db.collection('recuttrialbudgets').findOne({ _id: script._id })) throw safe('RECUT_TRIAL_RESUME_INVALID');
      if (await db.collection('recuttrialgenerations').findOne({ _id: generation.sha256 })) throw safe('RECUT_TRIAL_RESUME_ALREADY_CLAIMED');
      await db.collection('recuttrialgenerations').insertOne({ _id: generation.sha256, scriptId: script._id, courseId: script.courseId,
        sourceId: currentSource._id, artifact: generation.artifact, status: 'verified',
        generationScriptSha256: scriptSignature(script), generationSourceSha256: canonicalSha256(source), createdAt: new Date() });
    }),
    verifyTrialGeneration: guarded(async (checkpoint, { ledger = 'budget' } = {}) => {
      const { canonicalSha256 } = require('./recutTrialResume.service');
      const source = checkpoint.payload.source, script = await find('shortscripts', source.scriptId);
      const record = ledger === 'local' ? await db.collection('recuttrialgenerations').findOne({ _id: checkpoint.sha256 })
        : await find('recuttrialbudgets', source.scriptId);
      const currentSource = await find('recutsources', source._id);
      const boundHash = ledger === 'local' ? record?._id : record?.generationSha256;
      if (!script || !record || boundHash !== checkpoint.sha256 || canonicalSha256(checkpoint.payload) !== checkpoint.sha256
        || (ledger === 'local' && String(record.scriptId) !== String(script._id))
        || record.generationSourceSha256 !== canonicalSha256(currentSource) || canonicalSha256(currentSource) !== canonicalSha256(source)
        || record.generationScriptSha256 !== scriptSignature(script) || script.recut?.activeTaskId) throw safe('RECUT_TRIAL_RESUME_INVALID');
    }),
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
      const cachedSource = script.localTrialSourceId ? await find('recutsources', script.localTrialSourceId) : null;
      if (script.localTrialSourceId && (!cachedSource || String(cachedSource.scriptId) !== String(script._id) || String(cachedSource.videoId) !== String(video._id))) throw safe('RECUT_SOURCE_CACHE_INVALID');
      return { script, video: { ...video, filePath: video.filePath || video.file_path },
        cachedSource, hits: hitRows.map((h) => ({ ...h, videoId: String(video._id) })), segments: segments.map((s) => ({ ...s, videoId: String(video._id) })) };
    }),
    persistLocal: guarded(async ({ result, input, expectedRevision }) => {
      const script = await find('shortscripts', input.scriptId);
      if (!script || String(script.courseId) !== String(input.courseId) || script.recut?.activeTaskId
        || (expectedRevision !== undefined && script.recut?.revision !== expectedRevision)) throw safe('RECUT_STATE_INVALID');
      // A local-ledger generation persists once: claim it (verified -> persisting)
      // with one conditional update before any insert, so a second or concurrent
      // persist is refused before writing. This is not a transaction: a failure
      // after the claim leaves the row in "persisting" (and possibly a version or
      // asset row) for manual inspection; it is never retried automatically.
      if (result.generationCheckpoint?.ledger === 'local') {
        const claim = await db.collection('recuttrialgenerations').updateOne({ _id: result.generationCheckpoint.sha256, status: 'verified' }, { $set: { status: 'persisting' } });
        if (claim.matchedCount !== 1) throw safe('RECUT_TRIAL_RESUME_INVALID');
      }
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
      await db.collection('recuttrialruns').insertOne({ _id: new ObjectId(), scriptId: script._id, versionId, assetId, callsUsed: result.callsUsed, ...(result.resume ? { providerCallsUsed: result.providerCallsUsed, workflowCallsUsed: result.workflowCallsUsed, resume: result.resume } : {}), attempts: result.attempts, createdAt: now });
      if (result.generationCheckpoint?.ledger === 'local') {
        const saved = await db.collection('recuttrialgenerations').updateOne({ _id: result.generationCheckpoint.sha256, status: 'persisting' },
          { $set: { status: 'persisted', versionId, assetId, generationScriptSha256: scriptSignature(await find('shortscripts', input.scriptId)) } });
        if (saved.matchedCount !== 1) throw safe('RECUT_TRIAL_RESUME_INVALID');
      } else if (result.generationCheckpoint) {
        const saved = await db.collection('recuttrialbudgets').updateOne({ _id: script._id, generationSha256: result.generationCheckpoint.sha256 },
          { $set: { generationScriptSha256: scriptSignature(await find('shortscripts', input.scriptId)) } });
        if (saved.matchedCount !== 1) throw safe('RECUT_TRIAL_RESUME_INVALID');
      }
      return { versionId: String(versionId), assetId: assetId && String(assetId) };
    }),
    close: async () => { if (client) await client.close().catch(() => {}); db = null; client = null; },
  };
}
module.exports = { COPY_COLLECTIONS, createRecutCopyRuntime, createRecutLocalRepository };
