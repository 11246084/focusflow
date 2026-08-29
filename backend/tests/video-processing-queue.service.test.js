const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');

const {
  enqueueVideoProcessing,
  getVideoProcessingQueueSnapshot,
  resetVideoProcessingQueueForTests,
} = require('../src/services/videoProcessingQueue.service');

describe('local video processing queue', () => {
  afterEach(() => resetVideoProcessingQueueForTests());

  it('keeps later videos queued until the active pipeline closes', () => {
    const starts = [];
    const completions = new Map();
    const start = (videoId) => (done) => {
      starts.push(videoId);
      completions.set(videoId, done);
    };

    enqueueVideoProcessing({ videoId: 'video-1', start: start('video-1') });
    enqueueVideoProcessing({ videoId: 'video-2', start: start('video-2') });

    assert.deepEqual(starts, ['video-1']);
    assert.equal(getVideoProcessingQueueSnapshot().queued, 1);

    completions.get('video-1')();
    assert.deepEqual(starts, ['video-1', 'video-2']);
    assert.deepEqual(getVideoProcessingQueueSnapshot().activeVideoIds, ['video-2']);
  });

  it('does not enqueue the same video twice', () => {
    const first = enqueueVideoProcessing({ videoId: 'video-1', start: () => {} });
    const second = enqueueVideoProcessing({ videoId: 'video-1', start: () => {} });

    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);
    assert.equal(second.duplicate, true);
  });

  it('releases the worker when process startup throws', async () => {
    const starts = [];
    enqueueVideoProcessing({
      videoId: 'video-1',
      start: () => { throw new Error('spawn failed'); },
      onStartError: () => starts.push('failed'),
    });
    enqueueVideoProcessing({ videoId: 'video-2', start: () => starts.push('video-2') });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(starts, ['failed', 'video-2']);
  });
});
