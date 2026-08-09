const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
  ROLLOUT_REASONS,
  evaluateHierarchicalRollout,
  executeHierarchicalRollout,
  intersectAuthorizedRolloutVideos,
  parseIdentifierAllowlist,
  parseRolloutMode,
} = require('../src/services/hierarchicalRollout.service');
const {
  buildHierarchicalRolloutContractStatus,
} = require('../src/services/runtimeDiagnostics.service');

const ids = {
  course: '6a6da68456dd124511ec5196',
  user: '507f191e810c19729de860ea',
  video: '6a6da69556dd124511ec51eb',
  otherVideo: '507f191e810c19729de860ed',
};

function evaluate(overrides = {}) {
  return evaluateHierarchicalRollout({
    globalEnabled: true,
    rolloutMode: 'shadow',
    rolloutModeValid: true,
    userId: ids.user,
    courseId: ids.course,
    allowedVideoIds: [ids.video],
    allowedCourseIds: [ids.course],
    rolloutVideoIds: [ids.video],
    rolloutUserIds: [ids.user],
    allowlistsValid: true,
    embeddingContractStatus: 'compatible',
    ...overrides,
  });
}

describe('hierarchical rollout policy', () => {
  it('accepts Parent artifact schema/role differences within the same stable contract family', () => {
    assert.equal(buildHierarchicalRolloutContractStatus({
      parent: {
        status: 'incompatible',
        mismatches: ['schemaVersion'],
        error: null,
      },
    }), 'compatible');
  });

  it('still rejects embedding-space contract mismatches', () => {
    assert.equal(buildHierarchicalRolloutContractStatus({
      parent: {
        status: 'incompatible',
        mismatches: ['model', 'normalizationVersion'],
        error: null,
      },
    }), 'incompatible');
  });
  it('keeps the global Gate as the highest-priority kill switch', () => {
    const result = evaluate({ globalEnabled: false, rolloutMode: 'serve' });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, ROLLOUT_REASONS.GLOBAL_GATE_DISABLED);
  });

  it('keeps mode=off on Leaf retrieval', () => {
    assert.equal(evaluate({ rolloutMode: 'off' }).reason, ROLLOUT_REASONS.ROLLOUT_MODE_OFF);
  });

  it('fails closed for an invalid rollout mode', () => {
    const parsed = parseRolloutMode('surprise');
    const result = evaluate({ rolloutMode: parsed.value, rolloutModeValid: parsed.valid });
    assert.equal(parsed.value, 'off');
    assert.equal(result.reason, ROLLOUT_REASONS.INVALID_ROLLOUT_MODE);
  });

  it('normalizes whitespace and duplicates in allowlist config', () => {
    const parsed = parseIdentifierAllowlist(` ${ids.video},${ids.video}, ${ids.otherVideo} `);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.values, [ids.video, ids.otherVideo]);
  });

  it('fails closed for malformed allowlist config', () => {
    const parsed = parseIdentifierAllowlist(`${ids.video},not-an-id`);
    assert.equal(parsed.valid, false);
    assert.deepEqual(parsed.values, []);
    assert.equal(evaluate({ allowlistsValid: false }).reason, ROLLOUT_REASONS.INVALID_ALLOWLIST_CONFIG);
  });

  it('denies a course outside a configured course allowlist', () => {
    assert.equal(
      evaluate({ courseId: ids.otherVideo }).reason,
      ROLLOUT_REASONS.COURSE_NOT_ALLOWLISTED,
    );
  });

  it('denies a user outside a configured user allowlist', () => {
    assert.equal(
      evaluate({ userId: ids.otherVideo }).reason,
      ROLLOUT_REASONS.USER_NOT_ALLOWLISTED,
    );
  });

  it('fails closed when no authorized video scope is present', () => {
    assert.equal(
      evaluate({ allowedVideoIds: [] }).reason,
      ROLLOUT_REASONS.NO_AUTHORIZED_VIDEO,
    );
  });

  it('fails closed when authorized and configured videos do not intersect', () => {
    assert.equal(
      evaluate({ rolloutVideoIds: [ids.otherVideo] }).reason,
      ROLLOUT_REASONS.NO_SUPPORTED_VIDEO_INTERSECTION,
    );
  });

  it('cannot expand authorization with configured rollout videos', () => {
    const result = evaluate({
      allowedVideoIds: [ids.video],
      rolloutVideoIds: [ids.video, ids.otherVideo],
    });
    assert.deepEqual(result.authorizedSupportedVideoIds, [ids.video]);
  });

  it('preserves authorized-video order without mutation', () => {
    const authorized = [ids.otherVideo, ids.video, ids.video];
    const original = [...authorized];
    assert.deepEqual(
      intersectAuthorizedRolloutVideos(authorized, [ids.video, ids.otherVideo]),
      [ids.otherVideo, ids.video],
    );
    assert.deepEqual(authorized, original);
  });

  it('rejects an undeclared Parent embedding contract', () => {
    assert.equal(
      evaluate({ embeddingContractStatus: 'not_declared' }).reason,
      ROLLOUT_REASONS.EMBEDDING_CONTRACT_NOT_DECLARED,
    );
  });

  it('rejects model, dimension, normalization, or other incompatible contracts', () => {
    assert.equal(
      evaluate({ embeddingContractStatus: 'incompatible' }).reason,
      ROLLOUT_REASONS.EMBEDDING_CONTRACT_INCOMPATIBLE,
    );
  });

  it('accepts an eligible shadow request', () => {
    const result = evaluate();
    assert.equal(result.eligible, true);
    assert.equal(result.reason, ROLLOUT_REASONS.SHADOW_ELIGIBLE);
    assert.deepEqual(result.authorizedSupportedVideoIds, [ids.video]);
  });

  it('accepts an eligible serve request', () => {
    const result = evaluate({ rolloutMode: 'serve' });
    assert.equal(result.eligible, true);
    assert.equal(result.reason, ROLLOUT_REASONS.SERVE_ELIGIBLE);
  });

  it('matches the complete fail-closed offline routing matrix', () => {
    const cases = [
      [{ globalEnabled: false, rolloutMode: 'serve' }, false, 'GLOBAL_GATE_DISABLED'],
      [{ rolloutMode: 'off' }, false, 'ROLLOUT_MODE_OFF'],
      [{ courseId: ids.otherVideo }, false, 'COURSE_NOT_ALLOWLISTED'],
      [{ userId: ids.otherVideo }, false, 'USER_NOT_ALLOWLISTED'],
      [{ rolloutVideoIds: [ids.otherVideo] }, false, 'NO_SUPPORTED_VIDEO_INTERSECTION'],
      [{ rolloutMode: 'shadow' }, true, 'SHADOW_ELIGIBLE'],
      [{ rolloutMode: 'serve' }, true, 'SERVE_ELIGIBLE'],
      [{ rolloutMode: 'serve', rolloutVideoIds: [ids.otherVideo] }, false, 'NO_SUPPORTED_VIDEO_INTERSECTION'],
      [{ embeddingContractStatus: 'incompatible' }, false, 'EMBEDDING_CONTRACT_INCOMPATIBLE'],
    ];
    for (const [overrides, eligible, reason] of cases) {
      const result = evaluate(overrides);
      assert.equal(result.eligible, eligible, JSON.stringify(overrides));
      assert.equal(result.reason, reason, JSON.stringify(overrides));
    }
  });
});

