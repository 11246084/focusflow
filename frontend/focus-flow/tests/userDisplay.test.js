import test from 'node:test';
import assert from 'node:assert/strict';

import { getDisplayName, getStudentWelcomeSubtitle } from '../src/utils/userDisplay.js';

test('顯示登入使用者的實際姓名並去除前後空白', () => {
  assert.equal(getDisplayName({ name: '  林小華  ' }), '林小華');
  assert.equal(getStudentWelcomeSubtitle({ name: '  林小華  ' }), '歡迎回來，林小華');
});

test('缺少姓名時使用安全的訪客顯示文字', () => {
  assert.equal(getDisplayName(null), '訪客');
  assert.equal(getDisplayName({ name: '   ' }), '訪客');
  assert.equal(getStudentWelcomeSubtitle({}), '歡迎回來');
});
