import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINE_PAGE_PATH,
  claimLineAutoStart,
  completeLineLogin,
  describeFriendStatus,
  describeLineLoginFailure,
  describeLineLoginSuccess,
  readLineCallback,
  requestLineAuthorizeUrl,
} from '../src/utils/lineLogin.js';

const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const authorizeUrl = 'https://access.line.me/oauth2/v2.1/authorize?state=abc';

describe('開始連結 LINE', () => {
  it('只送課程與換綁確認，帶 CSRF 標頭，回傳 LINE 授權網址', async () => {
    let received;
    const url = await requestLineAuthorizeUrl({
      courseId: 'course-1',
      replaceExisting: true,
      fetchImpl: async (...args) => { received = args; return response({ data: { authorizeUrl } }); },
    });

    assert.equal(url, authorizeUrl);
    assert.equal(received[0], '/api/v1/line/login/start');
    assert.deepEqual(JSON.parse(received[1].body), { courseId: 'course-1', replaceExisting: true });
    assert.equal(received[1].headers['X-Requested-With'], 'FocusFlow');
  });

  it('沒有確認換綁時不會送出確認', async () => {
    let body;
    await requestLineAuthorizeUrl({
      fetchImpl: async (_url, options) => { body = options.body; return response({ data: { authorizeUrl } }); },
    });

    assert.deepEqual(JSON.parse(body), {});
  });

  for (const [label, url] of [
    ['其他網站', 'https://evil.example/oauth2/v2.1/authorize'],
    ['LINE 網域的仿冒子字串', 'https://access.line.me.evil.example/authorize'],
    ['沒有網址', undefined],
  ]) {
    it(`後端回傳${label}時不導向`, async () => {
      await assert.rejects(requestLineAuthorizeUrl({
        fetchImpl: async () => response({ data: { authorizeUrl: url } }),
      }));
    });
  }

  it('未設定 LINE Login 時保留錯誤碼，讓頁面改走備援', async () => {
    await assert.rejects(
      requestLineAuthorizeUrl({
        fetchImpl: async () => response({ message: 'x', error: { code: 'LINE_LOGIN_NOT_CONFIGURED' } }, 503),
      }),
      { code: 'LINE_LOGIN_NOT_CONFIGURED', message: '暫時無法用這個方式連結 LINE，請稍後再試。' },
    );
  });
});

describe('進頁面自動前往 LINE', () => {
  const memoryStorage = () => {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  };

  it('每個分頁只自動一次，取消或返回後不會再被帶走', () => {
    const storage = memoryStorage();

    assert.equal(claimLineAutoStart(storage), true);
    assert.equal(claimLineAutoStart(storage), false);
    assert.equal(claimLineAutoStart(storage), false);
  });

  it('瀏覽器擋 sessionStorage 時不自動，避免迴圈', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };

    assert.equal(claimLineAutoStart(blocked), false);
  });
});

describe('LINE 導回網址', () => {
  it('取出 code 與 state', () => {
    assert.deepEqual(readLineCallback('?code=c1&state=s1'), { kind: 'authorized', code: 'c1', state: 's1' });
  });

  it('學生取消授權時不送出完成請求', () => {
    assert.deepEqual(readLineCallback('?error=access_denied&state=s1'), { kind: 'cancelled' });
  });

  it('缺 code 或 state 視為無效', () => {
    assert.deepEqual(readLineCallback('?code=c1'), { kind: 'invalid' });
    assert.deepEqual(readLineCallback(''), { kind: 'invalid' });
  });
});

describe('完成連結', () => {
  it('同一個 state 只送一次請求，StrictMode 重複執行也不會用掉兩次', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return response({ data: { bound: true } }); };

    const [first, second] = await Promise.all([
      completeLineLogin({ code: 'c', state: 'once' }, { fetchImpl }),
      completeLineLogin({ code: 'c', state: 'once' }, { fetchImpl }),
    ]);

    assert.equal(calls, 1);
    assert.deepEqual(first, { bound: true });
    assert.deepEqual(second, { bound: true });
  });

  it('未登入時保留 401，不把使用者當成登入過期', async () => {
    await assert.rejects(
      completeLineLogin({ code: 'c', state: 'anonymous' }, {
        fetchImpl: async () => response({ error: { code: 'UNAUTHORIZED' } }, 401),
      }),
      { code: 'UNAUTHORIZED', status: 401 },
    );
  });
});

