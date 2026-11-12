// V1 orchestration around the existing B/CAS tools. Never starts the application.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { MongoClient, BSON } = require('mongodb');
const c = require('./control');
const scopeTools = require('./video1-scope');
const { backup, readBackup, localPath } = require('./run');
const { readAtlasIndex } = require('../../src/services/atlasMultimodalAdapter.service');
const indexControl = require('./index-control');
function permissions(privileges) {
  return Object.fromEntries(['find', 'update', 'listSearchIndexes', 'updateSearchIndex'].map(action => [action,
    privileges.some(p => (p.resource?.anyResource || ['', 'focusflow'].includes(p.resource?.db)
      && ['', 'video_segments_text'].includes(p.resource?.collection))
      && (p.actions?.includes(action) || p.actions?.includes('anyAction')))]));
}
function save(file, data, exclusive = false) {
  file = localPath(file); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, BSON.EJSON.stringify(data, { relaxed: false }), { flag: exclusive ? 'wx' : 'w', mode: 0o600 });
}
function load(file) { return BSON.EJSON.parse(fs.readFileSync(localPath(file), 'utf8'), { relaxed: true }); }
function validateBackup(snapshot, scope, bundle) {
  if (snapshot.documents.length !== 694 || new Set(snapshot.documents.map(d => d.chunkId)).size !== 694
    || snapshot.videos.length !== 6) throw new Error('Incomplete six-video backup');
  indexControl.assertSnapshot(snapshot.index);
  if (!indexControl.ready(snapshot.index, snapshot.index.latestDefinition)) throw new Error('Index not fully ready');
  const documents = snapshot.documents.filter(d => scope.ids.includes(d.chunkId));
  return c.planWrites({ ...snapshot, documents }, bundle, 'B', scope);
}
async function freshChecks(db, collection, plan) {
  const status = await db.command({ connectionStatus: 1, showPrivileges: true });
  const actions = permissions(status.authInfo?.authenticatedUserPrivileges || []);
  if (!actions.find || !actions.update || !actions.listSearchIndexes) throw new Error('Required privileges unverified');
  const index = await readAtlasIndex(collection);
  indexControl.assertSnapshot(index);
  const definitionHash = c.hash(index.latestDefinition);
  if (!indexControl.ready(index, index.latestDefinition)
    || ![plan.index.beforeHash, plan.index.afterHash].includes(definitionHash)
    || String(index.id) !== plan.indexId
    || Number(index.latestDefinitionVersion.version) !== Number(plan.indexVersion) + (definitionHash === plan.index.beforeHash ? 0 : 1)) throw new Error('Live index identity/definition conflict');
  const videos = await db.collection('videos').find({ _id: { $in: plan.videoIds } },
    { projection: { _id: 1, courseId: 1, activeTranscriptVersion: 1 }, maxTimeMS: 15000 }).toArray();
  if (c.hash(videos.sort((a, b) => String(a._id).localeCompare(String(b._id)))) !== plan.videoVersionsHash
    || c.hash(actions) !== plan.permissionsHash) throw new Error('Live permission/version conflict');
}
function planHash(plan) { const { approvalHash, ...body } = plan; return c.hash(body); }
async function prepare(db, collection, { scope, manifestHash, bundle, bundleHash, backupFile }) {
  // Full backup is automatic and must be durably reread before any plan exists.
  await backup(db, collection, backupFile);
  const snapshot = readBackup(backupFile);
  const writes = validateBackup(snapshot, scope, bundle);
  const status = await db.command({ connectionStatus: 1, showPrivileges: true });
  const actions = permissions(status.authInfo?.authenticatedUserPrivileges || []);
  if (!actions.find || !actions.update || !actions.listSearchIndexes) throw new Error('Required privileges unverified');
  const index = c.indexPlan(snapshot.index, 'B');
  const plan = { schemaVersion: 'video1_write_plan_v1', manifestHash, bundleHash,
    backupFile: localPath(backupFile), backupHash: c.hash(snapshot), index,
    indexId: String(snapshot.index.id), indexVersion: snapshot.index.latestDefinitionVersion.version,
    videoIds: snapshot.videos.map(v => v._id), permissionsHash: c.hash(actions),
    videoVersionsHash: c.hash([...snapshot.videos].sort((a, b) => String(a._id).localeCompare(String(b._id)))),
    targetHash: c.hash(writes), indexUpdatePermission: actions.updateSearchIndex };
  return { ...plan, approvalHash: planHash(plan) };
}
async function execute(db, collection, { plan, scope, bundle, manifestHash, bundleHash, approvePlan, executeWrite = false,
  direction = 'forward', receipt = async () => {}, intent = async () => {}, freshBackupFile }) {
  if (plan.schemaVersion !== 'video1_write_plan_v1' || planHash(plan) !== plan.approvalHash
    || plan.manifestHash !== manifestHash || plan.bundleHash !== bundleHash) throw new Error('Plan binding failed');
  if (executeWrite && approvePlan !== plan.approvalHash) throw new Error('Explicit plan hash required');
  const snapshot = readBackup(plan.backupFile);
  if (c.hash(snapshot) !== plan.backupHash) throw new Error('Backup changed');
  const writes = validateBackup(snapshot, scope, bundle);
  if (c.hash(writes) !== plan.targetHash) throw new Error('Target preimages changed');
  if (executeWrite) {
    if (!freshBackupFile) throw new Error('Automatic fresh backup destination required');
    await backup(db, collection, freshBackupFile);
    const fresh = readBackup(freshBackupFile);
    if (fresh.documents.length !== 694 || fresh.videos.length !== 6) throw new Error('Fresh full backup incomplete');
  }
  await freshChecks(db, collection, plan);
  // Before the first update, preflight EVERY target. Individual writes still use CAS.
  for (const p of writes) {
    const row = await collection.findOne({ _id: p.before._id }, { maxTimeMS: 15000 });
    if (!row || c.protectedHash(row) !== p.protectedHash || !(c.hash(row) === c.hash(p.before)
      || p.keys.every(k => c.hash(c.get(row, k)) === c.hash(p.desired[k])))) throw new Error('Live before-image conflict');
  }
  if (!['forward', 'restore'].includes(direction)) throw new Error('Invalid direction');
  return direction === 'restore' ? c.rollbackPlan(collection, writes, { execute: executeWrite, receipt, intent })
    : c.applyPlan(collection, writes, { execute: executeWrite, receipt, intent });
}
async function main() {
  const { values: v } = parseArgs({ options: {
    mode: { type: 'string', default: 'dry-run' }, manifest: { type: 'string' }, bundle: { type: 'string' },
    'approve-manifest': { type: 'string' }, plan: { type: 'string' }, 'approve-plan': { type: 'string' },
    'execute-index': { type: 'boolean', default: false }, 'approve-index': { type: 'string' },
    'execute-write': { type: 'boolean', default: false }, output: { type: 'string' },
  } });
  if (!['dry-run', 'apply', 'rollback', 'index-plan', 'index-update', 'index-restore'].includes(v.mode)
    || v['execute-write'] && !['apply', 'rollback'].includes(v.mode)
    || v['execute-index'] && !['index-update', 'index-restore'].includes(v.mode)) throw new Error('Invalid operation');
  const scope = scopeTools.readManifest(localPath(v.manifest), v['approve-manifest']);
  const bundleBytes = fs.readFileSync(localPath(v.bundle)), bundleHash = scopeTools.sha(bundleBytes);
  const bundle = JSON.parse(bundleBytes); c.validateBundle(bundle, scope);
  require('../../src/config/env');
  const client = new MongoClient(require('../../src/config/env').mongodbUri, { serverSelectionTimeoutMS: 15000, retryWrites: false });
  try {
    await client.connect(); const db = client.db('focusflow'), collection = db.collection('video_segments_text');
    const output = localPath(v.output);
    if (v.mode === 'dry-run') {
      const plan = await prepare(db, collection, { scope, manifestHash: v['approve-manifest'], bundle, bundleHash,
        backupFile: `${output}.backup.json` });
      save(output, plan, true);
      console.log(JSON.stringify({ status: 'prepared', targets: 117, approvalHash: plan.approvalHash, writes: 0 }));
    } else {
      const plan = load(v.plan);
      if (['index-plan', 'index-update', 'index-restore'].includes(v.mode)) {
        if (planHash(plan) !== plan.approvalHash || plan.manifestHash !== v['approve-manifest'] || plan.bundleHash !== bundleHash)
          throw new Error('Index plan binding failed');
        await freshChecks(db, collection, plan);
        const journal = indexControl.createIndexJournal(path.resolve(__dirname, '../../../.local-tools/video1-build/index-journal'));
        if (v['execute-index'] && (!plan.indexUpdatePermission || v['approve-plan'] !== plan.approvalHash)) throw new Error('Explicit index permission and plan approval required');
        const result = await indexControl.transitionIndex(collection, plan.index, { execute: v['execute-index'],
          approveHash: v['approve-index'], direction: v.mode === 'index-restore' ? 'restore' : 'forward', ...journal });
        save(output, result, true); console.log(JSON.stringify({ status: v['execute-index'] ? 'index_operation_complete' : 'index_dry_run', executeIndex: v['execute-index'] }));
      } else {
        const receipt = async results => save(`${output}.receipt.json`, { planHash: plan.approvalHash, results });
        const intent = async event => {
          fs.mkdirSync(path.dirname(output), { recursive: true });
          fs.appendFileSync(localPath(`${output}.intent.jsonl`), JSON.stringify({ planHash: plan.approvalHash, ...event }) + '\n', { mode: 0o600, flush: true });
        };
        const result = await execute(db, collection, { plan, scope, bundle, bundleHash, manifestHash: v['approve-manifest'],
          freshBackupFile: `${output}.prewrite-backup.json`, approvePlan: v['approve-plan'], executeWrite: v['execute-write'], direction: v.mode === 'rollback' ? 'restore' : 'forward', receipt, intent });
        save(output, { results: result }, true);
        console.log(JSON.stringify({ status: 'complete', targets: result.length, executeWrite: v['execute-write'] }));
      }
    }
  } finally { await client.close(); }
}
if (require.main === module) main().catch(() => { console.error('V1 operation stopped; details redacted. Inspect receipts; never blindly retry.'); process.exitCode = 1; });
module.exports = { permissions, validateBackup, prepare, execute, planHash, freshChecks };
