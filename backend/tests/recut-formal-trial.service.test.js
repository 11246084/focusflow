'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runFormalTrial } = require('../src/services/recutFormalTrial.service');
const { statistics, selectionStability, tokenUsage, priceUsage, trialMarkdown } = require('../src/services/recutTrialMetrics.service');
const { fixture } = require('./helpers/recutPipelineFixtures');
const topics = () => Array.from({ length: 10 }, (_, i) => ({ topicId: `topic-${i + 1}`, scriptId: 'script', courseId: 'course',
  operationTimes: [{ phase: 'script_review', durationMs: i * 10 }, { phase: 'asset_review', durationMs: 100 + i * 10 }, { phase: 'production_wait', durationMs: i * 30 }] }));
const targetUri = 'mongodb://127.0.0.1:27131/trial';
const price = { modelId: 'fake-model', currency: 'TEST', inputPerMillion: 2, outputPerMillion: 4, asOf: 'test-fixture' };
it('statistics use median/range, stability uses merged source seconds and all three label sets', () => {
  assert.deepEqual(statistics([40, 10, 20, 30]), { count: 4, median: 25, min: 10, max: 40 });
  assert.deepEqual(statistics([]), { count: 0, median: null, min: null, max: null });
  const labels = (label) => ({ answerable: true, sentenceLabels: [{ sentenceId: 's1', label }] });
  const result = selectionStability([{ clips: [{ startSec: 0, endSec: 10 }, { startSec: 5, endSec: 15 }], selection: labels('A') },
    { clips: [{ startSec: 5, endSec: 20 }], selection: labels('B') }, { clips: [{ startSec: 0, endSec: 15 }], selection: labels('A') }]);
  assert.deepEqual(result.pairs.map((p) => p.overlapRatio), [0.5, 1, 0.5]); assert.equal(result.meanOverlapRatio, 2 / 3);
  assert.equal(result.differentLabelSentences, 1); assert.deepEqual(result.pairs.map((p) => p.differentLabelSentences), [1, 0, 1]);
  assert.equal(selectionStability(Array.from({ length: 3 }, () => ({ clips: [], selection: { answerable: false, sentenceLabels: [] } }))).meanOverlapRatio, null);
});
it('cost uses injected prices and billable thinking output; absent usage or price stays unknown', () => {
  const usage = tokenUsage([{ consumesCall: true, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10, totalTokenCount: 150 } }, { consumesCall: false }]);
  assert.equal(usage.modelCalls, 1); assert.equal(usage.outputTokens, 50); assert.equal(priceUsage(usage, price, 'fake-model').amount, 0.0004);
  assert.equal(priceUsage(usage, null, 'fake-model').amount, null); assert.equal(priceUsage(usage, price, 'other-model').amount, null);
  assert.equal(priceUsage(tokenUsage([{ consumesCall: true }]), price, 'fake-model').status, 'unknown');
  const ocr = tokenUsage([{ consumesCall: false, modelId: 'fake-model', input: { budgetKind: 'code-card' }, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, cachedContentTokenCount: 10 } }]);
  assert.equal(ocr.modelCalls, 1); assert.equal(priceUsage(ocr, price, 'fake-model').status, 'unknown');
  assert.equal(priceUsage(ocr, { ...price, cachedInputPerMillion: 1 }, 'fake-model').amount, 0.00027);
});
it('formal trial is dry-run without authorization and rejects shared targets before creating runtime', async () => {
  let calls = 0;
  const result = await runFormalTrial({ topics: topics(), runtimeFactory: () => { calls++; } });
  assert.equal(result.estimatedSharedCalls, 50); assert.equal(result.estimatedCost, null); assert.equal(calls, 0);
  await assert.rejects(runFormalTrial({ topics: topics(), targetUri: 'mongodb+srv://shared/db', output: 'unused', allowModel: true, runtimeFactory: () => { calls++; } }), { code: 'RECUT_LOCAL_DB_REQUIRED' });
  assert.equal(calls, 0);
  await assert.rejects(runFormalTrial({ topics: topics().slice(0, 9) }), { code: 'RECUT_TOPICS_INVALID' });
});
it('ten topics run sequentially with one frozen source and three first steps, accounting failures/unanswerable/human blanks', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'recut-formal-test-'));
  const order = [], f = fixture(); let active = 0, peak = 0, persisted = 0, renders = 0, repeats = 0, estimates = 0;
  try {
    const report = await runFormalTrial({ topics: topics(), targetUri, output, price, allowModel: true, now: () => new Date('2026-11-02T00:00:00Z'), onEstimate: () => { estimates++; },
      runtimeFactory: async ({ input, targetUri: uri }) => {
        assert.equal(uri, targetUri); active++; peak = Math.max(peak, active); order.push(input.topicId);
        const unanswerable = input.topicId === 'topic-2';
        const selection = unanswerable ? { answerable: false, unanswerableReason: 'fake unanswered', ranges: [], sentenceLabels: f.source.sentences.map((s) => ({ sentenceId: s.id, label: '離題' })), openingSentenceId: null } : f.selection;
        const attempt = () => ({ consumesCall: true, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } });
        return { model: { provider: 'gemini', model: 'fake-model' }, callLimit: 5, loadSource: async () => f.source,
          pipeline: { generate: [{ id: 'step', stage: 'selection', run: async (context) => {
            await context.runAttempt({ consumesCall: true, execute: async () => ({ output: {}, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }) });
            if (input.topicId === 'topic-3') throw Object.assign(new Error('mongodb+srv://private:p@atlas/db'), { code: 'RECUT_SOURCE_INVALID' });
            return { version: { sourceId: 'source', selection, fullScript: 'fake script', plan: unanswerable ? null : {} } };
          } }] },
          renderLocal: async () => { renders++; return { filePath: 'D:/fake.mp4' }; },
          persistLocal: async () => { persisted++; },
          repeatSelection: async ({ sourceId }) => { assert.equal(sourceId, 'source'); repeats++; return { version: { selection }, attempts: [attempt()] }; },
          close: async () => { active--; },
        };
      } });
    assert.equal(peak, 1); assert.equal(active, 0); assert.deepEqual(order, topics().map((t) => t.topicId)); assert.equal(estimates, 1);
    assert.equal(persisted, 9); assert.equal(renders, 8); assert.equal(repeats, 18);
    assert.equal(report.summary.topicCount, 10); assert.equal(report.summary.generationSuccessRate, 0.8); assert.equal(report.summary.unanswerableCount, 1);
    assert.equal(report.summary.operationTimeMs.script_review.median, 45); assert.equal(report.summary.operationTimeMs.production_wait.max, 270);
    assert.equal(report.topics[0].usage.modelCalls, 3); assert.equal(report.topics[2].usage.modelCalls, 1); assert.equal(report.topics[2].errorCode, 'RECUT_SOURCE_INVALID');
    assert.equal(report.topics[0].generationUsage.modelCalls, 1); assert.equal(report.topics[0].stabilityUsage.modelCalls, 2);
    assert.equal(report.topics[0].human.professorApproval, null); assert.equal(report.topics[0].stability.meanOverlapRatio, 1);
    const markdown = await fs.readFile(path.join(output, 'report.md'), 'utf8');
    assert.ok(markdown.includes('2026-11-02T00:00:00.000Z')); assert.ok(markdown.includes('| topic-1 |  |  |  |  |  |'));
    assert.ok(!markdown.includes('mongodb')); assert.ok(!(await fs.readFile(path.join(output, 'evidence.json'), 'utf8')).includes('private'));
    assert.ok((await fs.readFile(path.join(output, '01-topic-1/full-script.txt'), 'utf8')).includes('fake script'));
    assert.equal(trialMarkdown(report), markdown);
  } finally { await fs.rm(output, { recursive: true, force: true }); }
});
