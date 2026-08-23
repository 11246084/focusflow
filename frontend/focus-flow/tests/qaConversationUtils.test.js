import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getRemainingSourceCount,
  getVisibleSources,
  mapConversationMessage,
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
