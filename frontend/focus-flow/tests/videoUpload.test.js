import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { uploadCourseVideos } from '../src/services/videoUpload.js';

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

function makeFile(name, contents) {
  const file = new Blob([contents], { type: 'video/mp4' });
  Object.defineProperty(file, 'name', { value: name });
  return file;
}

function response(body, { ok = true } = {}) {
  return {
    ok,
    async json() {
      return body;
    },
  };
}

describe('多影片批次上傳契約', () => {
  beforeEach(() => {
    globalThis.localStorage = {
      getItem(key) {
        return key === 'ff_token' ? 'teacher-token' : null;
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  });

  it('以單一 multipart request 傳送所有影片、標題與登入權杖', async () => {
    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return response({
        data: {
          batch: {
            batchId: 'batch_20260814010101_abcdef12',
            items: [
              {
                itemId: 'item_0001',
                originalName: 'first.mp4',
                videoId: 'video-1',
                uploadStatus: 'uploaded',
                processingStatus: 'queued',
              },
              {
                itemId: 'item_0002',
                originalName: 'second.mp4',
                videoId: 'video-2',
                uploadStatus: 'uploaded',
                processingStatus: 'queued',
              },
            ],
          },
        },
      });
    };
    const changes = [];
    const result = await uploadCourseVideos({
      courseId: 'course-1',
      items: [
        { key: 'first-key', file: makeFile('first.mp4', 'one'), title: '第一支' },
        { key: 'second-key', file: makeFile('second.mp4', 'two'), title: '第二支' },
      ],
      onItemChange: (key, change) => changes.push({ key, change }),
    });

    assert.equal(calls.length, 1);
    const [url, options] = calls[0];
    assert.equal(url, 'http://localhost:4000/api/v1/courses/course-1/video-batches');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer teacher-token');
    assert.equal(options.body instanceof FormData, true);
    assert.deepEqual(JSON.parse(options.body.get('titles')), ['第一支', '第二支']);
    assert.equal(options.body.getAll('videos').length, 2);
    assert.equal(result.batchId, 'batch_20260814010101_abcdef12');
    assert.deepEqual(result.items.map((item) => item.key), ['first-key', 'second-key']);
    assert.equal(changes.filter((entry) => entry.change.uploadStatus === 'uploading').length, 2);
    assert.equal(changes.filter((entry) => entry.change.uploadStatus === 'processing').length, 2);
  });

  it('拒絕缺少項目或重複 itemId 的不完整 Backend 回傳', async () => {
    const items = [
      { key: 'first-key', file: makeFile('first.mp4', 'one'), title: '第一支' },
      { key: 'second-key', file: makeFile('second.mp4', 'two'), title: '第二支' },
    ];
    for (const batchItems of [
      [{ itemId: 'item_0001', videoId: 'video-1' }],
      [
        { itemId: 'item_0001', videoId: 'video-1' },
        { itemId: 'item_0001', videoId: 'video-2' },
      ],
    ]) {
      globalThis.fetch = async () => response({
        data: { batch: { batchId: 'batch_20260814010101_abcdef12', items: batchItems } },
      });
      await assert.rejects(
        uploadCourseVideos({ courseId: 'course-1', items, onItemChange: () => {} }),
        /後端回傳格式不完整/,
      );
    }
  });

  it('保留 Backend 的安全錯誤訊息與錯誤代碼', async () => {
    globalThis.fetch = async () => response({
      error: { code: 'VIDEO_BATCH_LIMIT_EXCEEDED', message: '最多只能上傳 10 支影片。' },
    }, { ok: false });

    await assert.rejects(
      uploadCourseVideos({
        courseId: 'course-1',
        items: [{ key: 'first-key', file: makeFile('first.mp4', 'one'), title: '第一支' }],
        onItemChange: () => {},
      }),
      (error) => error.code === 'VIDEO_BATCH_LIMIT_EXCEEDED' && /10 支/.test(error.message),
    );
  });
});
