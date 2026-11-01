'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { main } = require('../src/scripts/recutSingleTopic');
const { main: formalMain } = require('../src/scripts/recutFormalTrial');
const { runSingleTopicTrial } = require('../src/services/recutRuntimeTrial.service');
it('single-topic CLI never loads files or adapters before model permission', async () => {
  let calls = 0;
  const result = await main(['--input', 'missing.json', '--adapter', 'missing.cjs'], { createRuntime: async () => { calls++; } });
  assert.equal(result.dryRun, true); assert.equal(result.estimatedInputTokens, null); assert.equal(calls, 0);
});
it('single-topic CLI writes only requested local artifacts and closes fake runtime on success/failure', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-cli-test-'));
  let calls = 0, closed = 0;
  try {
    const input = path.join(directory, 'input.json'), output = path.join(directory, 'output');
    await fs.writeFile(input, JSON.stringify({ scriptId: 'script', courseId: 'course' }));
    const result = await main(['--input', input, '--adapter', 'fake.cjs', '--output', output, '--allow-model'], {
      createRuntime: async () => ({ model: { model: 'fake' }, pipeline: { generate: [{ id: 'step', stage: 'selection', run: async () => { calls++; return { version: { selection: { answerable: false }, fullScript: '', plan: null } }; } }] }, close: async () => { closed++; } }) });
    assert.equal(result.state, 'unanswerable'); assert.equal(calls, 1); assert.equal(closed, 1);
    assert.deepEqual((await fs.readdir(output)).sort(), ['full-script.txt', 'plan.json', 'run.json']);
    await assert.rejects(main(['--input', input, '--adapter', 'fake.cjs', '--output', output, '--allow-model'], {
      createRuntime: async () => ({ missing: ['provider'], close: async () => { closed++; } }) }), /RECUT_STEPS_NOT_CONFIGURED/);
    assert.equal(closed, 2);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
for (const index of [0, 1, 2, 3, 4, 5]) it(`single-topic stops at failed stage ${index + 1} and persists no result`, async () => {
  const order = []; let persisted = false;
  const generate = Array.from({ length: 6 }, (_, i) => ({ id: `step${i}`, stage: `stage${i}`, run: async () => {
    order.push(i); if (i === index) throw Object.assign(new Error('private'), { code: 'RECUT_SOURCE_INVALID' }); return {};
  } }));
  await assert.rejects(runSingleTopicTrial({ pipeline: { generate }, model: { model: 'fake' }, allowModel: true, persistLocal: () => { persisted = true; } }),
    (e) => e.trial.stage === `stage${index}`);
  assert.deepEqual(order, Array.from({ length: index + 1 }, (_, i) => i)); assert.equal(persisted, false);
});
it('formal CLI dry-run uses topics only and does not construct runtime/read URI/key', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-formal-cli-test-')); let built = false;
  try {
    const topics = path.join(directory, 'topics.json');
    await fs.writeFile(topics, JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ topicId: `t${i}`, scriptId: 's', courseId: 'c' }))));
    const result = await formalMain(['--topics', topics], { env: new Proxy({}, { get() { throw new Error('unexpected environment read'); } }), createRuntime: () => { built = true; } });
    assert.equal(result.dryRun, true); assert.equal(result.estimatedSharedCalls, 50); assert.equal(built, false);
    assert.deepEqual(await fs.readdir(directory), ['topics.json']);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
