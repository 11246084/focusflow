import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getRemainingSourceCount,
  getVisibleSources,
  mapConversationMessage,
  scrollConversationMessageIntoView,
  toStudentCitation,
} from '../src/pages/qaConversationUtils.js';

describe('multi-turn citation presentation', () => {
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

  it('restores assistant sources from persisted messages', () => {
    const message = mapConversationMessage({ role: 'assistant', content: '回答', sources });
    assert.equal(message.answer, '回答');
    assert.equal(message.matches.length, 5);
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
