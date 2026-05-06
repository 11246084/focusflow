const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isLikelyEncodingDamaged } = require('../src/utils/textEncoding');

describe('isLikelyEncodingDamaged', () => {
  it('flags ASCII-only strings dominated by question marks', () => {
    assert.equal(isLikelyEncodingDamaged('????????????'), true);
    assert.equal(isLikelyEncodingDamaged('????'), true);
  });

  it('flags strings containing the Unicode replacement character', () => {
    assert.equal(isLikelyEncodingDamaged('hello�world'), true);
  });

  it('does not flag normal Chinese questions', () => {
    assert.equal(isLikelyEncodingDamaged('OpenCV是什麼?'), false);
    assert.equal(isLikelyEncodingDamaged('執行邏輯'), false);
    assert.equal(isLikelyEncodingDamaged('影像處理導論'), false);
  });

  it('does not flag normal English questions ending in ?', () => {
    assert.equal(isLikelyEncodingDamaged('What is OpenCV?'), false);
    assert.equal(isLikelyEncodingDamaged('Why?'), false);
  });

  it('does not flag empty/null/whitespace', () => {
    assert.equal(isLikelyEncodingDamaged(''), false);
    assert.equal(isLikelyEncodingDamaged(null), false);
    assert.equal(isLikelyEncodingDamaged(undefined), false);
  });

  it('does not flag short strings with few question marks', () => {
    assert.equal(isLikelyEncodingDamaged('???'), false);
    assert.equal(isLikelyEncodingDamaged('a?b?c?'), false);
  });
});
