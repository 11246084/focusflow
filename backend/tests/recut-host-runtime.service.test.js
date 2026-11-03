'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
// The fake application harness must never load the checkout's real .env.
const dotenv = require('dotenv');
const originalDotenv = dotenv.config;
dotenv.config = () => ({ parsed: {} });
const harness = require('./helpers/backendTestHarness');
dotenv.config = originalDotenv;
const { createRecutHostRuntime } = require('../src/services/recutHostRuntime.service');
const { createRecutApplication, configureRecutApplication } = require('../src/services/recutApplication.service');
const { createRecutQueue } = require('../src/services/recutQueue.service');
const { fixture, fakeRenderer } = require('./helpers/recutPipelineFixtures');
const { seedScript, snapshot } = require('./helpers/recutFixtures');
const base = path.resolve('fake-recut-host');
const file = (name) => path.join(base, name);
function setup(change = {}) {
  const config = { schemaVersion: 1, modelCallsEnabled: true, geminiApiKeyEnv: 'TEST_HOST_KEY', allowedGeminiModels: ['gemini-3-fake'],
    maxOutputTokens: 4096, thinkingLevel: 'LOW', codeCardsEnabled: false, workspaceRoot: file('work'),
    media: { allowedRoot: file('sources'), ffmpeg: file('ffmpeg'), ffprobe: file('ffprobe'), python: file('python'), transcriber: file('transcriber.py'), asrModel: file('model') }, ...change };
  const directories = new Set([file('work'), file('sources'), file('model')]);
  const reads = [], runs = [], keyReads = [], factoryCalls = [];
  const fs = { stat: async (value) => ({ isFile: () => !directories.has(value), isDirectory: () => directories.has(value), size: 20 }),
    realpath: async (value) => value, readFile: async (value) => { reads.push(value); return JSON.stringify(config); },
    mkdtemp: async () => file('work/recut-fake'), rm: async () => {} };
  const options = { enabled: true, runtimeConfigPath: file('runtime.json'), fs,
    env: new Proxy({ TEST_HOST_KEY: 'fake-key', GEMINI_API_KEY: 'private-provider', MONGODB_URI: 'private-db', PATH: 'fake-path' },
      { get(target, key) { keyReads.push(key); return target[key]; } }),
    getSetting: (key) => key === 'recut.geminiModel' ? { provider: 'gemini', model: 'gemini-3-fake' } : 3,
    run: async (...args) => { runs.push(args); return { stdout: '{}', stderr: '' }; },
    providerFactory: () => { factoryCalls.push('provider'); return async () => ({ output: {} }); },
    rendererLoader: () => { factoryCalls.push('renderer'); return fakeRenderer(); } };
  return { config, options, reads, runs, keyReads, factoryCalls };
}
describe('recut host 一次性設定與自主 pipeline', () => {
  beforeEach(harness.resetStore);
  it('關閉時不讀 config、金鑰、settings 或建立 adapter', async () => {
    const f = setup();
    const runtime = await createRecutHostRuntime({ ...f.options, enabled: false, settingsLoader: () => { throw Error('forbidden'); } });
    assert.equal(runtime.hostStatus, 'disabled');
    assert.deepEqual([f.reads, f.runs, f.keyReads, f.factoryCalls], [[], [], [], []]);
  });
  it('缺 config、未授權模型及缺金鑰都 fail closed，僅傳固定缺項', async () => {
    const f = setup();
    assert.deepEqual((await createRecutHostRuntime({ ...f.options, runtimeConfigPath: '' })).missing, ['host.runtimeConfigMissing']);
    assert.deepEqual(f.keyReads, []);
    assert.equal((await createRecutHostRuntime({ ...f.options, getSetting: () => ({ provider: 'gemini', model: 'not-approved' }) })).hostStatus, 'modelNotAllowed');
    assert.deepEqual(f.keyReads, []);
    const runtimeAdapters = await createRecutHostRuntime({ ...f.options, env: {} });
    assert.equal(runtimeAdapters.hostStatus, 'providerKeyMissing');
    const app = createRecutApplication({ queue: createRecutQueue(), runtimeAdapters });
    assert.throws(app.assertConfigured, (error) => error.statusCode === 503 && error.code === 'RECUT_STEPS_NOT_CONFIGURED'
      && error.details.missing.includes('host.providerKeyMissing'));
    await app.dispose();
  });
  it('教授單次試產namespace在讀config或key前阻擋，別名及query不能繞過原預算', async () => {
    const f = setup();
    for (const databaseUri of [
      'mongodb://127.0.0.1:27029/recut_trial_professor-siri-20261104',
      'mongodb://localhost:27029/recut_trial_professor-siri-20261104?authSource=admin',
      'mongodb+srv://fake.invalid/recut_trial_professor-siri-20261104',
      'mongodb://host-a:27017,host-b:27017/recut_trial_%70rofessor-siri-20261104',
      'mongodb://localhost/production?dbName=recut_trial_professor-siri-20261104',
    ]) {
      const result = await createRecutHostRuntime({ ...f.options, databaseUri });
      assert.deepEqual(result.missing, ['host.professorTrialNamespace']);
    }
    assert.equal((await createRecutHostRuntime({ ...f.options, databaseName: 'recut_trial_professor-siri-20261104' })).hostStatus, 'professorTrialNamespace');
    assert.deepEqual([f.reads, f.keyReads, f.runs, f.factoryCalls], [[], [], [], []]);
    assert.equal((await createRecutHostRuntime({ ...f.options, databaseUri: 'mongodb://localhost/focusflow' })).hostStatus, 'configured');
  });
  it('拒絕 secret 檔名、內嵌金鑰、相對工具路徑與不完整JSON', async () => {
    const f = setup();
    assert.equal((await createRecutHostRuntime({ ...f.options, runtimeConfigPath: file('.env') })).hostStatus, 'runtimeConfigInvalid');
    assert.deepEqual(f.reads, []);
    f.config.apiKey = 'never-accepted';
    assert.equal((await createRecutHostRuntime(f.options)).hostStatus, 'runtimeConfigInvalid');
    delete f.config.apiKey; f.config.media.ffmpeg = 'ffmpeg';
    assert.equal((await createRecutHostRuntime(f.options)).hostStatus, 'pathsInvalid');
    assert.deepEqual(f.keyReads, []);
    assert.equal((await createRecutHostRuntime({ ...f.options, fs: { ...f.options.fs, readFile: async () => '{' } })).hostStatus, 'runtimeConfigInvalid');
    assert.deepEqual(f.factoryCalls, []);
  });
  it('完整組裝保持惰性，source 實檔與symlink越界拒絕，子程序只繼承白名單', async () => {
    const f = setup(); let mediaOptions;
    const runtime = await createRecutHostRuntime({ ...f.options, mediaFactory: (options) => {
      mediaOptions = options; return Object.fromEntries(['probe', 'decode', 'measure', 'transcribe'].map((key) => [key, async () => {}]));
    } });
    assert.deepEqual(runtime.missing, []); assert.equal(runtime.hostStatus, 'configured'); assert.deepEqual(f.runs, []);
    assert.deepEqual(f.keyReads, ['TEST_HOST_KEY']);
    assert.equal(await mediaOptions.resolveSource(file('sources/movie.mp4')), file('sources/movie.mp4'));
    await assert.rejects(mediaOptions.resolveSource(file('sources')), { code: 'RECUT_SOURCE_UNAVAILABLE' });
    f.options.fs.realpath = async (value) => value.endsWith('escape.mp4') ? file('outside.mp4') : value;
    await assert.rejects(mediaOptions.resolveSource(file('sources/escape.mp4')), { code: 'RECUT_SOURCE_UNAVAILABLE' });
    await mediaOptions.run(file('python'), [], { env: { GEMINI_API_KEY: 'override-secret', HF_HUB_OFFLINE: '1' } });
    const childEnv = f.runs[0][2].env;
    assert.equal(childEnv.PATH, 'fake-path'); assert.equal(childEnv.HF_HUB_OFFLINE, '1');
    assert.equal(childEnv.GEMINI_API_KEY, undefined); assert.equal(childEnv.MONGODB_URI, undefined);
    assert.equal(f.keyReads.includes('GEMINI_API_KEY'), false); assert.equal(f.keyReads.includes('MONGODB_URI'), false);
    await assert.rejects(runtime.decide({ model: { provider: 'gemini', model: 'not-approved' } }), { code: 'RECUT_MODEL_NOT_ALLOWED' });
  });
  it('真loopback教師202後由host組裝pipeline自主drain並收到講稿完成通知', async () => {
    const f = setup(), content = fixture(), script = seedScript(); let calls = 0;
    const { lockedSentenceIds: _locked, ...selection } = content.selection;
    const segments = Array.from({ length: 10 }, (_, i) => ({ videoId: harness.ids.teacherVideo, chunkId: `chunk${i}`, startSec: i * 15, endSec: (i + 1) * 15, text: '來源快照' }));
    const runtimeAdapters = await createRecutHostRuntime({ ...f.options,
      providerFactory: () => async ({ input }) => { calls++; return { output: input.question ? selection : input.catalog ? content.cards : { issues: [] } }; },
      mediaFactory: () => ({ probe: async () => ({ streams: [{ codec_type: 'audio' }], format: { duration: '150' } }), decode: async () => {},
        measure: async () => ({ integratedLufs: -18, truePeakDbtp: -4 }),
        transcribe: async () => content.source.sentences.flatMap((sentence) => sentence.words.map((word) => ({ w: word.text, s: word.startSec, e: word.endSec }))) }),
      runtimeFactory: (options) => require('../src/services/recutRuntimeAdapters.service').createRecutRuntimeAdapters({ ...options,
        sourceOptions: { loadInputs: async () => ({ video: { _id: harness.ids.teacherVideo, filePath: file('sources/movie.mp4') }, hits: [segments[0]], segments }) } }),
    });
    const env = require('../src/config/env'), prior = env.shortScriptAutomationEnabled; env.shortScriptAutomationEnabled = true;
    const application = configureRecutApplication({ runtimeAdapters });
    const { server, baseUrl } = await harness.startServer();
    try {
      const token = await harness.loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
      const response = await harness.jsonRequest(baseUrl, `/api/v1/short-scripts/${script._id}/recut/generate`, { method: 'POST', token, body: {} });
      assert.equal(response.status, 202, JSON.stringify(response.body)); await application.queue.idle();
      assert.equal(harness.store.recutTasks[0].status, 'succeeded', JSON.stringify(harness.store.recutTasks[0].error));
      assert.equal(snapshot(script).state, 'script_review'); assert.equal(calls, 3);
      assert.ok(harness.store.notifications.some((notice) => String(notice.recipientId) === String(harness.ids.teacher)
        && notice.dedupeKey === `recut_task_finished:${harness.store.recutTasks[0]._id}`));
      assert.deepEqual(f.runs, []);
    } finally { await application.dispose(); await harness.stopServer(server); env.shortScriptAutomationEnabled = prior; }
  });
  it('正式server入口自動取得host adapter，保留注入並只恢復完整配置', async () => {
    const source = require('node:fs').readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
    for (const mode of ['configured', 'missing', 'injected', 'disabled']) {
      const events = []; let configured;
      const adapters = { hostStatus: mode, missing: mode === 'missing' ? ['host.runtimeConfigMissing'] : [] };
      const noop = async () => {};
      const generic = new Proxy({}, { get: () => noop });
      const modules = {
        dns: { setServers() {} }, fs: { mkdirSync() {} }, mongoose: generic,
        './config/env': { shortScriptAutomationEnabled: mode !== 'disabled', recutRuntimeConfigPath: file('runtime.json'), uploadDir: file('uploads') },
        './app': { listen: () => ({ close() {} }) },
        './services/recutHostRuntime.service': { createRecutHostRuntime: async (options) => {
          events.push('host'); assert.equal(options.runtimeConfigPath, file('runtime.json')); return adapters;
        } },
        './services/recutApplication.service': { configureRecutApplication: ({ runtimeAdapters }) => {
          configured = runtimeAdapters; return { missing: runtimeAdapters.missing, recover: async () => { events.push('recover'); } };
        } },
        './services/recutConsentLifecycle.service': { configureRecutConsentLifecycle: () => ({ recoverAssetPrivacy: noop }) },
        './services/recutQueue.service': { recutQueue: { stop() {} } },
      };
      const fakeRequire = (name) => modules[name] || generic;
      const sandbox = { require: fakeRequire, module: { exports: {} }, console: { log() {}, info() {}, error() {} },
        setInterval: () => ({ unref() {} }), clearInterval() {}, process: { on() {}, exit() {} } };
      require('node:vm').runInNewContext(source, sandbox, { filename: 'fake-server-bootstrap.js' });
      await sandbox.module.exports.startServer(mode === 'injected' ? { recutRuntimeAdapters: adapters } : {});
      assert.equal(events.includes('host'), !['injected', 'disabled'].includes(mode));
      assert.equal(events.includes('recover'), !['missing', 'disabled'].includes(mode));
      assert.equal(configured, mode === 'disabled' ? undefined : adapters);
    }
  });
});
