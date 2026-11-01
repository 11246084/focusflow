const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids } = require('./helpers/backendTestHarness');
const { seedScript, snapshot } = require('./helpers/recutFixtures');
const { fixture, fakeRenderer } = require('./helpers/recutPipelineFixtures');
const { createRecutQueue } = require('../src/services/recutQueue.service');
const { createRecutApplication } = require('../src/services/recutApplication.service');
const { createRecutSource } = require('../src/services/recutState.service');
const queues = [];
const user = { id: ids.teacher, role: 'teacher' };
describe('recut application 真正組裝與共用佇列', () => {
  beforeEach(resetStore);
  afterEach(async () => { for (const queue of queues) { queue.stop(); await queue.idle(); } queues.length = 0; });
  function queue() { const q = createRecutQueue(); queues.push(q); return q; }
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
});
