const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  buildCourseSegmentScope,
  buildSegmentLookupQuery,
  segmentMatchesScope,
} = require('../src/services/bridgeScope.service');

function scope({ courseIds = [], videoIds = [] } = {}) {
  return {
    allowedCourseIds: new Set(courseIds),
    allowedVideoIds: new Set(videoIds),
  };
}

describe('bridge scope fail-closed contract', () => {
  it('returns a never-match query when the canonical video allowlist is empty', () => {
    assert.deepEqual(
      buildSegmentLookupQuery(scope({ courseIds: ['course-a'] })),
      { _id: { $in: [] } },
    );
  });

  it('requires the canonical video allowlist even when courseId is present', () => {
    assert.deepEqual(
      buildSegmentLookupQuery(scope({ courseIds: ['course-a'], videoIds: ['video-a'] })),
      { videoId: { $in: ['video-a'] } },
    );
  });

  it('does not allow a matching courseId without an allowed videoId', () => {
    assert.equal(
      segmentMatchesScope(
        { courseId: 'course-a', videoId: 'video-b' },
        scope({ courseIds: ['course-a'], videoIds: ['video-a'] }),
      ),
      false,
    );
  });

  it('allows an allowed canonical videoId when the Leaf has no courseId', () => {
    assert.equal(
      segmentMatchesScope(
        { videoId: 'video-a' },
        scope({ courseIds: ['course-a'], videoIds: ['video-a'] }),
      ),
      true,
    );
  });

  it('rejects a missing or disallowed videoId', () => {
    const allowedScope = scope({ courseIds: ['course-a'], videoIds: ['video-a'] });
    assert.equal(segmentMatchesScope({ courseId: 'course-a' }, allowedScope), false);
    assert.equal(segmentMatchesScope({ videoId: 'video-b' }, allowedScope), false);
  });

  it('builds the allowlist from video._id only', async () => {
    const segmentScope = await buildCourseSegmentScope(
      { _id: 'course-a' },
      {
        videos: [{
          _id: 'canonical-id',
          id: 'id-alias',
          videoId: 'camel-alias',
          video_id: 'snake-alias',
        }],
        courseVideoRefs: ['raw-course-ref'],
      },
    );

    assert.deepEqual([...segmentScope.allowedVideoIds], ['canonical-id']);
  });
});
