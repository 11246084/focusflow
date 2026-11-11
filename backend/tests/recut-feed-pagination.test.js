const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids, newObjectId } = require('./helpers/backendTestHarness');
const { listStudentShorts } = require('../src/services/shortAsset.service');
function asset(second, valid = false) {
  const item = { _id: newObjectId(), courseId: ids.publishedCourse, title: `短片${second}`, status: 'published',
    publishedAt: new Date(2026, 10, 2, 0, 0, second), youtubeAvailability: 'playable', youtubeVideoId: `fake-${second}`,
    generationVersion: 1, reviewStatus: valid ? 'approved' : 'pending', youtubeUpload: { remoteState: 'ready' },
    ...(!valid ? { recutVersionId: newObjectId(), sourceScriptId: newObjectId() } : {}) };
  store.shortAssets.push(item); return String(item._id);
}
describe('recut不合資格成品不截斷學生feed分頁', () => {
  beforeEach(resetStore);
  it('前兩筆無效時繼續掃描，後方有效成品跨頁不遺漏', async () => {
    asset(6); asset(5); const first = asset(4, true); asset(3); const second = asset(2, true); asset(1);
    const page = await listStudentShorts({ studentId: ids.student, limit: 1 });
    assert.deepEqual(page.items.map((item) => item.assetId), [first]); assert.ok(page.nextPageToken);
    const next = await listStudentShorts({ studentId: ids.student, limit: 1, pageToken: page.nextPageToken });
    assert.deepEqual(next.items.map((item) => item.assetId), [second]); assert.equal(next.nextPageToken, null);
  });
  it('全部無效時回安全空頁，不encode不存在的成品', async () => {
    asset(3); asset(2); asset(1);
    assert.deepEqual(await listStudentShorts({ studentId: ids.student, limit: 1 }), { items: [], nextPageToken: null });
  });
});
