import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  answerToPlainText,
  canCopyAnswer,
  copyAnswer,
  formatConversationLabel,
  getRemainingSourceCount,
  getVisibleSources,
  mapConversationMessage,
  scrollConversationMessageIntoView,
  shouldSubmitQuestionOnKeyDown,
  toStudentCitation,
} from '../src/pages/qaConversationUtils.js';

describe('多行問題輸入', () => {
  const keyEvent = (overrides = {}) => ({ key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false }, ...overrides });

  it('Enter 送出，Shift+Enter 保留換行', () => {
    assert.equal(shouldSubmitQuestionOnKeyDown(keyEvent()), true);
    assert.equal(shouldSubmitQuestionOnKeyDown(keyEvent({ shiftKey: true })), false);
    assert.equal(shouldSubmitQuestionOnKeyDown(keyEvent({ key: 'a' })), false);
  });

  it('中文輸入法選字時的 Enter 不送出', () => {
    assert.equal(shouldSubmitQuestionOnKeyDown(keyEvent({ nativeEvent: { isComposing: true } })), false);
    assert.equal(shouldSubmitQuestionOnKeyDown(keyEvent({ keyCode: 229 })), false);
  });
});

describe('複製回答', () => {
  it('僅在剪貼簿支援寫入文字時顯示功能', () => {
    assert.equal(canCopyAnswer(undefined), false);
    assert.equal(canCopyAnswer({ writeText: () => {} }), true);
  });

  it('將畫面上的段落文字寫入剪貼簿', async () => {
    let copied;
    const answer = '第一行\n第二行';
    assert.equal(await copyAnswer({ writeText: async (text) => { copied = text; } }, answer), true);
    assert.equal(copied, '第一行 第二行');
  });

  it('依畫面解析標題、粗體與各種條列，將同段清單拆行', async () => {
    const answer = '## **重點**\r\n介紹 **概念** 1. 第一項 2) **第二項**\n• 第三項\n* 第四項\n一、 中文序號';
    const expected = '重點\n\n介紹 概念\n\n1. 第一項\n2. 第二項\n\n- 第三項\n- 第四項\n\n1. 中文序號';
    assert.equal(answerToPlainText(answer), expected);
    let copied;
    await copyAnswer({ writeText: async (text) => { copied = text; } }, answer);
    assert.equal(copied, expected);
  });

  it('保留非標題符號、未成對星號及數學文字', () => {
    assert.equal(answerToPlainText('C# 與 #標籤\n2 ** 3 = 8'), 'C# 與 #標籤 2 ** 3 = 8');
  });

  it('剪貼簿拒絕寫入時不拋出錯誤', async () => {
    assert.equal(await copyAnswer({ writeText: async () => { throw new Error('denied'); } }, '回答'), false);
  });
});

describe('multi-turn citation presentation', () => {
  it('shows multimodal labels while leaving legacy citations unlabeled', () => {
    assert.equal(toStudentCitation({ retrievedBy: ['text', 'audio', 'visual'] }).retrievalLabel, '文字、聲音、畫面');
    assert.equal(toStudentCitation({}).retrievalLabel, '');
  });
  const sources = Array.from({ length: 5 }, (_, index) => ({
    chunkId: `chunk-${index + 1}`, startSec: index * 10, score: 0.9 - index / 10,
  }));

  it('defaults to the top three sources and expands all remaining sources', () => {
    assert.equal(getVisibleSources(sources, false).length, 3);
    assert.equal(getVisibleSources(sources, true).length, 5);
    assert.equal(getRemainingSourceCount(sources), 2);
  });

  it('omits retrieval score from the student citation view', () => {
    const citation = toStudentCitation({ ...sources[0], transcript: '課程內容' });
    assert.equal(Object.hasOwn(citation, 'score'), false);
    assert.equal(citation.startSec, 0);
  });

  it('keeps video modality so image-only sources can be labelled', () => {
    assert.equal(toStudentCitation({ ...sources[0], modality: 'video' }).modality, 'video');
    assert.equal(toStudentCitation(sources[0]).modality, 'text');
  });

  it('restores assistant sources from persisted messages', () => {
    const message = mapConversationMessage({ role: 'assistant', content: '回答', sources });
    assert.equal(message.answer, '回答');
    assert.equal(message.matches.length, 5);
  });
});

