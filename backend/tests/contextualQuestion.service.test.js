const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { contextualizeQuestion } = require('../src/services/contextualQuestion.service');

describe('contextual question rewriting', () => {
  it('rewrites a pronoun follow-up with the previous CNN topic', () => {
    const result = contextualizeQuestion({
      recentConversationHistory: [
        { role: 'user', content: '什麼是 CNN？' },
        { role: 'assistant', content: 'CNN 是卷積神經網路。' },
      ],
      currentQuestion: '那它的缺點呢？',
    });
    assert.equal(result.requiresContext, true);
    assert.match(result.standaloneQuestion, /CNN/);
    assert.match(result.standaloneQuestion, /缺點/);
  });

  it('keeps both sides of a comparison follow-up', () => {
    const result = contextualizeQuestion({
      recentConversationHistory: [{ role: 'user', content: '老師怎麼解釋監督式學習？' }],
      currentQuestion: '跟非監督式學習有什麼差？',
    });
    assert.match(result.standaloneQuestion, /監督式學習/);
    assert.match(result.standaloneQuestion, /非監督式學習/);
  });

  it('does not contaminate an independent question with the previous topic', () => {
    const result = contextualizeQuestion({
      recentConversationHistory: [{ role: 'user', content: '什麼是 CNN？' }],
      currentQuestion: '老師有介紹 MongoDB 嗎？',
    });
    assert.equal(result.requiresContext, false);
    assert.equal(result.standaloneQuestion, '老師有介紹 MongoDB 嗎？');
  });
});
