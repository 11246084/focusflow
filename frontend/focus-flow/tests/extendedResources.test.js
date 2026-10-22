import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findExtendedResourcesQuestion,
  formatVideoMeta,
  isFeatureDisabledError,
  isSafeVideoUrl,
  pickDisplayVideos,
} from '../src/utils/extendedResources.js';

describe('延伸學習輔助函式', () => {
  const messages = [
    { role: 'user', content: '光合作用是什麼' },
    { role: 'assistant', status: 'completed', answer: 'a' },
  ];

  it('只對最後一則已完成的 AI 回答取得問題', () => {
    assert.equal(findExtendedResourcesQuestion(messages, 1), '光合作用是什麼');
    assert.equal(findExtendedResourcesQuestion(messages, 0), '');
  });

  it('較舊的回答不查詢', () => {
    const longer = [...messages, { role: 'user', content: '再問一題' }, { role: 'assistant', status: 'completed' }];
    assert.equal(findExtendedResourcesQuestion(longer, 1), '');
    assert.equal(findExtendedResourcesQuestion(longer, 3), '再問一題');
  });

  it('失敗的回答不查詢', () => {
    const failed = [messages[0], { role: 'assistant', status: 'failed' }];
    assert.equal(findExtendedResourcesQuestion(failed, 1), '');
  });

  it('只接受 http(s) 影片網址', () => {
    assert.equal(isSafeVideoUrl('https://stv.naer.edu.tw/v/1'), true);
    assert.equal(isSafeVideoUrl('javascript:alert(1)'), false);
    assert.equal(isSafeVideoUrl(''), false);
  });

  it('過濾無效項目並最多顯示 3 筆', () => {
    const videos = [
      { title: 'a', videoUrl: 'https://x.test/1' },
      { title: 'b', videoUrl: 'javascript:1' },
      { title: '', videoUrl: 'https://x.test/3' },
      { title: 'd', videoUrl: 'https://x.test/4' },
      { title: 'e', videoUrl: 'https://x.test/5' },
      { title: 'f', videoUrl: 'https://x.test/6' },
    ];
    assert.deepEqual(pickDisplayVideos({ videos }).map((v) => v.title), ['a', 'd', 'e']);
    assert.deepEqual(pickDisplayVideos(null), []);
  });

  it('領域與階段組成說明文字', () => {
    assert.equal(formatVideoMeta({ learningField: '自然科學', learningStage: '國小' }), '自然科學・國小');
    assert.equal(formatVideoMeta({ learningField: '', learningStage: '國小' }), '國小');
  });

  it('辨識功能未啟用的 404', () => {
    assert.equal(isFeatureDisabledError({ status: 404, code: 'NOT_FOUND' }), true);
    assert.equal(isFeatureDisabledError({ status: 404, code: 'COURSE_NOT_FOUND' }), false);
    assert.equal(isFeatureDisabledError({ status: 500 }), false);
  });
});