describe('recent conversation labels', () => {
  const now = new Date(2026, 9, 27, 18, 30);

  it('keeps a real conversation title', () => {
    assert.equal(formatConversationLabel({ title: '什麼是 RAG？', createdAt: new Date(2026, 9, 27, 9, 5) }, now), '什麼是 RAG？');
  });

  it('labels an untitled conversation from today with its start time', () => {
    assert.equal(formatConversationLabel({ title: 'New conversation', createdAt: new Date(2026, 9, 27, 9, 5) }, now), '新對話 · 09:05');
  });

  it('labels an untitled conversation from another day with its date', () => {
    assert.equal(formatConversationLabel({ title: '新對話', createdAt: new Date(2026, 9, 25, 23, 50) }, now), '新對話 · 10/25');
  });

  it('falls back to the plain label when no time field is available', () => {
    assert.equal(formatConversationLabel({ title: '' }, now), '新對話');
    assert.equal(formatConversationLabel(undefined, now), '新對話');
  });
});

describe('conversation viewport scrolling', () => {
  function createContainer({ top = 100, bottom = 400, scrollTop = 200 } = {}) {
    const calls = [];
    return {
      calls,
      scrollTop,
      getBoundingClientRect: () => ({ top, bottom }),
      scrollTo: (options) => calls.push(options),
    };
  }

  it('scrolls only the message container when the latest message is below view', () => {
    const container = createContainer();
    const message = { getBoundingClientRect: () => ({ top: 380, bottom: 460 }) };

    assert.equal(scrollConversationMessageIntoView(container, message), true);
    assert.deepEqual(container.calls, [{ top: 268, behavior: 'smooth' }]);
  });

  it('does not move the viewport when the latest message is already visible', () => {
    const container = createContainer();
    const message = { getBoundingClientRect: () => ({ top: 180, bottom: 320 }) };

    assert.equal(scrollConversationMessageIntoView(container, message), false);
    assert.deepEqual(container.calls, []);
  });

  it('aligns a long assistant answer at its start instead of hiding the answer', () => {
    const container = createContainer();
    const message = { getBoundingClientRect: () => ({ top: 360, bottom: 760 }) };

    assert.equal(scrollConversationMessageIntoView(container, message), true);
    assert.deepEqual(container.calls, [{ top: 452, behavior: 'smooth' }]);
  });

  it('supports immediate internal scrolling for restored conversations', () => {
    const container = createContainer({ scrollTop: 500 });
    const message = { getBoundingClientRect: () => ({ top: 40, bottom: 90 }) };

    assert.equal(scrollConversationMessageIntoView(container, message, 'auto'), true);
    assert.deepEqual(container.calls, [{ top: 432, behavior: 'auto' }]);
  });
});

describe('問目前這段', () => {
  it('從已處理的本機或 YouTube 播放器即時讀取暫停位置', async () => {
    const { getCurrentSegmentPosition } = await import('../src/pages/qaConversationUtils.js');
    const video = { _id: 'video-1', processing: { status: 'completed' } };
    const local = { readyState: 1, currentTime: 12.5, paused: true };
    assert.deepEqual(getCurrentSegmentPosition(video, local, 'local'), { videoId: 'video-1', positionSec: 12.5 });
    local.currentTime = 30;
    assert.equal(getCurrentSegmentPosition(video, local, 'local').positionSec, 30);
    assert.deepEqual(getCurrentSegmentPosition(video, { getCurrentTime: () => 0 }, 'youtube'), { videoId: 'video-1', positionSec: 0 });
    assert.equal(getCurrentSegmentPosition({ ...video, processing: { status: 'processing' } }, local, 'local'), null);
    assert.equal(getCurrentSegmentPosition(video, { readyState: 0, currentTime: 1 }, 'local'), null);
    assert.equal(getCurrentSegmentPosition(video, { getCurrentTime: () => { throw new Error(); } }, 'youtube'), null);
    assert.equal(getCurrentSegmentPosition(video, { getCurrentTime: () => NaN }, 'youtube'), null);
  });

  it('只有按鈕送出附播放範圍，文字相同的手動問題也不附', async () => {
    const { buildQuestionPayload, CURRENT_SEGMENT_QUESTION } = await import('../src/pages/qaConversationUtils.js');
    assert.deepEqual(buildQuestionPayload(CURRENT_SEGMENT_QUESTION), { content: CURRENT_SEGMENT_QUESTION });
    assert.deepEqual(buildQuestionPayload('目前最常用的演算法是什麼'), { content: '目前最常用的演算法是什麼' });
    assert.deepEqual(buildQuestionPayload(CURRENT_SEGMENT_QUESTION, { videoId: 'v', positionSec: 2 }), { content: CURRENT_SEGMENT_QUESTION, scope: 'current_segment', videoId: 'v', positionSec: 2 });
  });
});
