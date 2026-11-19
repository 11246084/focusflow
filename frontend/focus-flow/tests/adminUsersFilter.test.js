import assert from 'node:assert/strict';
import test from 'node:test';
import { filterUsers } from '../src/pages/adminUsersFilter.js';

const users = [
  { id: '1', name: '王小明', email: 'Ming@School.edu', role: 'student', isActive: true },
  { id: '2', name: 'Alice Chen', email: 'alice@school.edu', role: 'teacher', isActive: true },
  { id: '3', name: '陳管理', email: 'admin@school.edu', role: 'admin', isActive: false },
  { id: '4', name: '李同學', email: 'li@other.com', role: 'student', isActive: false },
];
const ids = (list) => list.map((u) => u.id);

test('空條件回傳全部', () => {
  assert.deepEqual(ids(filterUsers(users, {})), ['1', '2', '3', '4']);
  assert.deepEqual(ids(filterUsers(users, { query: '   ' })), ['1', '2', '3', '4']);
  assert.deepEqual(ids(filterUsers(users)), ['1', '2', '3', '4']);
});

test('搜尋比對姓名與 Email，不分大小寫並去頭尾空白', () => {
  assert.deepEqual(ids(filterUsers(users, { query: '  ALICE ' })), ['2']);
  assert.deepEqual(ids(filterUsers(users, { query: 'ming@school' })), ['1']);
  assert.deepEqual(ids(filterUsers(users, { query: '小明' })), ['1']);
  assert.deepEqual(ids(filterUsers(users, { query: 'school.edu' })), ['1', '2', '3']);
  assert.deepEqual(filterUsers(users, { query: 'zzz' }), []);
});

test('身分篩選', () => {
  assert.deepEqual(ids(filterUsers(users, { role: 'student' })), ['1', '4']);
  assert.deepEqual(ids(filterUsers(users, { role: 'teacher' })), ['2']);
  assert.deepEqual(ids(filterUsers(users, { role: 'admin' })), ['3']);
});

test('狀態篩選', () => {
  assert.deepEqual(ids(filterUsers(users, { status: 'active' })), ['1', '2']);
  assert.deepEqual(ids(filterUsers(users, { status: 'inactive' })), ['3', '4']);
});

test('條件組合', () => {
  assert.deepEqual(ids(filterUsers(users, { role: 'student', status: 'inactive' })), ['4']);
  assert.deepEqual(ids(filterUsers(users, { query: 'school', role: 'student', status: 'active' })), ['1']);
  assert.deepEqual(filterUsers(users, { query: 'alice', role: 'student' }), []);
});

test('缺少姓名或 Email 的資料不會出錯', () => {
  assert.deepEqual(ids(filterUsers([{ id: 'x', role: 'student', isActive: true }], { query: 'a' })), []);
});
