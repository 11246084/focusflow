const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { expandParentHits } = require('../src/services/childExpansion.service');
const { assembleLeafContext } = require('../src/services/leafContextAssembly.service');
const { buildCitations } = require('../src/services/qa.service');

const scope = {
  allowedCourseIds: new Set(['course-1']),
  allowedVideoIds: new Set(['video-1']),
};

function parent(parentId, childChunkIds, score = 0.8) {
  return {
    parentId,
    courseId: 'course-1',
    videoId: 'video-1',
    childChunkIds,
    score,
  };
}

describe('QA citation contract', () => {
  it('adds the canonical Leaf chunkId while preserving existing fields and Leaf timestamps', () => {
    const [citation] = buildCitations([{
      chunkId: 'video_chunk_0001',
      segmentId: 'segment_0001',
      videoId: 'video_001',
      startSec: 10,
      endSec: 20,
      transcript: 'short leaf transcript',
      score: 0.9,
    }]);

    assert.equal(citation.chunkId, 'video_chunk_0001');
    assert.equal(citation.segmentId, 'segment_0001');
    assert.equal(citation.videoId, 'video_001');
    assert.deepEqual(
      { startSec: citation.timestamp.startSec, endSec: citation.timestamp.endSec },
      { startSec: 10, endSec: 20 },
    );
    assert.deepEqual(Object.keys(citation).sort(), [
      'chunkId', 'citationId', 'clipPath', 'match', 'modality', 'segmentId',
      'sourceVideo', 'timestamp', 'transcriptSnippet', 'videoId', 'videoTitle',
    ].sort());
  });

  it('uses null rather than fabricating chunkId for a legacy segmentId-only match', () => {
    const [citation] = buildCitations([{
      segmentId: 'legacy-segment', videoId: 'video-1', startSec: 1, endSec: 2, transcript: 'legacy', score: 0.5,
    }]);
    assert.equal(citation.chunkId, null);
    assert.equal(citation.segmentId, 'legacy-segment');
  });

  it('deduplicates a shared Child, keeps its highest Parent score, and emits one citation', async () => {
    const leaf = {
      chunkId: 'shared-child', segmentId: 'shared-child', videoId: 'video-1', courseId: 'course-1',
      startSec: 12, endSec: 18, text: 'shared leaf',
    };
    const expansion = await expandParentHits({
      parentHits: [parent('parent-1', ['shared-child'], 0.4), parent('parent-2', ['shared-child'], 0.9)],
      leafRepository: { async findLeavesByChunkIds() { return [leaf]; } },
      scope,
      courseId: 'course-1',
      videoId: 'video-1',
      limit: 10,
    });
    const context = assembleLeafContext({ leaves: expansion.leaves });
    const citations = buildCitations(context.matches);

    assert.equal(expansion.diagnostics.duplicateChildCount, 1);
    assert.equal(citations.length, 1);
    assert.equal(citations[0].chunkId, 'shared-child');
    assert.equal(citations[0].match.score, 0.9);
  });

  it('does not create citations for missing or out-of-scope Children', async () => {
    const expansion = await expandParentHits({
      parentHits: [parent('parent-1', ['missing', 'foreign'])],
      leafRepository: {
        async findLeavesByChunkIds() {
          return [{
            chunkId: 'foreign', videoId: 'video-2', courseId: 'course-2',
            startSec: 0, endSec: 1, text: 'foreign',
          }];
        },
      },
      scope,
      courseId: 'course-1',
      videoId: 'video-1',
      limit: 10,
    });
    const citations = buildCitations(assembleLeafContext({ leaves: expansion.leaves }).matches);

    assert.deepEqual(citations, []);
    assert.equal(expansion.diagnostics.missingChildCount, 1);
    assert.equal(expansion.diagnostics.scopeMismatchCount, 1);
  });
});