describe('畫面文案', () => {
  it('已綁定與已加好友分開顯示：未加好友時要提示加入官方帳號', () => {
    const friend = describeLineLoginSuccess({ friendship: 'friend', welcomeSent: true });
    const notFriend = describeLineLoginSuccess({ friendship: 'not_friend' });
    const unknown = describeLineLoginSuccess({ friendship: 'unknown' });

    assert.equal(friend.needsFriend, false);
    assert.match(friend.message, /歡迎訊息/);
    assert.equal(notFriend.needsFriend, true);
    assert.match(notFriend.message, /帳號已連結/);
    assert.equal(unknown.needsFriend, true);
    assert.match(unknown.message, /無法確認/);
  });

  it('換 LINE、已連結過與切換課程都有對應說明', () => {
    assert.equal(describeLineLoginSuccess({ replaced: true, friendship: 'friend' }).heading, '已換成新的 LINE');
    assert.equal(describeLineLoginSuccess({ alreadyBound: true, friendship: 'friend' }).heading, '這個 LINE 已經連結過了');
    assert.match(
      describeLineLoginSuccess({ friendship: 'friend', course: { title: 'AI 入門' } }).message,
      /AI 入門/,
    );
  });

  it('沒登入時提示回原瀏覽器，且不提供重新連結', () => {
    const failure = describeLineLoginFailure({ code: 'UNAUTHORIZED' });

    assert.match(failure.message, /原本的瀏覽器/);
    assert.equal(failure.canRetry, undefined);
  });

  it('LINE 已綁定別的帳號時，提示解除而不是重試', () => {
    const failure = describeLineLoginFailure({ code: 'LINE_ACCOUNT_ALREADY_BOUND' });

    assert.match(failure.message, /解除綁定/);
    assert.equal(failure.canRetry, undefined);
    assert.equal(failure.canReplace, undefined);
  });

  it('只有沒確認換綁的情況才提供取代', () => {
    assert.equal(describeLineLoginFailure({ code: 'LINE_REPLACE_CONFIRMATION_REQUIRED' }).canReplace, true);
    assert.equal(describeLineLoginFailure({ code: 'LINE_LOGIN_STATE_MISMATCH' }).canReplace, undefined);
  });

  it('別人的連結不提供重新連結，避免學生順手完成', () => {
    assert.equal(describeLineLoginFailure({ code: 'LINE_LOGIN_STATE_MISMATCH' }).canRetry, undefined);
  });

  it('其他錯誤都能重新連結，不顯示錯誤碼', () => {
    const failure = describeLineLoginFailure({ code: 'LINE_LOGIN_TOKEN_EXCHANGE_FAILED' });

    assert.equal(failure.canRetry, true);
    assert.equal(/LINE_LOGIN/.test(failure.message), false);
  });

  it('LINE 導回的 error 不是 access_denied 時不說成學生取消', () => {
    assert.deepEqual(readLineCallback('?error=server_error&state=s1'), { kind: 'failed' });
    assert.deepEqual(readLineCallback('?error=invalid_request'), { kind: 'failed' });
    assert.deepEqual(readLineCallback('?error=access_denied'), { kind: 'cancelled' });
  });

  it('綁定在處理期間被改變時不說「沒有變更」，也不直接重新連結', () => {
    const failure = describeLineLoginFailure({ code: 'LINE_BINDING_CHANGED' });

    assert.equal(/沒有變更/.test(failure.message), false);
    assert.equal(failure.canRetry, undefined);
    assert.equal(/LINE_BINDING/.test(failure.message), false);
  });

  it('好友狀態沒有資料時顯示無法確認', () => {
    assert.equal(describeFriendStatus('friend'), '已加入官方帳號');
    assert.equal(describeFriendStatus(null), '無法確認是否已加入官方帳號');
  });

  it('完成後固定回到站內頁面', () => {
    assert.equal(LINE_PAGE_PATH, '/app/line');
  });
});