describe('hierarchical rollout execution', () => {
  it('does not call Hierarchical Retrieval for an ineligible request', async () => {
    let hierarchyCalls = 0;
    const leaf = { matches: [{ chunkId: 'leaf' }], diagnostics: {} };
    const result = await executeHierarchicalRollout({
      decision: evaluate({ globalEnabled: false }),
      leafSearch: async () => leaf,
      hierarchicalSearch: async () => { hierarchyCalls += 1; },
    });
    assert.equal(hierarchyCalls, 0);
    assert.deepEqual(result.matches, leaf.matches);
  });

  it('keeps Leaf matches unchanged while collecting shadow diagnostics', async () => {
    const leafMatches = [{ chunkId: 'leaf', transcript: 'foreground' }];
    const result = await executeHierarchicalRollout({
      decision: evaluate(),
      leafSearch: async () => ({ matches: leafMatches, diagnostics: { scoringMode: 'leaf' } }),
      hierarchicalSearch: async () => ({
        matches: [{ chunkId: 'shadow', score: 0.9 }, { chunkId: 'shadow-2', score: 0.7 }],
        diagnostics: {
          hierarchical: {
            parentHitCount: 2,
            parentTopScore: 0.9,
            parentSecondScore: 0.7,
            parentTopTwoGap: 0.2,
            diagnostics: { requestedChildCount: 6, foundChildCount: 5, missingChildCount: 1 },
          },
        },
      }),
    });
    assert.equal(result.matches, leafMatches);
    assert.equal(result.diagnostics.scoringMode, 'leaf');
    assert.equal(result.diagnostics.rollout.shadowExecuted, true);
    assert.equal(result.diagnostics.rollout.shadowTopScore, 0.9);
    assert.equal(result.diagnostics.rollout.shadowTopTwoGap, 0.2);
  });

  it('isolates shadow failures from the Leaf response', async () => {
    const result = await executeHierarchicalRollout({
      decision: evaluate(),
      leafSearch: async () => ({ matches: [{ chunkId: 'leaf' }], diagnostics: {} }),
      hierarchicalSearch: async () => {
        const error = new Error('secret connection detail');
        error.code = 'PARENT_SEARCH_TIMEOUT';
        throw error;
      },
    });
    assert.deepEqual(result.matches.map((match) => match.chunkId), ['leaf']);
    assert.equal(result.diagnostics.rollout.shadowError, 'PARENT_SEARCH_TIMEOUT');
    assert.equal(JSON.stringify(result).includes('secret connection detail'), false);
  });

  it('routes eligible serve traffic to Hierarchical Retrieval without a Leaf pre-call', async () => {
    let leafCalls = 0;
    const result = await executeHierarchicalRollout({
      decision: evaluate({ rolloutMode: 'serve' }),
      leafSearch: async () => { leafCalls += 1; return { matches: [] }; },
      hierarchicalSearch: async () => ({ matches: [{ chunkId: 'hierarchy' }], diagnostics: {} }),
    });
    assert.equal(leafCalls, 0);
    assert.deepEqual(result.matches.map((match) => match.chunkId), ['hierarchy']);
  });

  it('keeps the rollout module free of QA write-side service imports', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/hierarchicalRollout.service.js'),
      'utf8',
    );
    for (const forbidden of [
      'usageLog.service',
      'questionRecording.service',
      'faqCache.service',
      'clip.model',
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });

  it('reuses the single QA query embedding for Leaf and Hierarchical routing', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/qa.service.js'),
      'utf8',
    );
    assert.equal((source.match(/await embedQuery\(/g) || []).length, 1);
    assert.equal(source.includes('queryEmbedding: queryVector'), true);
  });
});
