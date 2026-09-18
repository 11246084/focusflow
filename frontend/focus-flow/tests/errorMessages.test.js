import test from 'node:test';
import assert from 'node:assert/strict';

import { toChineseErrorMessage } from '../src/utils/errorMessages.js';

test('已知錯誤碼轉成中文說明', () => {
  assert.equal(
    toChineseErrorMessage({ code: 'INVALID_CREDENTIALS', status: 401, message: 'Invalid email or password.' }),
    'Email 或密碼錯誤。',
  );
});

test('VALIDATION_ERROR 依英文原句逐句翻譯', () => {
  assert.equal(
    toChineseErrorMessage({ code: 'VALIDATION_ERROR', status: 400, message: 'Password must be at least 8 characters.' }),
    '密碼至少 8 個字元。',
  );
});

test('後端已是中文的訊息直接沿用', () => {
  assert.equal(
    toChineseErrorMessage({ code: 'SOMETHING_NEW', status: 400, message: '這個綁定碼無效。' }),
    '這個綁定碼無效。',
  );
});

test('未知錯誤碼與英文訊息依 HTTP 狀態給通用中文說明', () => {
  assert.equal(
    toChineseErrorMessage({ code: 'SOMETHING_NEW', status: 403, message: 'Nope.' }),
    '你沒有權限執行這個操作。',
  );
  assert.equal(
    toChineseErrorMessage({ status: 502, message: '' }),
    '伺服器暫時無法處理，請稍後再試。',
  );
});

test('登入失敗時提醒次數限制與剩餘次數', () => {
  const message = toChineseErrorMessage({
    code: 'INVALID_CREDENTIALS',
    status: 401,
    details: { remainingAttempts: 3, maxAttempts: 5, lockMinutes: 15 },
  });
  assert.match(message, /連續輸錯 5 次會暫時鎖定 15 分鐘/);
  assert.match(message, /還可以再試 3 次/);
});

test('帳號鎖定時顯示大約還要等幾分鐘', () => {
  const message = toChineseErrorMessage({
    code: 'TOO_MANY_LOGIN_ATTEMPTS',
    status: 429,
    details: { retryAfterSec: 601, lockMinutes: 15 },
  });
  assert.match(message, /請約 11 分鐘後再試/);
});

test('沒有狀態碼時視為連線失敗', () => {
  assert.equal(toChineseErrorMessage({}), '無法連線到伺服器，請確認網路後再試。');
});
