const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids, startServer, stopServer, loginAs, jsonRequest } = require('./helpers/backendTestHarness');
const { seedScript, snapshot } = require('./helpers/recutFixtures');
const { fixture, fakeRenderer } = require('./helpers/recutPipelineFixtures');
const { createRecutQueue } = require('../src/services/recutQueue.service');
const { createRecutApplication, configureRecutApplication, buildRecutRuntimeSnapshot } = require('../src/services/recutApplication.service');
const { createRecutSource } = require('../src/services/recutState.service');
const queues = [];
const user = { id: ids.teacher, role: 'teacher' };
describe('recut application 真正組裝與共用佇列', () => {
  beforeEach(resetStore);
  afterEach(async () => { for (const queue of queues) { queue.stop(); await queue.idle(); } queues.length = 0; });
  function queue() { const q = createRecutQueue(); queues.push(q); return q; }
  it('/health 的 recut 狀態：開關關閉不列缺項；缺轉接時 ready 為 false 並列出固定代碼', () => {
    configureRecutApplication({ runtimeAdapters: { hostStatus: 'runtimeConfigMissing', missing: ['host.runtimeConfigMissing'] }, queue: queue() });
    assert.deepEqual(buildRecutRuntimeSnapshot({ automationEnabled: false }).missing, []);
    const snap = buildRecutRuntimeSnapshot({ automationEnabled: true });
    assert.equal(snap.ready, false); assert.equal(snap.hostStatus, 'runtimeConfigMissing');
    assert.ok(snap.missing.includes('host.runtimeConfigMissing')); assert.ok(snap.missing.includes('provider'));
    configureRecutApplication({ runtimeAdapters: { hostStatus: 'configured', decide: async () => ({}), renderer: fakeRenderer(), sourceSteps: [] }, queue: queue() });
    assert.deepEqual(buildRecutRuntimeSnapshot({ automationEnabled: true }), { automationEnabled: true, ready: true, hostStatus: 'configured', missing: [] });
  });
  it('缺轉接在建立任務前回503，明列缺項且不啟動外部工作', async () => {
    const app = createRecutApplication({ queue: queue() }); const script = seedScript();
    await assert.rejects(app.generation.startGeneration({ user, scriptId: script._id }), (error) => {
      assert.equal(error.statusCode, 503); assert.ok(error.details.missing.includes('provider'));
      assert.ok(error.details.missing.includes('media.transcribe')); return true;
    });
    assert.equal(store.recutTasks.length, 0); assert.equal(snapshot(script).state, 'idle');
  });
  it('API生成與審閱採納建議透過同一queue及RC4，建議持久保存', async () => {
    const script = seedScript(); const f = fixture();
    const source = await createRecutSource({ ...f.source, _id: undefined, scriptId: script._id, videoId: ids.teacherVideo,
      frozenAt: new Date(), hitChunkIds: ['chunk1'] });
    let phase = 'generate'; let calls = 0;
    const runtimeAdapters = { renderer: fakeRenderer(), loadSource: async () => ({ ...source, videoId: ids.teacherVideo }), sourceSteps: [{ id: 'fake-source', stage: 'sourceCheck', run: async () => ({ sourceId: source._id }) }],
      selectionStep: { id: 'fake-selection', stage: 'selection', run: async () => ({ selection: f.selection,
        selectionResult: f.selectionResult, fullScript: f.selectionResult.fullScript, modelId: 'fake' }) },
      getSetting: (key) => key === 'recut.geminiModel' ? { provider: 'gemini', model: 'fake' } : 3,
      decide: async ({ input }) => { calls++; return { output: input.catalog ? f.cards : { issues: phase === 'generate' ? [{ type: 'card_mismatch',
        problem: '第一張圖卡可再清楚', proposedChange: '調整文字', impact: '只改圖卡', sentenceIds: ['s1'], selectionChanges: [],
        presentationPaths: ['/plan/scenes/0/params/text'] }] : [] } }; } };
    const app = createRecutApplication({ queue: queue(), runtimeAdapters });
    const task = await app.generation.startGeneration({ user, scriptId: script._id }); await app.queue.idle();
    assert.equal(store.recutTasks.find((t) => String(t._id) === task.id).status, 'succeeded', JSON.stringify(store.recutTasks.map((task) => task.error)));
    assert.equal(store.recutTasks[0].suggestions.length, 1); assert.equal(calls, 2);
    const view = await app.review.getReview({ user, scriptId: script._id }); assert.equal(view.suggestions.length, 1);
    phase = 'review';
    const next = await app.review.applySuggestions({ user, scriptId: script._id, versionId: view.versionId,
      expectedRevision: view.revision, suggestionIds: [view.suggestions[0].id] }); await app.queue.idle();
    assert.equal(store.recutTasks.find((t) => String(t._id) === next.id).status, 'succeeded', JSON.stringify(store.recutTasks.map((task) => task.error)));
    assert.equal(store.recutTasks.length, 2); assert.equal(calls, 4); assert.equal(snapshot(script).state, 'script_review');
  });
  it('真HTTP controller使用configure的共享queue：缺配置503，配置後生成及重跑成功', async () => {
    const env = require('../src/config/env'); const priorFlag = env.shortScriptAutomationEnabled; env.shortScriptAutomationEnabled = true;
    const { server, baseUrl } = await startServer(); let application;
    try {
      const script = seedScript(); const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
      const url = `/api/v1/short-scripts/${script._id}/recut`;
      application = configureRecutApplication();
      const unavailable = await jsonRequest(baseUrl, `${url}/generate`, { method: 'POST', token, body: {} });
      assert.equal(unavailable.status, 503); assert.equal(unavailable.body.error.code, 'RECUT_STEPS_NOT_CONFIGURED');
      await application.dispose();
      const f = fixture(); const source = await createRecutSource({ ...f.source, _id: undefined, scriptId: script._id,
        videoId: ids.teacherVideo, frozenAt: new Date(), hitChunkIds: ['chunk1'] });
      let rerun = false;
      application = configureRecutApplication({ runtimeAdapters: { renderer: fakeRenderer(), loadSource: async () => ({ ...source, videoId: ids.teacherVideo }),
        sourceSteps: [{ id: 'http-source', stage: 'sourceCheck', run: async () => ({ sourceId: source._id }) }],
        selectionStep: { id: 'http-select', stage: 'selection', run: async () => ({ selection: f.selection,
          selectionResult: f.selectionResult, fullScript: f.selectionResult.fullScript, modelId: 'fake' }) },
        getSetting: (key) => key === 'recut.geminiModel' ? { provider: 'gemini', model: 'fake' } : 3,
        decide: async ({ input }) => ({ output: input.catalog ? f.cards : { issues: rerun ? [] : [{ type: 'card_mismatch', problem: '圖卡可以調整',
          proposedChange: '調整文字', impact: '只改文字', sentenceIds: ['s1'], selectionChanges: [], presentationPaths: ['/plan/scenes/0/params/text'] }] } }) } });
      await application.recover();
      assert.equal((await jsonRequest(baseUrl, `${url}/generate`, { method: 'POST', token, body: {} })).status, 202); await application.queue.idle();
      const view = (await jsonRequest(baseUrl, `${url}/review`, { token })).body.data;
      assert.equal(view.suggestions.length, 1); rerun = true;
      assert.equal((await jsonRequest(baseUrl, `${url}/suggestions/apply`, { method: 'POST', token,
        body: { versionId: view.versionId, expectedRevision: view.revision, suggestionIds: [view.suggestions[0].id] } })).status, 202);
      await application.queue.idle(); assert.deepEqual(store.recutTasks.map((task) => task.status), ['succeeded', 'succeeded']);
    } finally { await application?.dispose(); await stopServer(server); env.shortScriptAutomationEnabled = priorFlag; }
  });
  it('pipeline owner真正runtime factory可接RC2至RC4，三次fake判斷完成', async () => {
    const script = seedScript(); const f = fixture(); let calls = 0;
    const { lockedSentenceIds: _locked, ...modelSelection } = f.selection;
    const segments = Array.from({ length: 10 }, (_, i) => ({ videoId: ids.teacherVideo, chunkId: `chunk${i}`, startSec: i * 15, endSec: (i + 1) * 15, text: '來源快照' }));
    const runtimeAdapters = require('../src/services/recutRuntimeAdapters.service').createRecutRuntimeAdapters({ allowModel: true,
      provider: async ({ input }) => { calls++; return { output: input.question ? modelSelection : input.catalog ? f.cards : { issues: [] } }; },
      renderer: fakeRenderer(), getSetting: (key) => key === 'recut.geminiModel' ? { provider: 'gemini', model: 'fake' } : 3,
      sourceOptions: { loadInputs: async () => ({ video: { _id: ids.teacherVideo, filePath: 'fake-source.mp4' }, hits: [segments[0]], segments }) },
      media: { probe: async () => ({ streams: [{ codec_type: 'audio' }], format: { duration: '150' } }), decode: async () => {},
        measure: async () => ({ integratedLufs: -18, truePeakDbtp: -4 }),
        transcribe: async () => f.source.sentences.flatMap((sentence) => sentence.words.map((word) => ({ w: word.text, s: word.startSec, e: word.endSec }))) },
    });
    const app = createRecutApplication({ queue: queue(), runtimeAdapters });
    assert.deepEqual(app.missing, []);
    await app.generation.startGeneration({ user, scriptId: script._id }); await app.queue.idle();
    assert.equal(store.recutTasks[0].status, 'succeeded', JSON.stringify(store.recutTasks[0].error));
    assert.equal(calls, 3); assert.equal(snapshot(script).state, 'script_review'); assert.equal(store.recutSources[0].transcriptVersion, 'legacy');
  });
});
