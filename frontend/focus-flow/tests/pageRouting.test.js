import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPath, readRoute, resolveSubForRole } from '../src/utils/pageRouting.js';

test('一般入口依網址還原首頁、登入、註冊與系統內頁面', () => {
  assert.deepEqual(readRoute('', '/'), { page: 'landing', sub: null });
  assert.deepEqual(readRoute('', '/login'), { page: 'login', sub: null });
  assert.deepEqual(readRoute('', '/register/'), { page: 'register', sub: null });
  assert.deepEqual(readRoute('', '/app/courses'), { page: 'app', sub: 'courses' });
  assert.deepEqual(readRoute('', '/app/line'), { page: 'app', sub: 'linebot' });
  assert.deepEqual(readRoute('', '/app/unknown'), { page: 'app', sub: null });
});

test('管理員入口使用 /admin 前綴', () => {
  assert.deepEqual(readRoute('/admin', '/admin'), { page: 'app', sub: null });
  assert.deepEqual(readRoute('/admin', '/admin/users'), { page: 'app', sub: 'users' });
  assert.deepEqual(readRoute('/admin', '/admin/login'), { page: 'login', sub: null });
});

test('頁面代號可轉回網址，與 readRoute 互為反函數', () => {
  assert.equal(buildPath('', 'app', 'shortScripts'), '/app/short-scripts');
  assert.equal(buildPath('', 'login'), '/login');
  assert.equal(buildPath('', 'landing'), '/');
  assert.equal(buildPath('/admin', 'app', 'stats'), '/admin/stats');
  assert.deepEqual(readRoute('', buildPath('', 'app', 'reviewShorts')), { page: 'app', sub: 'reviewShorts' });
});

test('網址中的頁面不屬於該身分時回到總覽', () => {
  assert.equal(resolveSubForRole('student', 'upload'), 'home');
  assert.equal(resolveSubForRole('teacher', 'upload'), 'upload');
  assert.equal(resolveSubForRole('student', 'profile'), 'profile');
  assert.equal(resolveSubForRole('admin', null), 'home');
});
