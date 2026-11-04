const { it } = require('node:test');
const assert = require('node:assert/strict');
const { ids, store, resetStore, newObjectId } = require('./helpers/backendTestHarness');
const { listStudentShorts } = require('../src/services/shortAsset.service');
it('Q-B 學生牆排除新版 blocked/processing，即使舊同步仍顯示 playable', async () => {
  resetStore();
  for (const state of ['ready', 'blocked', 'processing', undefined]) {
    store.shortAssets.push({ _id: newObjectId(), courseId: ids.publishedCourse, title: state || 'legacy', status: 'published',
      youtubeVideoId: `test-${state || 'legacy'}`, youtubeAvailability: 'playable', publishedAt: new Date(),
      ...(state ? { youtubeUpload: { remoteState: state } } : {}) });
  }
  const result = await listStudentShorts({ studentId: ids.student, limit: 10 });
  assert.deepEqual(result.items.map(item => item.title).sort(), ['legacy', 'ready']);
});
