// Independent Driver operation. No env/client, CLI, scheduling or automatic recovery.
const { hash, indexPlan, waitReady } = require('./control');
const fs = require('node:fs');
const path = require('node:path');
const { BSON } = require('mongodb');
const { localPath } = require('./run');
const NAME = 'text_embedding_index';
function createIndexJournal(directory) {
  const fileFor = ({ operationHash, direction }) => {
    if (!/^[a-f0-9]{64}$/.test(operationHash) || !['forward', 'restore'].includes(direction)) throw new Error('Invalid journal identity');
    return localPath(path.join(directory, `${operationHash}-${direction}.json`));
  };
  const load = identity => {
    const file = fileFor(identity);
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const journal = BSON.EJSON.parse(raw, { relaxed: false });
    if (journal.schemaVersion !== 'atlas_index_receipt_v1' || !Array.isArray(journal.events) || !journal.events.length
      || hash(journal.events) !== journal.checksum
      || journal.events.some(e => e.operationHash !== identity.operationHash || e.direction !== identity.direction)) throw new Error('Index journal checksum/identity failed');
    return BSON.EJSON.deserialize(BSON.EJSON.serialize(journal.events), { relaxed: true });
  };
  return {
    readReceipt: async identity => load(identity).at(-1),
    receipt: async event => {
      const file = fileFor(event);
      const events = [...load(event), { ...event, recordedAt: new Date().toISOString() }];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // A corrupt/interrupted journal fails closed on the next read. Never discard it to retry.
      fs.writeFileSync(file, BSON.EJSON.stringify({ schemaVersion: 'atlas_index_receipt_v1', events, checksum: hash(events) },
        { relaxed: false }), { mode: 0o600, flush: true });
      load(event);
    }
  };
}
function sameDefinition(actual, expected) {
  if (!actual) return false;
  const copy = structuredClone(actual);
  // Atlas node snapshots materialize the documented default. Preserve raw evidence elsewhere.
  if (!Object.hasOwn(expected, 'numPartitions') && copy.numPartitions === 1) delete copy.numPartitions;
  return hash(copy) === hash(expected);
}
function assertSnapshot(index) {
  if (index?.name !== NAME || index.type !== 'vectorSearch' || !index.latestDefinition
    || index.id == null || index.latestDefinitionVersion?.version == null) throw new Error('Index identity/version conflict; stop');
  if (index.status === 'FAILED' || index.statusDetail?.some(n => n.status === 'FAILED'
    || n.mainIndex?.status === 'FAILED' || n.stagedIndex?.status === 'FAILED')) throw new Error('Index/node failed; stop and inspect platform state');
  if (index.statusDetail?.length !== 3 || new Set(index.statusDetail.map(n => n.hostname)).size !== 3
    || index.statusDetail.some(n => !n.hostname)) throw new Error('Expected three distinct index nodes; stop');
}
function nodesReady(index, definition) {
  return index.statusDetail.every(n => n.status === 'READY' && n.queryable === true
    && n.mainIndex?.status === 'READY' && n.mainIndex.queryable === true && !n.stagedIndex
    && sameDefinition(n.mainIndex.definition, definition));
}
function ready(index, definition) {
  return index.status === 'READY' && index.queryable === true
    && hash(index.latestDefinition) === hash(definition) && nodesReady(index, definition);
}
function validatePlan(plan) {
  const rebuilt = indexPlan({ name: NAME, type: 'vectorSearch', latestDefinition: plan.before }, 'B');
  if (plan.strategy !== 'B' || hash(plan.before) !== plan.beforeHash || hash(plan.after) !== plan.afterHash
    || hash(rebuilt.after) !== plan.afterHash || rebuilt.added.length !== 3
    || Buffer.byteLength(JSON.stringify(plan.after), 'utf8') > 3072) throw new Error('Invalid B index plan; stop');
}
function approvalHash(plan) {
  validatePlan(plan);
  return hash({ database: 'focusflow', collection: 'video_segments_text', name: NAME,
    beforeHash: plan.beforeHash, afterHash: plan.afterHash });
}
async function transitionIndex(collection, plan, { direction = 'forward', execute = false, approveHash,
  receipt = async () => { throw new Error('Durable receipt required'); }, readReceipt, attempts = 61, sleep } = {}) {
  validatePlan(plan);
  if (!['forward', 'restore'].includes(direction)) throw new Error('Invalid index direction');
  if (collection.dbName !== 'focusflow' || collection.collectionName !== 'video_segments_text') throw new Error('Index namespace conflict; stop');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 61) throw new Error('Invalid polling attempts');
  const operationHash = approvalHash(plan);
  if (execute && approveHash !== operationHash) throw new Error('Reviewed index operation hash required');
  const source = direction === 'forward' ? plan.before : plan.after;
  const target = direction === 'forward' ? plan.after : plan.before;
  const read = async () => {
    const indexes = await collection.listSearchIndexes(NAME, { maxTimeMS: 15000 }).toArray();
    if (indexes.length !== 1) throw new Error('Expected exactly one named index; stop');
    const index = indexes[0];
    assertSnapshot(index);
    if (![hash(source), hash(target)].includes(hash(index.latestDefinition))) throw new Error('Index definition conflict; stop');
    if (index.statusDetail.some(n => [n.mainIndex, n.stagedIndex].filter(Boolean)
      .some(part => !sameDefinition(part.definition, source) && !sameDefinition(part.definition, target)))) {
      throw new Error('Node definition conflict; stop');
    }
    return index;
  };
  const before = await read();
  const base = { direction, operationHash, sourceHash: hash(source), targetHash: hash(target) };
  let prior;
  if (execute) {
    if (typeof readReceipt !== 'function') throw new Error('Durable receipt reader required');
    prior = await readReceipt({ operationHash, direction });
    if (prior && (prior.operationHash !== operationHash || prior.direction !== direction
      || !['prepared', 'submission_started', 'submitted', 'verified', 'already_at_target'].includes(prior.status))) {
      throw new Error('Index receipt conflict; stop');
    }
  }
  if (ready(before, target)) {
    const result = { ...base, status: 'already_at_target', snapshot: before };
    if (execute) await receipt(result);
    return result;
  }
  // A building/ambiguous index is never a license to send a second update, including restore.
  if (!ready(before, source)) throw new Error('Index source not fully ready; inspect platform before any update');
  if (!execute) return { ...base, status: 'dry_run', definition: structuredClone(target), snapshot: before };
  if (prior && prior.status !== 'prepared') throw new Error('Prior submission/completion requires inspection; no resubmission');
  await receipt({ ...base, status: 'prepared', snapshot: before });
  // Recheck after durable evidence is saved; index updates have no server-side CAS.
  const rechecked = await read();
  if (!ready(rechecked, source) || (before.id != null && hash(before.id) !== hash(rechecked.id))
    || hash(before.latestDefinitionVersion) !== hash(rechecked.latestDefinitionVersion)) throw new Error('Index preimage changed; stop');
  await receipt({ ...base, status: 'submission_started', snapshot: rechecked });
  // Exactly one call: even an ambiguous network error requires manual inspection, never retry.
  await collection.updateSearchIndex(NAME, structuredClone(target));
  await receipt({ ...base, status: 'submitted' });
  const after = await waitReady(read, target, { attempts, sleep, isReady: i => nodesReady(i, target) });
  const result = { ...base, status: 'verified', snapshot: after };
  await receipt(result);
  return result;
}
module.exports = { sameDefinition, nodesReady, approvalHash, transitionIndex, createIndexJournal };
