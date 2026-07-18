const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const logger = require('../src/utils/logger');
const ShortAsset = require('../src/models/shortAsset.model');
const shortsSyncService = require('../src/services/shortsSync.service');
const { env, store, newObjectId, resetStore } = require('./helpers/backendTestHarness');

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function addAsset({
  youtubeVideoId,
  youtubeAvailability = 'pending',
  status = 'published',
} = {}) {
  const asset = {
    _id: newObjectId(),
    courseId: '507f191e810c19729de860eb',
    title: youtubeVideoId,
    status,
    youtubeVideoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
    publishedAt: '2026-07-18T08:00:00.000Z',
    youtubeAvailability,
    youtubePrivacyStatus: 'unknown',
    lastCheckedAt: null,
  };
  store.shortAssets.push(asset);
  return asset;
}

describe('shortsSync.service', () => {
  beforeEach(() => {
    resetStore();
    env.youtubeApiKey = 'youtube-key-for-tests';
    env.shortsSyncIntervalMs = 600000;
    shortsSyncService.resetShortsSyncState();
  });

  it('成功同步 public/unlisted，並對 private 與缺少影片寫入指定 logger.warn', async () => {
    const publicAsset = addAsset({ youtubeVideoId: 'public-video', youtubeAvailability: 'unavailable' });
    const unlistedAsset = addAsset({ youtubeVideoId: 'unlisted-video' });
    const privateAsset = addAsset({ youtubeVideoId: 'private-video', youtubeAvailability: 'playable' });
    const missingAsset = addAsset({ youtubeVideoId: 'missing-video', youtubeAvailability: 'playable' });
    const warnings = [];
    const originalWarn = logger.warn;
    logger.warn = (...args) => warnings.push(args);

    try {
      const result = await shortsSyncService.runShortsSync({
        fetchImpl: async () => response(200, {
          items: [
            { id: 'public-video', status: { privacyStatus: 'public' } },
            { id: 'unlisted-video', status: { privacyStatus: 'unlisted' } },
            { id: 'private-video', status: { privacyStatus: 'private' } },
          ],
        }),
        now: () => new Date('2026-07-18T10:00:00.000Z'),
      });

      assert.deepEqual(result, { checked: 4, failedBatches: 0 });
      assert.equal(publicAsset.youtubeAvailability, 'playable');
      assert.equal(publicAsset.youtubePrivacyStatus, 'public');
      assert.equal(unlistedAsset.youtubeAvailability, 'playable');
      assert.equal(unlistedAsset.youtubePrivacyStatus, 'unlisted');
      assert.equal(privateAsset.youtubeAvailability, 'unavailable');
      assert.equal(privateAsset.youtubePrivacyStatus, 'private');
      assert.equal(missingAsset.youtubeAvailability, 'unavailable');
      assert.equal(missingAsset.youtubePrivacyStatus, 'unknown');
      assert.deepEqual(warnings, [
        ['shorts_sync.unavailable', {
          assetId: String(privateAsset._id),
          youtubeVideoId: 'private-video',
          reason: 'private',
          previousAvailability: 'playable',
          newAvailability: 'unavailable',
          timestamp: '2026-07-18T10:00:00.000Z',
        }],
        ['shorts_sync.unavailable', {
          assetId: String(missingAsset._id),
          youtubeVideoId: 'missing-video',
          reason: 'youtube_video_not_returned',
          previousAvailability: 'playable',
          newAvailability: 'unavailable',
          timestamp: '2026-07-18T10:00:00.000Z',
        }],
      ]);
      assert.equal('reason' in missingAsset, false);
      assert.equal('unavailableReason' in missingAsset, false);
    } finally {
      logger.warn = originalWarn;
    }
  });

  it('網路/429/5xx 使用 fake sleep 重試最多三次且不真的等待', async () => {
    let calls = 0;
    const delays = [];
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      if (calls === 2) return response(429, { error: { message: 'rate limited' } });
      if (calls === 3) return response(500, { error: { message: 'temporary' } });
      return response(200, { items: [] });
    };

    await shortsSyncService.fetchVideoBatch(['video-1'], {
      fetchImpl,
      sleep: async (delay) => delays.push(delay),
      random: () => 0,
      now: () => new Date('2026-07-18T10:00:00.000Z'),
    });

    assert.equal(calls, 4);
    assert.deepEqual(delays, [1000, 2000, 4000]);
  });

  it('優先遵守 Retry-After，400 不重試', async () => {
    const delays = [];
    let retryCalls = 0;
    await shortsSyncService.fetchVideoBatch(['video-1'], {
      fetchImpl: async () => {
        retryCalls += 1;
        if (retryCalls === 1) {
          return response(429, { error: { message: 'rate limited' } }, { 'Retry-After': '2' });
        }
        return response(200, { items: [] });
      },
      sleep: async (delay) => delays.push(delay),
      random: () => 0.99,
      now: () => new Date('2026-07-18T10:00:00.000Z'),
    });
    assert.deepEqual(delays, [2000]);

    let badRequestCalls = 0;
    await assert.rejects(() => shortsSyncService.fetchVideoBatch(['video-1'], {
      fetchImpl: async () => {
        badRequestCalls += 1;
        return response(400, { error: { message: 'bad request' } });
      },
      sleep: async () => assert.fail('400 must not sleep or retry'),
    }));
    assert.equal(badRequestCalls, 1);
  });

  it('整批暫時性失敗保留 availability，只更新 lastCheckedAt', async () => {
    const asset = addAsset({ youtubeVideoId: 'keep-playable', youtubeAvailability: 'playable' });
    const delays = [];
    const result = await shortsSyncService.runShortsSync({
      fetchImpl: async () => response(500, { error: { message: 'temporary outage' } }),
      sleep: async (delay) => delays.push(delay),
      random: () => 0,
      now: () => new Date('2026-07-18T11:00:00.000Z'),
    });

    assert.deepEqual(result, { checked: 1, failedBatches: 1 });
    assert.equal(asset.youtubeAvailability, 'playable');
    assert.equal(new Date(asset.lastCheckedAt).toISOString(), '2026-07-18T11:00:00.000Z');
    assert.deepEqual(delays, [1000, 2000, 4000]);
  });

  it('403 quotaExceeded 不重試並在 health snapshot 標記 degraded', async () => {
    addAsset({ youtubeVideoId: 'quota-video', youtubeAvailability: 'playable' });
    let calls = 0;
    const result = await shortsSyncService.runShortsSync({
      fetchImpl: async () => {
        calls += 1;
        return response(403, {
          error: { message: 'quota exceeded', errors: [{ reason: 'quotaExceeded' }] },
        });
      },
      sleep: async () => assert.fail('quotaExceeded must not retry'),
      now: () => new Date('2026-07-18T12:00:00.000Z'),
    });
    const snapshot = shortsSyncService.buildShortsSyncSnapshot();

    assert.deepEqual(result, { checked: 1, failedBatches: 1 });
    assert.equal(calls, 1);
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.degraded, true);
    assert.equal(snapshot.lastAttemptAt, '2026-07-18T12:00:00.000Z');
    assert.equal(snapshot.lastSuccessAt, null);
    assert.equal(snapshot.lastError, 'YouTube quotaExceeded.');
  });

  it('videos.list 每批最多 50 個 ID', async () => {
    for (let index = 0; index < 51; index += 1) addAsset({ youtubeVideoId: `batch-${index}` });
    const batchSizes = [];
    await shortsSyncService.runShortsSync({
      fetchImpl: async (url) => {
        const ids = new URL(url).searchParams.get('id').split(',');
        batchSizes.push(ids.length);
        return response(200, {
          items: ids.map((id) => ({ id, status: { privacyStatus: 'public' } })),
        });
      },
      now: () => new Date('2026-07-18T13:00:00.000Z'),
    });

    assert.deepEqual(batchSizes, [50, 1]);
  });

  it('startup、interval、direct 同時觸發時共用 single-flight', async () => {
    addAsset({ youtubeVideoId: 'single-flight-video' });
    let intervalCallback;
    let clearCalls = 0;
    let fetchCalls = 0;
    let resolveFetch;
    const deferredResponse = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchImpl = async () => {
      fetchCalls += 1;
      return deferredResponse;
    };
    const originalBulkWrite = ShortAsset.bulkWrite;
    let bulkWriteCalls = 0;
    ShortAsset.bulkWrite = async (...args) => {
      bulkWriteCalls += 1;
      return originalBulkWrite(...args);
    };

    try {
      const timerHandle = shortsSyncService.startShortsSyncScheduler({
        fetchImpl,
        now: () => new Date('2026-07-18T14:00:00.000Z'),
        setIntervalImpl(callback) {
          intervalCallback = callback;
          return { unref() {} };
        },
        clearIntervalImpl() {
          clearCalls += 1;
        },
      });
      assert.ok(timerHandle);

      for (let index = 0; index < 10 && fetchCalls === 0; index += 1) await Promise.resolve();
      assert.equal(fetchCalls, 1);
      const directOne = shortsSyncService.runShortsSync({ fetchImpl });
      const directTwo = shortsSyncService.runShortsSync({ fetchImpl });
      assert.strictEqual(directOne, directTwo);
      intervalCallback();
      await Promise.resolve();
      assert.equal(fetchCalls, 1);

      resolveFetch(response(200, {
        items: [{ id: 'single-flight-video', status: { privacyStatus: 'public' } }],
      }));
      await directOne;
      assert.equal(bulkWriteCalls, 1);

      await shortsSyncService.runShortsSync({
        fetchImpl,
        now: () => new Date('2026-07-18T14:01:00.000Z'),
      });
      assert.equal(fetchCalls, 2);
      assert.equal(bulkWriteCalls, 2);
    } finally {
      shortsSyncService.stopShortsSyncScheduler();
      ShortAsset.bulkWrite = originalBulkWrite;
    }
    assert.equal(clearCalls, 1);
  });

  it('single-flight 執行 throw 後會釋放，下一輪可重新執行', async () => {
    addAsset({ youtubeVideoId: 'release-after-throw' });
    const originalBulkWrite = ShortAsset.bulkWrite;
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      return response(200, {
        items: [{ id: 'release-after-throw', status: { privacyStatus: 'public' } }],
      });
    };
    ShortAsset.bulkWrite = async () => {
      throw new Error('simulated persistence failure');
    };

    try {
      const first = shortsSyncService.runShortsSync({ fetchImpl });
      const concurrent = shortsSyncService.runShortsSync({ fetchImpl });
      assert.strictEqual(first, concurrent);
      await assert.rejects(first, /simulated persistence failure/);
      assert.equal(fetchCalls, 1);
    } finally {
      ShortAsset.bulkWrite = originalBulkWrite;
    }

    const next = await shortsSyncService.runShortsSync({ fetchImpl });
    assert.deepEqual(next, { checked: 1, failedBatches: 0 });
    assert.equal(fetchCalls, 2);
  });
});
