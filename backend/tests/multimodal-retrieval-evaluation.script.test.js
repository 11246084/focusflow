const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  RRF_K,
  RetrievalEvaluationError,
  aggregateMetricRows,
  applyScorePostprocessor,
  assertEvaluationRuntimeConfiguration,
  assertStrictReadOnlyRoles,
  buildTextVectorPipeline,
  buildVideoVectorPipeline,
  createCommandMonitor,
  evaluateQuestion,
  fuseWithRrf,
  validateQuestionBank,
} = require('../scripts/evaluateMultimodalRetrieval');

function candidate(id, modality, videoId, startSec, endSec, score) {
  return { id, modality, videoId, startSec, endSec, score };
}

describe('multimodal retrieval evaluation script', () => {
  it('builds fixed Top 15 text and video vector searches with course video filters', () => {
    const queryVector = [0.1, 0.2];
    const videoIds = ['v1', 'v2'];
    const text = buildTextVectorPipeline(queryVector, videoIds)[0].$vectorSearch;
    const video = buildVideoVectorPipeline(queryVector, videoIds)[0].$vectorSearch;

    assert.deepEqual(text, {
      index: 'text_embedding_index', path: 'embedding', queryVector,
      numCandidates: 75, limit: 15, filter: { videoId: { $in: videoIds } },
    });
    assert.deepEqual(video, {
      index: 'video_embedding_index', path: 'embedding', queryVector,
      numCandidates: 75, limit: 15, filter: { video_id: { $in: videoIds } },
    });
  });

  it('validates and resolves lecture targets to video ids', () => {
    const result = validateQuestionBank({
      meta: { lectures: [{ lecture: 1, videoId: 'v1' }] },
      questions: [{
        id: 'Q1', type: 'transcript', question: 'q', complex: false,
        expected: {
          answerable: true,
          targets: [{ lecture: 1, startSec: 10, endSec: 20, primary: true }],
        },
      }],
    });
    assert.equal(result.questions[0].targets[0].videoId, 'v1');
  });

  it('uses video id plus interval overlap and reports primary-only separately', () => {
    const question = {
      answerable: true,
      targets: [
        { videoId: 'v1', startSec: 10, endSec: 20, primary: true },
        { videoId: 'v2', startSec: 30, endSec: 40, primary: false },
      ],
    };
    const rankings = {
      text: [candidate('t1', 'text', 'v2', 31, 35, 0.9)],
      video: [candidate('i1', 'video', 'v1', 0, 120.05, 0.8)],
      fusion: [candidate('f1', 'fusion', 'v2', 31, 35, 0.03)],
    };
    const evaluation = evaluateQuestion(question, rankings);

    assert.equal(evaluation.relaxed.text.recallAt1, 1);
    assert.equal(evaluation.primaryOnly.text.recallAt1, 0);
    assert.equal(evaluation.primaryOnly.video.recallAt1, 1);
  });

  it('excludes answerable=false from metrics and records each path top1 score', () => {
    const rankings = {
      text: [candidate('t1', 'text', 'v1', 0, 10, 0.7)],
      video: [candidate('i1', 'video', 'v1', 0, 120, 0.6)],
      fusion: [candidate('f1', 'fusion', 'v1', 0, 120, 0.02)],
    };
    const evaluation = evaluateQuestion({ answerable: false, targets: [] }, rankings);
    assert.equal(evaluation.top1Scores.text.score, 0.7);
    assert.equal(evaluation.top1Scores.video.score, 0.6);
    assert.equal(evaluation.top1Scores.fusion.score, 0.02);

    const aggregated = aggregateMetricRows([{ answerable: false, type: 'irrelevant', evaluation }]);
    assert.equal(aggregated.relaxed.text.questionCount, 0);
    assert.equal(aggregated.relaxed.text.recallAt1, null);
  });

  it('applies the central score postprocessor before ranking', async () => {
    const rankings = {
      text: [
        candidate('a', 'text', 'v1', 0, 10, 0.9),
        candidate('b', 'text', 'v2', 0, 10, 0.8),
      ],
      video: [candidate('c', 'video', 'v3', 0, 120, 0.7)],
    };
    const adjusted = await applyScorePostprocessor({
      runs: [{ question: { id: 'Q1' }, queryVector: [1], rankings }],
      postprocessScores: async () => [{ text: [0.1, 0.95], video: [0.5] }],
    });
    assert.deepEqual(adjusted[0].rankings.text.map((item) => item.id), ['b', 'a']);
    assert.equal(adjusted[0].rankings.video[0].score, 0.5);
  });

  it('fuses paths by lecture video with RRF k=60 and preserves interval components', () => {
    const fused = fuseWithRrf({
      text: [
        candidate('t1', 'text', 'v1', 10, 20, 0.9),
        candidate('t2', 'text', 'v2', 10, 20, 0.8),
      ],
      video: [
        candidate('i1', 'video', 'v2', 0, 120, 0.95),
        candidate('i2', 'video', 'v1', 0, 120, 0.85),
      ],
    });
    assert.equal(RRF_K, 60);
    assert.equal(fused.length, 2);
    assert.equal(fused[0].videoId, 'v1');
    assert.equal(fused[0].components.length, 2);
    assert.equal(fused[0].score, (1 / 61) + (1 / 62));
  });

  it('requires a sole read role and detects MongoDB write commands', () => {
    assert.deepEqual(assertStrictReadOnlyRoles([{ role: 'read', db: 'focusflow' }], 'focusflow'), {
      verified: true, role: 'read', database: 'focusflow',
    });
    assert.throws(
      () => assertStrictReadOnlyRoles([{ role: 'readWrite', db: 'focusflow' }], 'focusflow'),
      (error) => error instanceof RetrievalEvaluationError
        && error.code === 'RETRIEVAL_EVAL_DATABASE_ROLE_NOT_READ_ONLY',
    );

    const monitor = createCommandMonitor();
    monitor.observe({ commandName: 'aggregate' });
    monitor.observe({ commandName: 'insert' });
    assert.throws(
      () => monitor.assertNoWrites(),
      (error) => error.code === 'RETRIEVAL_EVAL_WRITE_DETECTED',
    );
  });

  it('requires the Gemini query space before opening the evaluation database', () => {
    assert.doesNotThrow(() => assertEvaluationRuntimeConfiguration({
      qaQueryEmbeddingProvider: 'gemini', geminiApiKey: 'test-key',
    }));
    assert.throws(
      () => assertEvaluationRuntimeConfiguration({
        qaQueryEmbeddingProvider: 'mock', geminiApiKey: 'test-key',
      }),
      (error) => error.code === 'RETRIEVAL_EVAL_QUERY_PROVIDER_INCOMPATIBLE',
    );
    assert.throws(
      () => assertEvaluationRuntimeConfiguration({
        qaQueryEmbeddingProvider: 'gemini', geminiApiKey: '',
      }),
      (error) => error.code === 'RETRIEVAL_EVAL_QUERY_PROVIDER_NOT_CONFIGURED',
    );
  });
});
