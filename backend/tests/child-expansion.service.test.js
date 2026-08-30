const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const VideoSegment = require('../src/models/videoSegment.model');
const { createLeafRepository, expandParentHits } = require('../src/services/childExpansion.service');

const scope = {
  allowedCourseIds: new Set(['course-1']),
  allowedVideoIds: new Set(['video-1', 'video-2']),
};

const leaves = {
  c1: { chunkId: 'c1', videoId: 'video-1', courseId: 'course-1', startSec: 0, endSec: 10, text: 'one' },
  c2: { chunkId: 'c2', videoId: 'video-1', courseId: 'course-1', startSec: 10, endSec: 20, text: 'two' },
  c3: { chunkId: 'c3', videoId: 'video-1', courseId: 'course-1', startSec: 20, endSec: 30, text: 'three' },
  foreign: { chunkId: 'foreign', videoId: 'video-x', courseId: 'course-x', startSec: 0, endSec: 2, text: 'foreign' },
};

function repository(records = leaves) {
  return {
    async findLeavesByChunkIds(ids) {
      return ids.map((id) => records[id]).filter(Boolean).reverse();
    },
  };
}

function parent(parentId, childChunkIds, score = 0.8, videoId = 'video-1') {
  return { parentId, childChunkIds, score, videoId };
}

function expand(parentHits, overrides = {}) {
  return expandParentHits({
    parentHits,
    leafRepository: repository(),
    scope,
    courseId: 'course-1',
    limit: 10,
    ...overrides,
  });
}

describe('child expansion service', () => {
  it('keeps the fail-closed scope query when the video allowlist is empty', async () => {
    const originalFind = VideoSegment.find;
    let capturedQuery = null;
    VideoSegment.find = (query) => {
      capturedQuery = query;
      return { lean: async () => [] };
    };

    try {
      await createLeafRepository().findLeavesByChunkIds(['c1'], {
        scope: { allowedCourseIds: new Set(), allowedVideoIds: new Set() },
      });
      assert.deepEqual(capturedQuery, {
        $and: [
          {
            $or: [
              { chunkId: { $in: ['c1'] } },
              { segmentId: { $in: ['c1'] } },
            ],
          },
          { _id: { $in: [] } },
        ],
      });
    } finally {
      VideoSegment.find = originalFind;
    }
  });

  it('preserves parent and child id order independent of repository order', async () => {
    const result = await expand([parent('p1', ['c2', 'c1'])]);
    assert.deepEqual(result.leaves.map((leaf) => leaf.chunkId), ['c2', 'c1']);
  });

  it('preserves deterministic multi-parent order', async () => {
    const result = await expand([parent('p1', ['c2']), parent('p2', ['c1', 'c3'])]);
    assert.deepEqual(result.leaves.map((leaf) => leaf.chunkId), ['c2', 'c1', 'c3']);
  });

  it('deduplicates shared children and keeps highest parent score', async () => {
    const result = await expand([parent('p1', ['c1'], 0.5), parent('p2', ['c1'], 0.9)]);
    assert.equal(result.leaves.length, 1);
    assert.equal(result.leaves[0].parentScore, 0.9);
    assert.deepEqual(result.leaves[0].parentIds, ['p1', 'p2']);
    assert.equal(result.diagnostics.duplicateChildCount, 1);
  });

  it('reports missing children without throwing', async () => {
    const result = await expand([parent('p1', ['missing', 'c1'])]);
    assert.deepEqual(result.leaves.map((leaf) => leaf.chunkId), ['c1']);
    assert.equal(result.diagnostics.missingChildCount, 1);
  });

  it('returns a safe empty result for empty child ids', async () => {
    const result = await expand([parent('p1', [])]);
    assert.deepEqual(result.leaves, []);
    assert.equal(result.diagnostics.requestedChildCount, 0);
  });

  it('rejects wrong course, scope, parent video, and requested video', async () => {
    const wrongCourse = { ...leaves.c1, chunkId: 'wrong-course', courseId: 'course-x', videoId: 'video-x' };
    const records = { ...leaves, 'wrong-course': wrongCourse };
    const result = await expand([
      parent('p1', ['foreign']),
      parent('p2', ['c1'], 0.8, 'video-2'),
      parent('p3', ['wrong-course'], 0.8, 'video-x'),
    ], { leafRepository: repository(records), videoId: 'video-1' });
    assert.deepEqual(result.leaves, []);
    assert.equal(result.diagnostics.scopeMismatchCount, 3);
  });

  it('enforces the expansion limit deterministically', async () => {
    const result = await expand([parent('p1', ['c1', 'c2', 'c3'])], { limit: 2 });
    assert.deepEqual(result.leaves.map((leaf) => leaf.chunkId), ['c1', 'c2']);
    assert.equal(result.diagnostics.truncatedChildCount, 1);
  });

  it('preserves citation fields on expanded leaves', async () => {
    const result = await expand([parent('p1', ['c1'])]);
    assert.deepEqual(
      (({ chunkId, videoId, startSec, endSec, transcript }) => ({ chunkId, videoId, startSec, endSec, transcript }))(result.leaves[0]),
      { chunkId: 'c1', videoId: 'video-1', startSec: 0, endSec: 10, transcript: 'one' },
    );
  });
});
