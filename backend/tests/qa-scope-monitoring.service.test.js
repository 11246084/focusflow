const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  filterCandidatesByScope,
  logScopeEmpty,
} = require('../src/services/qaScopeMonitoring.service');

function captureLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      warn(event, metadata) {
        entries.push({ event, metadata });
      },
    },
  };
}

describe('QA scope monitoring', () => {
  it('emits qa.scope_empty without question or answer data', () => {
    const captured = captureLogger();
    logScopeEmpty({
      courseId: 'course-1',
      userId: 'user-1',
      searchMode: 'atlas',
      reason: 'canonical_video_scope_empty',
    }, captured.logger);

    assert.deepEqual(captured.entries, [{
      event: 'qa.scope_empty',
      metadata: {
        courseId: 'course-1',
        userId: 'user-1',
        searchMode: 'atlas',
        reason: 'canonical_video_scope_empty',
      },
    }]);
    assert.equal('question' in captured.entries[0].metadata, false);
    assert.equal('answer' in captured.entries[0].metadata, false);
  });

  it('keeps only in-scope candidates and emits one aggregate mismatch event', () => {
    const captured = captureLogger();
    const scope = { allowedVideoIds: new Set(['video-allowed']) };
    const candidates = [
      { score: 0.9, segment: { videoId: 'video-allowed' } },
      { score: 0.8, segment: { videoId: 'video-foreign' } },
      { score: 0.7, segment: { videoId: null } },
    ];

    const accepted = filterCandidatesByScope(candidates, {
      scope,
      courseId: 'course-1',
      getSegment: (candidate) => candidate.segment,
    }, captured.logger);

    assert.deepEqual(accepted, [candidates[0]]);
    assert.deepEqual(captured.entries, [{
      event: 'qa.scope_mismatch_dropped',
      metadata: {
        courseId: 'course-1',
        droppedCount: 2,
        totalCount: 3,
        reason: 'candidate_outside_canonical_scope',
      },
    }]);
  });
});
