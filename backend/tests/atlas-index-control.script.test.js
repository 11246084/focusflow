const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../scripts/atlas-multimodal/control');
const { transitionIndex, approvalHash, createIndexJournal } = require('../scripts/atlas-multimodal/index-control');
const definition = { fields: [
  { type: 'vector', path: 'embedding', numDimensions: 3072, similarity: 'cosine' },
  { type: 'filter', path: 'courseId' }, { type: 'filter', path: 'videoId' }
] };
function snapshot(def = definition) {
  return { id: 'index-id', name: 'text_embedding_index', type: 'vectorSearch', status: 'READY', queryable: true,
    latestDefinitionVersion: { version: 1 }, latestDefinition: structuredClone(def),
    statusDetail: [1, 2, 3].map(i => ({ hostname: `node${i}`, status: 'READY', queryable: true,
      mainIndex: { status: 'READY', queryable: true, definition: { ...structuredClone(def), numPartitions: 1 } } })) };
}
const plan = c.indexPlan(snapshot());
const approveHash = approvalHash(plan);
function fake(initial = snapshot()) {
  const state = { index: structuredClone(initial), calls: [], reads: 0, receipts: [] };
  const collection = { dbName: 'focusflow', collectionName: 'video_segments_text',
    listSearchIndexes: (name, options) => {
      assert.equal(name, 'text_embedding_index'); assert.equal(options.maxTimeMS, 15000);
      return { toArray: async () => { state.reads++; return [structuredClone(state.index)]; } };
    },
    updateSearchIndex: async (name, def) => {
      state.calls.push({ name, definition: structuredClone(def) }); state.index = snapshot(def);
    } };
  return { state, collection, options: { execute: true, approveHash, attempts: 2,
    sleep: async () => {}, receipt: async r => state.receipts.push(structuredClone(r)),
    readReceipt: async ({ operationHash, direction }) => state.receipts.filter(r => r.operationHash === operationHash && r.direction === direction).at(-1) } };
}
test('default dry run checks before/after JSON and cannot update either direction', async () => {
  const f = fake();
  assert.deepEqual((await transitionIndex(f.collection, plan)).definition, plan.after);
  f.state.index = snapshot(plan.after);
  assert.deepEqual((await transitionIndex(f.collection, plan, { direction: 'restore' })).definition, plan.before);
  assert.equal(f.state.calls.length, 0);
});
test('real installed Driver method builds exact forward/restore commands using a fake operation executor', async t => {
  // Exercise Collection.updateSearchIndex and the installed Driver command builder without a socket.
  const executor = require('mongodb/lib/operations/execute_operation');
  const original = executor.executeOperation;
  t.after(() => { executor.executeOperation = original; });
  const f = fake();
  const client = new MongoClient('mongodb://127.0.0.1:1', { retryReads: false, retryWrites: false });
  t.after(() => client.close());
  const collection = client.db('focusflow').collection('video_segments_text');
  collection.listSearchIndexes = f.collection.listSearchIndexes;
  const commands = [];
  executor.executeOperation = async (receivedClient, operation) => {
    assert.equal(receivedClient, client);
    const command = operation.buildCommand(); commands.push(structuredClone(command));
    f.state.index = snapshot(command.definition);
  };
  assert.equal((await transitionIndex(collection, plan, f.options)).status, 'verified');
  assert.equal((await transitionIndex(collection, plan, { ...f.options, direction: 'restore' })).status, 'verified');
  assert.deepEqual(commands, [plan.after, plan.before].map(def => ({
    updateSearchIndex: 'video_segments_text', name: 'text_embedding_index', definition: def })));
  assert.deepEqual(f.state.receipts.map(r => r.status), ['prepared', 'submission_started', 'submitted', 'verified',
    'prepared', 'submission_started', 'submitted', 'verified']);
  assert.equal(client.topology, undefined); // No connect/session/server execution occurred.
});
test('each direction is idempotent once every node has reached target', async () => {
  const f = fake();
  await transitionIndex(f.collection, plan, f.options);
  assert.equal((await transitionIndex(f.collection, plan, f.options)).status, 'already_at_target');
  await transitionIndex(f.collection, plan, { ...f.options, direction: 'restore' });
  assert.equal((await transitionIndex(f.collection, plan, { ...f.options, direction: 'restore' })).status, 'already_at_target');
  assert.equal(f.state.calls.length, 2);
});
test('reject wrong scope, approval, direction, plan, or polling bound without updates', async () => {
  for (const mutate of [f => { f.collection.dbName = 'other'; }, f => { f.collection.collectionName = 'other'; },
    f => { f.options.approveHash = 'old'; }, f => { f.options.direction = 'invalid'; },
    f => { f.options.attempts = 0; }, f => { f.options.attempts = 62; }]) {
    const f = fake(); mutate(f); await assert.rejects(transitionIndex(f.collection, plan, f.options)); assert.equal(f.state.calls.length, 0);
  }
  const f = fake(); const bad = structuredClone(plan); bad.after.fields[0].numDimensions = 10;
  await assert.rejects(transitionIndex(f.collection, bad, f.options), /plan/); assert.equal(f.state.reads, 0);
});
test('invalid index identity, missing/duplicate nodes and definition conflicts stop before submission', async () => {
  for (const mutate of [i => { i.name = 'other'; }, i => { i.type = 'search'; },
    i => { delete i.id; }, i => { delete i.latestDefinitionVersion; },
    i => { i.statusDetail.pop(); }, i => { i.statusDetail[1].hostname = 'node1'; },
    i => { i.latestDefinition.fields.push({ type: 'filter', path: 'other' }); },
    i => { i.statusDetail[0].mainIndex.definition.numPartitions = 2; },
    i => { i.statusDetail[0].mainIndex.definition.fields[0].numDimensions = 1; }]) {
    const f = fake(); mutate(f.state.index);
    await assert.rejects(transitionIndex(f.collection, plan, f.options)); assert.equal(f.state.calls.length, 0);
  }
});
test('before-image recheck catches another index version/id change after durable prepared receipt', async () => {
  for (const mutate of [i => { i.latestDefinitionVersion.version++; }, i => { i.id = 'replacement'; },
    i => { i.status = 'BUILDING'; }]) {
    const f = fake(); f.options.receipt = async r => { if (r.status === 'prepared') mutate(f.state.index); };
    await assert.rejects(transitionIndex(f.collection, plan, f.options), /preimage/); assert.equal(f.state.calls.length, 0);
  }
});
test('no source readiness permits neither a forward update nor an immediate inverse update', async () => {
  for (const direction of ['forward', 'restore']) {
    const f = fake(snapshot(direction === 'forward' ? plan.before : plan.after));
    f.state.index.status = 'BUILDING';
    await assert.rejects(transitionIndex(f.collection, plan, { ...f.options, direction }), /not fully ready/);
    assert.equal(f.state.calls.length, 0);
  }
});
test('poll waits for all three nodes, not just top-level readiness', async () => {
  const f = fake(); const pauses = [];
  f.collection.updateSearchIndex = async (name, def) => {
    f.state.calls.push({ name, definition: def }); f.state.index = snapshot(def);
    f.state.index.statusDetail[2].mainIndex = snapshot().statusDetail[2].mainIndex;
  };
  f.options.sleep = async ms => { pauses.push(ms); f.state.index = snapshot(plan.after); };
  await transitionIndex(f.collection, plan, f.options);
  assert.deepEqual(pauses, [30000]); assert.equal(f.state.calls.length, 1);
});
test('timeout leaves a single submitted update and never automatically retries or restores', async () => {
  const f = fake(); const pauses = [];
  f.collection.updateSearchIndex = async (...args) => { f.state.calls.push(args); f.state.index.status = 'BUILDING'; };
  f.options.sleep = async ms => pauses.push(ms);
  await assert.rejects(transitionIndex(f.collection, plan, f.options), /timeout/);
  assert.equal(f.state.calls.length, 1); assert.deepEqual(pauses, [30000]);
  assert.equal(f.state.receipts.at(-1).status, 'submitted');
});
test('node failure or concurrent foreign definition during polling stops without inverse updates', async () => {
  for (const mutate of [i => { i.status = 'FAILED'; }, i => { i.statusDetail[1].mainIndex.status = 'FAILED'; },
    i => { i.latestDefinition.fields.push({ type: 'filter', path: 'foreign' }); }]) {
    const f = fake();
    f.collection.updateSearchIndex = async (...args) => { f.state.calls.push(args); f.state.index = snapshot(plan.after); mutate(f.state.index); };
    await assert.rejects(transitionIndex(f.collection, plan, f.options), /failed|conflict/); assert.equal(f.state.calls.length, 1);
  }
});
test('permission, quota, and ambiguous network errors propagate once, preserving submission evidence', async () => {
  for (const message of ['Unauthorized', 'Quota exceeded', 'Network timeout, outcome unknown']) {
    const f = fake(); f.collection.updateSearchIndex = async (...args) => { f.state.calls.push(args); throw new Error(message); };
    await assert.rejects(transitionIndex(f.collection, plan, f.options), new RegExp(message.split(',')[0]));
    assert.equal(f.state.calls.length, 1); assert.equal(f.state.receipts.at(-1).status, 'submission_started');
  }
});
test('receipt failure before submission writes nothing; failure after submission does not resend', async () => {
  for (const failure of ['prepared', 'submission_started', 'submitted', 'verified']) {
    const f = fake(); f.options.receipt = async r => { if (r.status === failure) throw new Error('Receipt disk full'); };
    await assert.rejects(transitionIndex(f.collection, plan, f.options), /disk full/);
    assert.equal(f.state.calls.length, ['prepared', 'submission_started'].includes(failure) ? 0 : 1);
  }
});
test('read failures and missing/multiple named indexes cannot initiate any update', async () => {
  for (const response of [[], [snapshot(), snapshot()], new Error('read denied')]) {
    const f = fake(); f.collection.listSearchIndexes = () => ({ toArray: async () => {
      if (response instanceof Error) throw response; return response;
    } });
    await assert.rejects(transitionIndex(f.collection, plan, f.options)); assert.equal(f.state.calls.length, 0);
  }
});
test('persistent ambiguous submission blocks another invocation even if the server still reports old READY definition', async () => {
  const f = fake(); f.collection.updateSearchIndex = async (...args) => { f.state.calls.push(args); throw new Error('network outcome unknown'); };
  await assert.rejects(transitionIndex(f.collection, plan, f.options), /network/);
  await assert.rejects(transitionIndex(f.collection, plan, f.options), /no resubmission/);
  assert.equal(f.state.calls.length, 1);
  f.state.index = snapshot(plan.after); // Read-only inspection later proves completion.
  assert.equal((await transitionIndex(f.collection, plan, f.options)).status, 'already_at_target');
  assert.equal(f.state.calls.length, 1);
});
test('missing, unreadable, or mismatched durable journals block updates', async () => {
  for (const reader of [undefined, async () => { throw new Error('journal unavailable'); },
    async () => ({ operationHash: 'other', direction: 'forward', status: 'prepared' })]) {
    const f = fake();
    await assert.rejects(transitionIndex(f.collection, plan, { ...f.options, readReceipt: reader }));
    assert.equal(f.state.calls.length, 0);
  }
});
test('restore timeout and restore permission failure cannot trigger repeated or reverse updates', async () => {
  for (const fail of [false, true]) {
    const f = fake(snapshot(plan.after));
    f.collection.updateSearchIndex = async (...args) => {
      f.state.calls.push(args);
      if (fail) throw new Error('restore unauthorized');
      f.state.index.status = 'BUILDING';
    };
    await assert.rejects(transitionIndex(f.collection, plan, { ...f.options, direction: 'restore' }), /timeout|unauthorized/);
    await assert.rejects(transitionIndex(f.collection, plan, { ...f.options, direction: 'restore' }));
    assert.equal(f.state.calls.length, 1);
  }
});
test('durable checksummed journal retains before snapshot and blocks a fresh process after ambiguous submission', async () => {
  const root = path.resolve(__dirname, '../../.local-tools/atlas-preparation');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'mock-journal-'));
  const f = fake();
  f.collection.updateSearchIndex = async (...args) => { f.state.calls.push(args); throw new Error('unknown outcome'); };
  await assert.rejects(transitionIndex(f.collection, plan, { ...f.options, ...createIndexJournal(directory) }), /unknown/);
  const reopened = createIndexJournal(directory);
  const prior = await reopened.readReceipt({ operationHash: approveHash, direction: 'forward' });
  assert.equal(prior.status, 'submission_started'); assert.deepEqual(prior.snapshot, snapshot());
  await assert.rejects(transitionIndex(f.collection, plan, { ...f.options, ...reopened }), /no resubmission/);
  assert.equal(f.state.calls.length, 1);
  const file = path.join(directory, fs.readdirSync(directory)[0]);
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(journal.events.length, 2);
  journal.checksum = 'tampered'; fs.writeFileSync(file, JSON.stringify(journal));
  await assert.rejects(transitionIndex(f.collection, plan, { ...f.options, ...reopened }), /checksum/);
  assert.equal(f.state.calls.length, 1);
  await assert.rejects(createIndexJournal('backend').readReceipt({ operationHash: approveHash, direction: 'forward' }), /Private output/);
});
