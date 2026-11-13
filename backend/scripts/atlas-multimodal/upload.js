// Development acceptance only. One private journal per approved upload generation.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { BSON, ObjectId, MongoClient } = require('mongodb');
const { parseArgs } = require('node:util');
const c = require('./control');
const index = require('./index-control');
const { permissions } = require('./video1');
const { readAtlasIndex } = require('../../src/services/atlasMultimodalAdapter.service');

async function snapshot(db, collection, videoId) {
  const privileges = await db.command({ connectionStatus: 1, showPrivileges: true });
  const actions = permissions(privileges.authInfo?.authenticatedUserPrivileges || []);
  if (!actions.find || !actions.update || !actions.listSearchIndexes) throw new Error('Missing privileges');
  const definition = await readAtlasIndex(collection);
  index.assertSnapshot(definition);
  if (!index.ready(definition, definition.latestDefinition) || c.indexPlan(definition).added.length) {
    throw new Error('Three-path index is not ready');
  }
  const video = await db.collection('videos').findOne({ _id: new ObjectId(videoId), deletedAt: null, 'processing.status': 'completed' },
    { projection: { courseId: 1, activeTranscriptVersion: 1, fileHash: 1, 'processing.completedAt': 1,
      'processing.multimodal.version': 1, 'processing.multimodal.mode': 1 } });
  if (!video) throw new Error('Completed upload missing');
  return { database: db.databaseName, collection: collection.collectionName, videos: [video],
    documents: await collection.find({ videoId }, { maxTimeMS: 15000 }).sort({ chunkId: 1 }).toArray(),
    index: { id: definition.id, definition: definition.latestDefinition, version: definition.latestDefinitionVersion }, actions };
}

