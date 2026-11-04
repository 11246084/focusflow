import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverLocalPlayback, resolveVideoPlayback } from '../src/pages/studentPlayback.js';
import { waitingUploadText, describeSwitch } from '../src/services/youtubeLifecycle.js';
import { deriveDisplayStatus, describeAssetState, groupUploadScripts } from '../src/services/shortScriptStatus.js';
import { toChineseErrorMessage } from '../src/utils/errorMessages.js';

test('playback keeps local source while YouTube ID exists and switches only when source changes', () => {
  const local = { videoSource: 'upload', youtubeVideoId: 'abc12345678', sourceUrl: '/api/v1/videos/1/source', playbackSource: { type: 'local' } };
  assert.equal(resolveVideoPlayback(local).type, 'upload');
  assert.equal(resolveVideoPlayback({ ...local, videoSource: 'youtube', playbackSource: { type: 'youtube' } }).type, 'youtube');
  assert.equal(resolveVideoPlayback({ ...local, playbackSource: { type: 'unavailable' } }).type, 'unavailable');
  assert.equal(resolveVideoPlayback({ sourceType: 'upload', video_url: '/uploads/old.mp4' }).videoUrl, '/uploads/old.mp4');
  assert.equal(resolveVideoPlayback({ sourceType: 'upload', videoUrl: 'https://www.youtube.com/watch?v=abc12345678' }).type, 'youtube');
});
test('waiting videos and short assets communicate automatic retry and remain in waiting group', () => {
  assert.match(waitingUploadText({ status: 'waiting', nextRetryAt: '2026-10-29T00:00:00Z' }), /自動補傳/);
  const script = { _id: 's', status: 'draft' };
  const asset = { id: 'a', sourceScriptId: 's', status: 'draft', upload: { status: 'waiting' } };
  assert.equal(deriveDisplayStatus(script, [asset]).key, 'upload_waiting');
  assert.equal(describeAssetState(asset).youtube, '等待自動補傳');
  assert.equal(groupUploadScripts([script], [asset]).waiting.length, 1);
  assert.equal(groupUploadScripts([script], [asset]).action.length, 0);
});
test('storage errors and privacy switch communicate their actual state', () => {
  assert.match(toChineseErrorMessage({ code: 'UPLOAD_STORAGE_LOW', status: 507 }), /儲存空間不足/);
  assert.match(toChineseErrorMessage({ status: 507 }), /儲存空間不足/);
  const sw = describeSwitch({ key: 'privacy_guard', envAllowed: true, effective: false, runtimeEnabled: null });
  assert.equal(sw.label, '隱私保護'); assert.equal(sw.nextEnabled, true);
});

const youtubeVideo = { _id: 'videoA', videoSource: 'youtube', youtubeVideoId: 'abc12345678' };

for (const stage of ['HEAD', 'GET']) {
  for (const outcome of ['success', 'forbidden']) {
    test(`A 課程第 0 片 ${stage} 延遲${outcome === 'forbidden' ? '失敗' : '成功'}後不覆蓋 B 課程第 0 片`, async () => {
      const delayed = Promise.withResolvers();
      const reached = Promise.withResolvers();
      const selectionA = { course: 'A', index: 0 };
      let selection = selectionA;
      let metadataLoads = 0;
      const recovery = recoverLocalPlayback({
        videoId: 'videoA',
        isCurrent: () => selection === selectionA,
        probe: () => {
          if (stage === 'HEAD') { reached.resolve(); return delayed.promise; }
          return Promise.resolve({ status: 409 });
        },
        loadVideo: () => { metadataLoads += 1; reached.resolve(); return delayed.promise; },
      });
      await reached.promise;
      selection = { course: 'B', index: 0 };
      if (outcome === 'forbidden') delayed.reject({ status: 403, code: 'COURSE_ACCESS_DENIED' });
      else delayed.resolve(stage === 'HEAD' ? { status: 409 } : { data: { video: youtubeVideo } });
      assert.equal(await recovery, null, '舊請求不可產生 metadata、seek 或錯誤更新');
      assert.equal(metadataLoads, stage === 'HEAD' ? 0 : 1, 'HEAD 返回時已過期則不得再查 metadata');
    });
  }
}

test('切回同一支影片的新播放世代也拒絕前一世代回應', async () => {
  const delayed = Promise.withResolvers();
  const oldSelection = { index: 0, videoId: 'videoA' };
  let selection = oldSelection;
  const recovery = recoverLocalPlayback({
    videoId: 'videoA', isCurrent: () => selection === oldSelection,
    probe: () => delayed.promise, loadVideo: async () => ({ data: { video: youtubeVideo } }),
  });
  selection = { index: 0, videoId: 'videoA' };
  delayed.resolve({ status: 409 });
  assert.equal(await recovery, null);
});

test('目前播放世代的 409 仍可取得 YouTube 影片以續播', async () => {
  const result = await recoverLocalPlayback({
    videoId: 'videoA', isCurrent: () => true,
    probe: async () => ({ status: 409 }), loadVideo: async () => ({ data: { video: youtubeVideo } }),
  });
  assert.deepEqual(result, { refreshed: youtubeVideo });
});

test('目前播放世代保留權限拒絕與準備中錯誤', async () => {
  for (const status of [403, 404]) {
    const result = await recoverLocalPlayback({
      videoId: 'videoA', isCurrent: () => true,
      probe: async () => ({ status }), loadVideo: async () => ({ data: { video: { videoSource: 'upload' } } }),
    });
    assert.equal(result.error, status === 403 ? '目前沒有這門課程的觀看權限。' : '影片準備中，可先提問。');
  }
});
