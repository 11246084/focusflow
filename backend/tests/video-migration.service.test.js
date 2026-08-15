const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const Video = require('../src/models/video.model');
const { migrateVideoFields } = require('../src/services/videoMigration.service');

describe('video startup migration', () => {
  const originalUpdateMany = Video.collection.updateMany;

  afterEach(() => {
    Video.collection.updateMany = originalUpdateMany;
  });

  it('uses raw legacy-field filters and cleans only explicit BSON null values', async () => {
    const calls = [];
    Video.collection.updateMany = async (...args) => {
      calls.push(args);
      return { modifiedCount: 0 };
    };

    await migrateVideoFields();

    assert.deepEqual(calls[0][0], { video_id: { $exists: true } });
    assert.deepEqual(calls[0][1], [
      { $set: { videoId: '$video_id' } },
      { $unset: 'video_id' },
    ]);
    assert.deepEqual(calls[1][0], { videoId: { $type: 10 } });
    assert.deepEqual(calls[1][1], { $unset: { videoId: '' } });
  });
});