async function run(db, directory, options = {}) {
  const lock = path.join(directory, 'atlas-worker.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date() }));
    return await runOwned(db, directory, options);
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

async function runOwned(db, directory, { approve, restore = false, plan = 'atlas-before.json' } = {}) {
  if (!/^atlas-before(?:-[a-zA-Z0-9_-]{1,64})?\.json$/.test(plan)) throw new Error('Invalid plan file');
  const load = name => BSON.EJSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'), { relaxed: true });
  const save = (name, value) => {
    const fd = fs.openSync(path.join(directory, name), 'wx', 0o600);
    try { fs.writeFileSync(fd, BSON.EJSON.stringify(value, { relaxed: false })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  };
  const bundle = JSON.parse(fs.readFileSync(path.join(directory, 'bundle.json'), 'utf8'));
  const videoId = bundle.records?.[0]?.identity?.videoId;
  const courseId = bundle.records?.[0]?.identity?.courseId;
  if (bundle.executionMode !== 'gemini' || !ObjectId.isValid(videoId)) throw new Error('Real upload required');
  const collection = db.collection('video_segments_text');
  if (!/^[a-f0-9]{64}$/.test(bundle.sourceSha256) || !/^[a-f0-9]{64}$/.test(bundle.manifestHash)) {
    throw new Error('Invalid source or generation digest');
  }
  const current = await snapshot(db, collection, videoId);
  const owner = current.videos[0];
  if (owner.fileHash !== bundle.sourceSha256 || owner.processing.multimodal?.version !== bundle.manifestHash
    || owner.processing.multimodal?.mode !== 'gemini') throw new Error('Upload checkpoint binding changed');
  const planFile = plan;
  if (!fs.existsSync(path.join(directory, planFile))) {
    if (approve || restore) throw new Error('Prepare the plan before approval');
    c.planUploadWrites(current, bundle, videoId, courseId);
    save(planFile, current);
  }
  const before = load(planFile);
  const approvalHash = c.hash({ before, bundle, restore });
  const writes = c.planUploadWrites(before, bundle, videoId, courseId);
  if (!approve) {
    if (c.hash(current.videos) !== c.hash(before.videos) || c.hash(current.index) !== c.hash(before.index)
      || c.hash(current.actions) !== c.hash(before.actions)) throw new Error('Existing plan is stale');
    return { status: 'awaiting_atlas_approval', approvalHash, planFile };
  }
  if (approve !== approvalHash) throw new Error('Plan approval mismatch');
  const report = async status => {
    const result = await db.collection('videos').updateOne({ _id: owner._id, courseId: owner.courseId,
      fileHash: owner.fileHash, deletedAt: null, 'processing.status': 'completed',
      'processing.completedAt': owner.processing.completedAt, 'processing.multimodal.version': bundle.manifestHash },
    { $set: { 'processing.multimodal.status': status } });
    if (result.matchedCount !== 1) throw new Error('Upload generation changed');
  };
  const evidence = randomUUID();
  save(evidence + '-before.json', current);
  const check = async live => {
    if (c.hash(live.videos) !== c.hash(before.videos) || c.hash(live.index) !== c.hash(before.index)
      || c.hash(live.actions) !== c.hash(before.actions)
      || c.hash(live.documents.map(d => d._id)) !== c.hash(before.documents.map(d => d._id))) {
      throw new Error('Upload version, allowlist, index or privilege conflict');
    }
    for (const [i, plan] of writes.entries()) {
      const row = live.documents[i];
      if (c.protectedHash(row, plan.keys) !== plan.protectedHash || !(c.hash(row) === c.hash(plan.before)
        || plan.keys.every(k => c.hash(c.get(row, k)) === c.hash(plan.desired[k])))) {
        throw new Error('Live before-image conflict');
      }
    }
  };
  try {
    await check(current);
    await report('verifying');
    return await executeBatches();
  } catch (error) {
    save(evidence + '-stopped.json', { approvalHash, status: 'stopped', errorType: error.name });
    await report('stopped');
    throw error;
  }
  async function executeBatches() {
    for (let offset = 0; offset < writes.length; offset += 10) {
      for (const [marker, status] of [['cancel', 'cancelled'], ['pause', 'paused']]) {
        if (fs.existsSync(path.join(directory, marker))) { await report(status); return { status }; }
      }
      await check(await snapshot(db, collection, videoId));
      const execute = restore ? c.rollbackPlan : c.applyPlan;
      await execute(collection, writes.slice(offset, offset + 10), { execute: true,
        intent: async event => {
          const live = await readAtlasIndex(collection);
          index.assertSnapshot(live);
          if (!index.ready(live, live.latestDefinition) || c.hash(live.latestDefinition) !== c.hash(before.index.definition)
            || String(live.id) !== String(before.index.id) || c.hash(live.latestDefinitionVersion) !== c.hash(before.index.version)) {
            throw new Error('Index changed before update');
          }
          save(evidence + '-' + randomUUID() + '-intent.json', event);
        },
        receipt: rows => save(evidence + '-' + randomUUID() + '-receipt.json', rows.at(-1)) });
    }
    const final = await snapshot(db, collection, videoId);
    await check(final);
    if (restore ? c.hash(final.documents) !== c.hash(before.documents)
      : (await c.applyPlan(collection, writes)).some(r => r.status !== 'already_applied')) {
      throw new Error('Final readback failed');
    }
    const result = { status: restore ? 'restored' : 'verified', approvalHash };
    save(evidence + '-complete.json', result);
    await report(restore ? 'awaiting_atlas_approval' : 'ready');
    return result;
  }
}

if (require.main === module) {
  const { values } = parseArgs({ options: { directory: { type: 'string' }, approve: { type: 'string' },
    restore: { type: 'boolean' }, plan: { type: 'string' } } });
  const dbClient = new MongoClient(require('../../src/config/env').mongodbUri, {
    retryWrites: false, retryReads: false, serverSelectionTimeoutMS: 15000 });
  run(dbClient.db('focusflow'), values.directory, values).then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('Upload Atlas operation stopped. Inspect private journal.'); process.exitCode = 1; })
    .finally(() => dbClient.close());
}
module.exports = { run };
