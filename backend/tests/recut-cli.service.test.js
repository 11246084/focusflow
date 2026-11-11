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

const approvedPolicy = () => ({ modelId: 'gemini-3.8-flash', maxCalls: 5, maxRequestBytes: 100000,
  maxOutputTokens: 4096, budgetUsd: 0.5, inputPerMillion: 0.75, outputPerMillion: 3.75, validUntil: '2026-12-31' });
const approvedConfig = () => ({ geminiApiKeyEnv: 'GEMINI_API_KEY', model: { provider: 'gemini', model: 'gemini-3.8-flash' },
  callLimit: 5, maxOutputTokens: 4096, thinkingLevel: 'LOW', codeCards: { enabled: false }, trialPolicy: approvedPolicy() });
const approvedUri = 'mongodb://127.0.0.1:27029/recut_trial_professor-siri-20261103';
it('paid CLI refuses existing or concurrently claimed output before constructing another runtime', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-cli-claim-')); let providers = 0, reserved = 0, modelCalls = 0;
  try {
    const input = path.join(directory, 'input.json'), config = path.join(directory, 'runtime.json'), output = path.join(directory, 'out');
    await fs.writeFile(input, JSON.stringify({ scriptId: 's', courseId: 'c' })); await fs.writeFile(config, JSON.stringify(approvedConfig()));
    const argv = ['--input', input, '--runtime', config, '--output', output, '--target-uri-env', 'RECUT_LOCAL_URI', '--allow-model'];
    const env = { RECUT_LOCAL_URI: approvedUri, GEMINI_API_KEY: 'fake-key-not-for-argv-or-artifacts' };
    const createRuntime = async () => { providers++; return { model: approvedConfig().model, reserveTrialBudget: async () => { reserved++; },
      pipeline: { generate: [{ id: 'fixture', stage: 'selection', run: async () => { modelCalls++; return {
        version: { selection: { answerable: false }, fullScript: '', plan: null } }; } }] } }; };
    const results = await Promise.allSettled([main(argv, { env, createRuntime }), main(argv, { env, createRuntime })]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.match(results.find((r) => r.status === 'rejected').reason.message, /RECUT_TRIAL_OUTPUT_EXISTS/);
    assert.equal(providers, 1); assert.equal(reserved, 1); assert.equal(modelCalls, 1);
    const before = await fs.readFile(path.join(output, 'run.json'), 'utf8');
    await assert.rejects(main(argv, { env, createRuntime }), /RECUT_TRIAL_OUTPUT_EXISTS/);
    assert.equal(await fs.readFile(path.join(output, 'run.json'), 'utf8'), before);
    assert.ok(!JSON.stringify({ argv, results, before }).includes(env.GEMINI_API_KEY));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
it('approved paid policy rejects changed URI/model/limits/fallback before provider or output claim', async () => {
  const { assertCliTrialPolicy } = require('../src/services/recutCliRuntime.service');
  for (const config of [{ ...approvedConfig(), model: { provider: 'gemini', model: 'other' } },
    { ...approvedConfig(), callLimit: 6 }, { ...approvedConfig(), codeCards: { enabled: true } },
    { ...approvedConfig(), maxOutputTokens: 8192 }, { ...approvedConfig(), thinkingLevel: 'MINIMAL' },
    { ...approvedConfig(), fallbackModel: 'other' }, { ...approvedConfig(), trialPolicy: { ...approvedPolicy(), budgetUsd: 1 } }]) {
    assert.throws(() => assertCliTrialPolicy({ config, targetUri: approvedUri }), { code: 'RECUT_TRIAL_POLICY_INVALID' });
  }
  for (const targetUri of ['mongodb://localhost:27029/recut_trial_professor-siri-20261103',
    'mongodb://127.0.0.1:27017/recut_trial_professor-siri-20261103', 'mongodb://127.0.0.1:27029/production',
    approvedUri + '?authSource=admin']) assert.throws(() => assertCliTrialPolicy({ config: approvedConfig(), targetUri }), { code: 'RECUT_LOCAL_DB_INVALID' });
  assert.throws(() => assertCliTrialPolicy({ config: approvedConfig(), targetUri: approvedUri, now: new Date('2027-01-01') }), { code: 'RECUT_TRIAL_POLICY_EXPIRED' });
  let connections = 0;
  await assert.rejects(require('../src/services/recutCliRuntime.service').createCliRuntime({ config: approvedConfig(), input: {},
    targetUri: approvedUri, allowModel: true, env: {}, driverLoader: () => { connections++; } }), { code: 'RECUT_PROVIDER_NOT_CONFIGURED' });
  assert.equal(connections, 0);
});
it('paid policy call cap is shared and the sixth reservation fails before a request', () => {
  const guard = require('../src/services/recutTrialGuard.service').createRecutTrialGuard(approvedPolicy());
  const request = { modelId: 'gemini-3.8-flash', input: {}, images: [], body: '{}', maxOutputTokens: 4096 };
  for (let n = 1; n <= 5; n++) assert.equal(guard.reserve(request).trialModelCalls, n);
  assert.throws(() => guard.reserve(request), { code: 'RECUT_TRIAL_CALL_LIMIT' });
});

it('local media child receives only public tool paths and never the terminal provider key or URI', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-cli-tools-')), calls = [];
  try {
    const file = path.join(directory, 'source.mp4'); await fs.writeFile(file, 'fake source');
    const config = { ...approvedConfig(), media: { allowedRoot: directory, ffmpeg: 'fake-ffmpeg', ffprobe: 'fake-probe',
      python: 'fake-python', transcriber: 'fake-transcriber', asrModel: 'fake-offline-model' } };
    const runtime = await require('../src/services/recutCliRuntime.service').createCliRuntime({ config, input: {}, output: path.join(directory, 'output'),
      targetUri: approvedUri, allowModel: true, env: { GEMINI_API_KEY: 'fake-provider-private', RECUT_LOCAL_URI: approvedUri,
        OTHER_SECRET: 'fake-unrelated-private', PATH: 'public-tool-path' }, run: async (binary, args, options) => {
        calls.push({ binary, args, env: options.env });
        return binary === 'fake-probe' ? { stdout: JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: 300 } }) }
          : { stderr: '{"input_i":"-20","input_tp":"-8"}' };
      } });
    try { await runtime.pipeline.generate.find((step) => step.id === 'recut-source-check-v1').run({
      data: { sourcePath: file, sourceWindow: { startSec: 0, endSec: 150 } }, checkCancelled: async () => {} }); }
    finally { await runtime.close?.(); }
    assert.equal(calls.length, 3);
    for (const call of calls) assert.deepEqual(call.env, { PATH: 'public-tool-path' });
    assert.doesNotMatch(JSON.stringify(calls), /fake-provider-private|fake-unrelated-private|RECUT_LOCAL_URI/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

for (const missingPolicy of [undefined, null]) it(`professor namespace cannot bypass locks by removing policy (${missingPolicy})`, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-professor-required-')); let built = 0;
  try {
    const config = { ...approvedConfig(), trialPolicy: missingPolicy };
    const input = path.join(directory, 'input.json'), runtime = path.join(directory, 'runtime.json'), output = path.join(directory, 'output');
    await fs.writeFile(input, JSON.stringify({ scriptId: 's', courseId: 'c' })); await fs.writeFile(runtime, JSON.stringify(config));
    await assert.rejects(main(['--input', input, '--runtime', runtime, '--output', output, '--target-uri-env', 'RECUT_LOCAL_URI', '--allow-model'],
      { env: { RECUT_LOCAL_URI: approvedUri }, createRuntime: async () => { built++; } }), { code: 'RECUT_TRIAL_POLICY_INVALID' });
    assert.equal(built, 0); await assert.rejects(fs.stat(output), { code: 'ENOENT' });
    await assert.rejects(require('../src/services/recutCliRuntime.service').createCliRuntime({ config, input: {},
      targetUri: approvedUri, allowModel: true, env: new Proxy({}, { get() { throw new Error('must validate before key read'); } }),
      driverLoader: () => { built++; } }), { code: 'RECUT_TRIAL_POLICY_INVALID' });
    assert.equal(built, 0);
    assert.doesNotThrow(() => require('../src/services/recutCliRuntime.service').assertCliTrialPolicy({ config,
      targetUri: 'mongodb://127.0.0.1:27131/recut_trial_generic' }));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

for (const policy of [undefined, null, approvedPolicy()]) it(`formal CLI cannot use professor single-topic authorization (${policy ? 'complete policy' : policy})`, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-formal-professor-denied-')); let built = 0;
  try {
    const topics = path.join(directory, 'topics.json'), runtime = path.join(directory, 'runtime.json'), output = path.join(directory, 'output');
    await fs.writeFile(topics, JSON.stringify(Array.from({ length: 10 }, (_, n) => ({ topicId: `topic-${n}`, scriptId: 's', courseId: 'c' }))));
    await fs.writeFile(runtime, JSON.stringify({ ...approvedConfig(), trialPolicy: policy }));
    await assert.rejects(formalMain(['--topics', topics, '--runtime', runtime, '--output', output, '--target-uri-env', 'RECUT_LOCAL_URI', '--allow-model'],
      { env: new Proxy({ RECUT_LOCAL_URI: approvedUri }, { get(target, key) { if (key !== 'RECUT_LOCAL_URI') throw new Error('unexpected key read'); return target[key]; } }),
        createRuntime: async () => { built++; throw new Error('unexpected provider or DB'); } }), { code: 'RECUT_PROFESSOR_SINGLE_TOPIC_ONLY' });
    assert.equal(built, 0); await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
