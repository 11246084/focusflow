const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
const jwt = require('jsonwebtoken');
const {
  createLineSignature,
  env,
  ids,
  jsonRequest,
  loginAs,
  postLineWebhook,
  resetStore,
  startServer,
  stopServer,
  store,
} = require('./helpers/backendTestHarness');
const User = require('../src/models/user.model');

const CHANNEL_ID = '1234567890';
const CHANNEL_SECRET = 'line-login-secret-for-tests';
const CALLBACK_URL = 'http://localhost:5173/line/callback';
const ACCESS_TOKEN = 'line-access-token-for-tests';
const REFRESH_TOKEN = 'line-refresh-token-for-tests';
const NEW_LINE_ID = 'Unew0000000000000000000000000000a';
const START = '/api/v1/line/login/start';
const COMPLETE = '/api/v1/line/login/complete';
const CSRF_HEADERS = { Origin: 'http://localhost:5173', 'X-Requested-With': 'FocusFlow' };

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function signIdToken({ nonce, sub = NEW_LINE_ID, aud = CHANNEL_ID, iss = 'https://access.line.me' }, { secret = CHANNEL_SECRET, algorithm = 'HS256', expiresIn = 3600 } = {}) {
  return jwt.sign({ nonce, sub, aud, iss }, secret, { algorithm, expiresIn });
}

function signUnsecuredIdToken(nonce) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = {
    iss: 'https://access.line.me',
    aud: CHANNEL_ID,
    sub: NEW_LINE_ID,
    nonce,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

function findUser(id) {
  return store.users.find((user) => user._id === id);
}

function boundUsers(lineUserId) {
  return store.users.filter((user) => user.lineUserId === lineUserId);
}

describe('LINE Login 綁定', () => {
  let serverContext;
  let realFetch;
  let line;
  let studentToken;
  let teacherToken;

  // 假的 LINE 平台：token 交換預設用這次流程的 nonce 簽 ID token，授權碼只能用一次
  function installFakeLine() {
    line = {
      calls: [],
      usedCodes: new Set(),
      nonce: null,
      sub: NEW_LINE_ID,
      tokenResponse: null,
      friendship: () => jsonResponse(200, { friendFlag: true }),
      push: () => jsonResponse(200, {}),
    };

    global.fetch = async (url, options = {}) => {
      const target = String(url);
      if (!target.startsWith('https://api.line.me/')) return realFetch(url, options);

      line.calls.push({ url: target, options });

      if (target.endsWith('/oauth2/v2.1/token')) {
        const code = options.body.get('code');
        if (line.tokenResponse) return line.tokenResponse(options.body);
        if (line.usedCodes.has(code)) return jsonResponse(400, { error: 'invalid_grant' });
        line.usedCodes.add(code);
        return jsonResponse(200, {
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          id_token: signIdToken({ nonce: line.nonce, sub: line.sub }),
        });
      }
      if (target.endsWith('/friendship/v1/status')) return line.friendship();
      if (target.endsWith('/message/push')) return line.push(options);
      throw new Error(`Unexpected LINE call: ${target}`);
    };
  }

  function lineCalls(suffix) {
    return line.calls.filter((call) => call.url.endsWith(suffix));
  }

  async function startFlow(token, body = {}) {
    const result = await jsonRequest(serverContext.baseUrl, START, { method: 'POST', token, body });
    assert.equal(result.status, 201);
    const params = new URL(result.body.data.authorizeUrl).searchParams;
    line.nonce = params.get('nonce');
    return { result, params, state: params.get('state'), nonce: params.get('nonce') };
  }

  function complete(token, body) {
    return jsonRequest(serverContext.baseUrl, COMPLETE, { method: 'POST', token, body });
  }

  async function runFlow(token, { startBody = {}, code = 'auth-code-1' } = {}) {
    const flow = await startFlow(token, startBody);
    return complete(token, { code, state: flow.state });
  }

  before(async () => {
    serverContext = await startServer();
    realFetch = global.fetch;
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(async () => {
    resetStore();
    env.lineLoginChannelId = CHANNEL_ID;
    env.lineLoginChannelSecret = CHANNEL_SECRET;
    env.lineLoginCallbackUrl = CALLBACK_URL;
    env.lineChannelSecret = 'line-secret-for-tests';
    env.lineChannelAccessToken = 'channel-access-token-for-tests';
    installFakeLine();
    delete findUser(ids.student).lineUserId;
    studentToken = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    teacherToken = await loginAs(serverContext.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
  });

  afterEach(() => {
    global.fetch = realFetch;
    env.lineLoginChannelId = '';
    env.lineLoginChannelSecret = '';
    env.lineLoginCallbackUrl = '';
    env.lineChannelAccessToken = '';
  });

  describe('正常流程', () => {
    it('授權網址帶 PKCE、state、nonce 與加好友設定，資料庫只存 state 雜湊', async () => {
      const { params, state } = await startFlow(studentToken);

      assert.equal(params.get('client_id'), CHANNEL_ID);
      assert.equal(params.get('redirect_uri'), CALLBACK_URL);
      assert.equal(params.get('response_type'), 'code');
      assert.equal(params.get('scope'), 'openid profile');
      assert.equal(params.get('code_challenge_method'), 'S256');
      assert.equal(params.get('bot_prompt'), 'aggressive');
      assert.equal(store.lineLoginStates.length, 1);
      assert.notEqual(store.lineLoginStates[0]._id, state);
      assert.equal(JSON.stringify(store.lineLoginStates).includes(state), false);
    });

    it('已加好友的學生完成綁定並收到一則歡迎訊息', async () => {
      const result = await runFlow(studentToken);

      assert.equal(result.status, 200);
      assert.equal(result.response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(result.body.data, {
        bound: true,
        alreadyBound: false,
        replaced: false,
        friendship: 'friend',
        welcomeSent: true,
        course: null,
      });
      assert.equal(findUser(ids.student).lineUserId, NEW_LINE_ID);
      assert.equal(findUser(ids.student).lineBindAt instanceof Date, true);
      assert.equal(lineCalls('/message/push').length, 1);
      assert.equal(lineCalls('/oauth2/v2.1/token')[0].options.body.get('code_verifier').length, 43);
    });

    it('略過加好友時仍是已綁定，但不推播訊息', async () => {
      line.friendship = () => jsonResponse(200, { friendFlag: false });

      const result = await runFlow(studentToken);

      assert.equal(result.status, 200);
      assert.equal(result.body.data.friendship, 'not_friend');
      assert.equal(result.body.data.welcomeSent, false);
      assert.equal(findUser(ids.student).lineUserId, NEW_LINE_ID);
      assert.equal(lineCalls('/message/push').length, 0);
    });

    it('好友狀態查不到或推播失敗都不影響綁定結果', async () => {
      line.friendship = () => jsonResponse(500, {});
      const unknown = await runFlow(studentToken);
      assert.equal(unknown.status, 200);
      assert.equal(unknown.body.data.friendship, 'unknown');

      delete findUser(ids.student).lineUserId;
      line.friendship = () => jsonResponse(200, { friendFlag: true });
      line.push = () => jsonResponse(500, {});
      const pushFailed = await runFlow(studentToken, { code: 'auth-code-2' });
      assert.equal(pushFailed.status, 200);
      assert.equal(pushFailed.body.data.welcomeSent, false);
      assert.equal(findUser(ids.student).lineUserId, NEW_LINE_ID);
    });

    it('好友狀態會記下來，/auth/me 回傳狀態但不回傳 LINE ID', async () => {
      line.friendship = () => jsonResponse(200, { friendFlag: false });
      await runFlow(studentToken);

      const me = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me', { token: studentToken });

      assert.equal(me.body.data.user.isLineBound, true);
      assert.equal(me.body.data.user.lineFriendStatus, 'not_friend');
      assert.equal(JSON.stringify(me.body).includes(NEW_LINE_ID), false);
    });

    it('好友狀態查不到時保留已知的狀態', async () => {
      const student = findUser(ids.student);
      student.lineUserId = NEW_LINE_ID;
      student.lineFriendStatus = 'friend';
      line.friendship = () => jsonResponse(500, {});

      const result = await runFlow(studentToken);

      assert.equal(result.body.data.friendship, 'unknown');
      assert.equal(student.lineFriendStatus, 'friend');
    });

    it('開始新的連結時，同一位使用者先前未完成的流程作廢', async () => {
      const first = await startFlow(studentToken);
      await startFlow(studentToken);

      assert.equal(store.lineLoginStates.length, 1);
      const result = await complete(studentToken, { code: 'auth-code-1', state: first.state });
      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'LINE_LOGIN_STATE_INVALID');
    });

    it('未登入不能開始連結', async () => {
      const result = await jsonRequest(serverContext.baseUrl, START, { method: 'POST', body: {} });

      assert.equal(result.status, 401);
      assert.equal(store.lineLoginStates.length, 0);
    });

    it('缺少 LINE Login 環境變數時兩個 API 都回 503', async () => {
      const { state } = await startFlow(studentToken);
      env.lineLoginChannelSecret = '';

      const started = await jsonRequest(serverContext.baseUrl, START, {
        method: 'POST', token: studentToken, body: {},
      });
      const completed = await complete(studentToken, { code: 'auth-code-1', state });

      assert.equal(started.status, 503);
      assert.equal(started.body.error.code, 'LINE_LOGIN_NOT_CONFIGURED');
      assert.equal(completed.status, 503);
      assert.equal(completed.body.error.code, 'LINE_LOGIN_NOT_CONFIGURED');
    });
  });

  describe('攻擊情境', () => {
    it('A1 攻擊者把授權網址或回呼網址傳給受害者：雙方都不會被綁定，流程作廢', async () => {
      const attackerFlow = await startFlow(teacherToken);

      const victim = await complete(studentToken, { code: 'victim-code', state: attackerFlow.state });
      assert.equal(victim.status, 403);
      assert.equal(victim.body.error.code, 'LINE_LOGIN_STATE_MISMATCH');

      // 受害者點開後這個 state 已作廢，攻擊者事後拿到回呼網址也完成不了
      const attacker = await complete(teacherToken, { code: 'victim-code', state: attackerFlow.state });
      assert.equal(attacker.status, 400);
      assert.equal(attacker.body.error.code, 'LINE_LOGIN_STATE_INVALID');

      assert.equal(findUser(ids.student).lineUserId, undefined);
      assert.equal(findUser(ids.teacher).lineUserId, null);
      assert.equal(lineCalls('/oauth2/v2.1/token').length, 0);
    });

    it('A2 同一個 state 用第二次失敗', async () => {
      const { state } = await startFlow(studentToken);

      const first = await complete(studentToken, { code: 'auth-code-1', state });
      const second = await complete(studentToken, { code: 'auth-code-2', state });

      assert.equal(first.status, 200);
      assert.equal(second.status, 400);
      assert.equal(second.body.error.code, 'LINE_LOGIN_STATE_INVALID');
    });

    it('A3 state 過期失敗，且不呼叫 LINE', async () => {
      const { state } = await startFlow(studentToken);
      store.lineLoginStates[0].expiresAt = new Date(Date.now() - 1000);

      const result = await complete(studentToken, { code: 'auth-code-1', state });

      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'LINE_LOGIN_STATE_INVALID');
      assert.equal(lineCalls('/oauth2/v2.1/token').length, 0);
      assert.equal(findUser(ids.student).lineUserId, undefined);
    });

    it('A4 state 屬於另一位使用者時失敗', async () => {
      const { state } = await startFlow(teacherToken);

      const result = await complete(studentToken, { code: 'auth-code-1', state });

      assert.equal(result.status, 403);
      assert.equal(result.body.error.code, 'LINE_LOGIN_STATE_MISMATCH');
      assert.equal(findUser(ids.student).lineUserId, undefined);
    });

    it('A4 同一位使用者但屬於另一個登入 session 時失敗', async () => {
      const { state } = await startFlow(studentToken);
      const otherSession = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');

      const result = await complete(otherSession, { code: 'auth-code-1', state });

      assert.equal(result.status, 403);
      assert.equal(result.body.error.code, 'LINE_LOGIN_STATE_MISMATCH');
      assert.equal(findUser(ids.student).lineUserId, undefined);
    });

    it('A5 缺少 state 或 code 回 400', async () => {
      const missingState = await complete(studentToken, { code: 'auth-code-1' });
      const missingCode = await complete(studentToken, { state: 'some-state' });

      assert.equal(missingState.status, 400);
      assert.equal(missingState.body.error.code, 'VALIDATION_ERROR');
      assert.equal(missingCode.status, 400);
      assert.equal(missingCode.body.error.code, 'VALIDATION_ERROR');
    });

    it('A5 偽造 state 失敗', async () => {
      await startFlow(studentToken);

      const result = await complete(studentToken, { code: 'auth-code-1', state: 'forged-state-value' });

      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'LINE_LOGIN_STATE_INVALID');
      assert.equal(findUser(ids.student).lineUserId, undefined);
    });

    it('A6 回呼時沒有登入：回 401 讓頁面提示回原瀏覽器，不建立綁定', async () => {
      const { state } = await startFlow(studentToken);

      const result = await jsonRequest(serverContext.baseUrl, COMPLETE, {
        method: 'POST',
        body: { code: 'auth-code-1', state },
      });

      assert.equal(result.status, 401);
      assert.equal(result.body.error.code, 'UNAUTHORIZED');
      assert.equal(findUser(ids.student).lineUserId, undefined);
      assert.equal(lineCalls('/oauth2/v2.1/token').length, 0);
    });

    for (const [label, buildToken] of [
      ['aud 不符', (nonce) => signIdToken({ nonce, aud: 'another-channel' })],
      ['iss 不符', (nonce) => signIdToken({ nonce, iss: 'https://evil.example' })],
      ['已過期', (nonce) => signIdToken({ nonce }, { expiresIn: -60 })],
      ['nonce 不符', () => signIdToken({ nonce: 'replayed-nonce' })],
      ['簽章金鑰錯誤', (nonce) => signIdToken({ nonce }, { secret: 'wrong-secret' })],
      ['alg 為 none', (nonce) => signUnsecuredIdToken(nonce)],
      ['alg 不是 HS256', (nonce) => signIdToken({ nonce }, { algorithm: 'HS512' })],
    ]) {
      it(`A7 ID token ${label}時失敗`, async () => {
        const { state, nonce } = await startFlow(studentToken);
        line.tokenResponse = () => jsonResponse(200, {
          access_token: ACCESS_TOKEN,
          id_token: buildToken(nonce),
        });

        const result = await complete(studentToken, { code: 'auth-code-1', state });

        assert.equal(result.status, 400);
        assert.equal(result.body.error.code, 'LINE_LOGIN_ID_TOKEN_INVALID');
        assert.equal(findUser(ids.student).lineUserId, undefined);
        assert.equal(lineCalls('/friendship/v1/status').length, 0);
      });
    }

    it('A8 授權碼重複使用時失敗且不建立綁定', async () => {
      line.usedCodes.add('used-code');

      const result = await runFlow(studentToken, { code: 'used-code' });

      assert.equal(result.status, 502);
      assert.equal(result.body.error.code, 'LINE_LOGIN_TOKEN_EXCHANGE_FAILED');
      assert.match(result.body.message, /start again/);
      assert.equal(findUser(ids.student).lineUserId, undefined);
    });

    it('A8 向 LINE 換 token 失敗或連線錯誤時不建立綁定', async () => {
      line.tokenResponse = () => { throw new Error('connect ETIMEDOUT'); };
      const network = await runFlow(studentToken);

      line.tokenResponse = () => jsonResponse(200, { access_token: ACCESS_TOKEN });
      const incomplete = await runFlow(studentToken);

      assert.equal(network.status, 502);
      assert.equal(network.body.error.code, 'LINE_LOGIN_TOKEN_EXCHANGE_FAILED');
      assert.equal(incomplete.status, 502);
      assert.equal(findUser(ids.student).lineUserId, undefined);
    });

    it('A9 LINE 已綁定另一個帳號時拒絕，另一個帳號的綁定不變', async () => {
      findUser(ids.teacher).lineUserId = NEW_LINE_ID;

      const result = await runFlow(studentToken);

      assert.equal(result.status, 409);
      assert.equal(result.body.error.code, 'LINE_ACCOUNT_ALREADY_BOUND');
      assert.equal(findUser(ids.teacher).lineUserId, NEW_LINE_ID);
      assert.equal(findUser(ids.student).lineUserId, undefined);
      assert.equal(lineCalls('/message/push').length, 0);
    });

    it('A9 確認取代也不能搶走別人的 LINE', async () => {
      findUser(ids.student).lineUserId = 'line-student-001';
      findUser(ids.teacher).lineUserId = NEW_LINE_ID;

      const result = await runFlow(studentToken, { startBody: { replaceExisting: true } });

      assert.equal(result.status, 409);
      assert.equal(result.body.error.code, 'LINE_ACCOUNT_ALREADY_BOUND');
      assert.equal(findUser(ids.teacher).lineUserId, NEW_LINE_ID);
      assert.equal(findUser(ids.student).lineUserId, 'line-student-001');
    });

    it('A9 舊綁定碼也不能搶走別人的 LINE', async () => {
      findUser(ids.teacher).lineUserId = NEW_LINE_ID;
      store.lineBindTokens.push({
        _id: 'line-token-takeover',
        token: ids.lineBindTokenText,
        userId: ids.student,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const payload = JSON.stringify({
        events: [{
          type: 'message',
          source: { userId: NEW_LINE_ID },
          message: { type: 'text', text: ids.lineBindTokenText },
        }],
      });

      const result = await postLineWebhook(serverContext.baseUrl, payload, {
        'x-line-signature': createLineSignature(payload),
      });

      assert.equal(result.body.data.results[0].handled, false);
      assert.equal(result.body.data.results[0].reason, 'line_bound_to_other_account');
      assert.equal(findUser(ids.teacher).lineUserId, NEW_LINE_ID);
      assert.equal(findUser(ids.student).lineUserId, undefined);
    });

    it('A10 自己的帳號已綁定別的 LINE，沒有確認時不改變', async () => {
      const student = findUser(ids.student);
      student.lineUserId = 'line-student-001';

      const result = await runFlow(studentToken);

      assert.equal(result.status, 409);
      assert.equal(result.body.error.code, 'LINE_REPLACE_CONFIRMATION_REQUIRED');
      assert.equal(student.lineUserId, 'line-student-001');
    });

    it('A10 確認只能在開始時送出，完成時才帶確認不算數', async () => {
      const student = findUser(ids.student);
      student.lineUserId = 'line-student-001';
      const { state } = await startFlow(studentToken);

      const result = await complete(studentToken, { code: 'auth-code-1', state, replaceExisting: true });

      assert.equal(result.status, 409);
      assert.equal(result.body.error.code, 'LINE_REPLACE_CONFIRMATION_REQUIRED');
      assert.equal(student.lineUserId, 'line-student-001');
    });

    it('A10 舊綁定碼不能略過確認改綁', async () => {
      findUser(ids.student).lineUserId = 'line-student-001';
      store.lineBindTokens.push({
        _id: 'line-token-replace',
        token: ids.lineBindTokenText,
        userId: ids.student,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const payload = JSON.stringify({
        events: [{
          type: 'message',
          source: { userId: NEW_LINE_ID },
          message: { type: 'text', text: ids.lineBindTokenText },
        }],
      });

      const result = await postLineWebhook(serverContext.baseUrl, payload, {
        'x-line-signature': createLineSignature(payload),
      });

      assert.equal(result.body.data.results[0].reason, 'replace_confirmation_required');
      assert.equal(findUser(ids.student).lineUserId, 'line-student-001');
    });

    it('A10 明確確認後才改綁，並清掉舊 LINE 的對話狀態', async () => {
      const student = findUser(ids.student);
      student.lineUserId = 'line-student-001';
      student.activeCourseId = ids.publishedCourse;
      student.lineConversationHistory = [{ role: 'user', content: '舊問題' }];

      const result = await runFlow(studentToken, { startBody: { replaceExisting: true } });

      assert.equal(result.status, 200);
      assert.equal(result.body.data.replaced, true);
      assert.equal(student.lineUserId, NEW_LINE_ID);
      assert.equal(student.activeCourseId, undefined);
      assert.deepEqual(student.lineConversationHistory, []);
    });

    it('A11 解除綁定時帶別人的 userId，只解除呼叫者自己的綁定', async () => {
      findUser(ids.student).lineUserId = 'line-student-001';
      findUser(ids.teacher).lineUserId = NEW_LINE_ID;

      const result = await jsonRequest(serverContext.baseUrl, `/api/v1/line/binding?userId=${ids.teacher}`, {
        method: 'DELETE',
        token: studentToken,
        body: { userId: ids.teacher, lineUserId: NEW_LINE_ID },
      });

      assert.equal(result.status, 200);
      assert.equal(findUser(ids.student).lineUserId, undefined);
      assert.equal(findUser(ids.teacher).lineUserId, NEW_LINE_ID);
    });

    it('A12 兩個請求同時用同一個 state，只有一個成功', async () => {
      const { state } = await startFlow(studentToken);

      const results = await Promise.all([
        complete(studentToken, { code: 'auth-code-1', state }),
        complete(studentToken, { code: 'auth-code-1', state }),
      ]);

      assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
      assert.equal(lineCalls('/oauth2/v2.1/token').length, 1);
      assert.equal(lineCalls('/message/push').length, 1);
    });

    it('A12 舊綁定碼同時送兩次，只有一個成功', async () => {
      store.lineBindTokens.push({
        _id: 'line-token-race',
        token: ids.lineBindTokenText,
        userId: ids.student,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const send = (replyToken) => {
        const payload = JSON.stringify({
          events: [{
            type: 'message',
            replyToken,
            source: { userId: NEW_LINE_ID },
            message: { type: 'text', text: ids.lineBindTokenText },
          }],
        });
        return postLineWebhook(serverContext.baseUrl, payload, {
          'x-line-signature': createLineSignature(payload),
        });
      };
      env.lineChannelAccessToken = '';

      const results = await Promise.all([send('reply-a'), send('reply-b')]);

      assert.deepEqual(
        results.map((result) => result.body.data.results[0].handled).sort(),
        [false, true],
      );
      assert.equal(store.lineBindTokens.length, 0);
    });

    it('A13 同一個 LINE 同時綁到兩個帳號，只有一個成功，另一個依 A9 拒絕', async () => {
      const studentFlow = await startFlow(studentToken);
      const teacherFlow = await startFlow(teacherToken);
      line.tokenResponse = (body) => jsonResponse(200, {
        access_token: ACCESS_TOKEN,
        id_token: signIdToken({ nonce: body.get('code') }),
      });

      const results = await Promise.all([
        complete(studentToken, { code: studentFlow.nonce, state: studentFlow.state }),
        complete(teacherToken, { code: teacherFlow.nonce, state: teacherFlow.state }),
      ]);

      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
      assert.equal(results.find((result) => result.status === 409).body.error.code, 'LINE_ACCOUNT_ALREADY_BOUND');
      assert.equal(boundUsers(NEW_LINE_ID).length, 1);
    });

    it('A13 查詢時還沒衝突、寫入時才撞到 unique index，也當成已被綁定', async () => {
      const { state } = await startFlow(studentToken);
      const realFindOne = User.findOne;
      User.findOne = async (query) => {
        if (query?.lineUserId === NEW_LINE_ID) {
          findUser(ids.teacher).lineUserId = NEW_LINE_ID;
          return null;
        }
        return realFindOne(query);
      };

      try {
        const result = await complete(studentToken, { code: 'auth-code-1', state });

        assert.equal(result.status, 409);
        assert.equal(result.body.error.code, 'LINE_ACCOUNT_ALREADY_BOUND');
        assert.equal(findUser(ids.student).lineUserId, undefined);
        assert.equal(findUser(ids.teacher).lineUserId, NEW_LINE_ID);
      } finally {
        User.findOne = realFindOne;
      }
    });

    for (const [path_, body] of [[START, {}], [COMPLETE, { code: 'auth-code-1', state: 'any-state' }]]) {
      it(`A14 ${path_} 以 cookie 驗證時，缺防偽標頭或來源不可信都拒絕`, async () => {
        const cookie = `ff_session=${studentToken}`;

        const missingHeader = await jsonRequest(serverContext.baseUrl, path_, {
          method: 'POST',
          body,
          headers: { Cookie: cookie, Origin: CSRF_HEADERS.Origin },
        });
        const untrustedOrigin = await jsonRequest(serverContext.baseUrl, path_, {
          method: 'POST',
          body,
          headers: { Cookie: cookie, Origin: 'https://evil.example', 'X-Requested-With': 'FocusFlow' },
        });

        assert.equal(missingHeader.status, 403);
        assert.equal(missingHeader.body.error.code, 'CSRF_REJECTED');
        assert.equal(untrustedOrigin.status, 403);
        assert.equal(untrustedOrigin.body.error.code, 'CSRF_REJECTED');
        assert.equal(store.lineLoginStates.length, 0);
      });
    }

    it('A14 cookie 帶齊防偽標頭時可以完成整個流程', async () => {
      const headers = { ...CSRF_HEADERS, Cookie: `ff_session=${studentToken}` };

      const started = await jsonRequest(serverContext.baseUrl, START, { method: 'POST', body: {}, headers });
      const params = new URL(started.body.data.authorizeUrl).searchParams;
      line.nonce = params.get('nonce');
      const completed = await jsonRequest(serverContext.baseUrl, COMPLETE, {
        method: 'POST',
        body: { code: 'auth-code-1', state: params.get('state') },
        headers,
      });

      assert.equal(started.status, 201);
      assert.equal(completed.status, 200);
      assert.equal(findUser(ids.student).lineUserId, NEW_LINE_ID);
    });

    it('A15 用戶端送來的 LINE ID、顯示名稱、Email 都不作為身分依據', async () => {
      const flow = await startFlow(studentToken, {
        lineUserId: 'Uforged',
        displayName: '別人的名字',
      });

      const result = await complete(studentToken, {
        code: 'auth-code-1',
        state: flow.state,
        lineUserId: 'Uforged',
        sub: 'Uforged',
        displayName: '別人的名字',
        email: 'teacher@focusflow.local',
      });

      assert.equal(result.status, 200);
      assert.equal(findUser(ids.student).lineUserId, NEW_LINE_ID);
      assert.equal(boundUsers('Uforged').length, 0);
    });

    it('A15 沒有任何 controller 從請求讀取 lineUserId', () => {
      const controllersDir = path.join(__dirname, '../src/controllers');
      for (const file of fs.readdirSync(controllersDir)) {
        const source = fs.readFileSync(path.join(controllersDir, file), 'utf8');
        assert.equal(/lineUserId/.test(source), false, `${file} 不應處理 lineUserId`);
      }
    });

    it('A16 完成綁定後資料庫沒有 LINE access token、refresh token', async () => {
      const result = await runFlow(studentToken);
      assert.equal(result.status, 200);

      const persisted = JSON.stringify(store);

      assert.equal(persisted.includes(ACCESS_TOKEN), false);
      assert.equal(persisted.includes(REFRESH_TOKEN), false);
      assert.equal(store.lineLoginStates.length, 0);
    });

    it('A17 部署前已綁定的學生從 LINE 提問，仍對應原本的帳號與課程', async () => {
      const student = findUser(ids.student);
      student.lineUserId = 'line-student-001';
      student.activeCourseId = ids.publishedCourse;
      env.lineChannelAccessToken = '';
      const payload = JSON.stringify({
        events: [{
          type: 'message',
          replyToken: 'reply-legacy-user',
          source: { userId: 'line-student-001' },
          message: { type: 'text', text: 'What does the course say about JWT authentication?' },
        }],
      });

      const result = await postLineWebhook(serverContext.baseUrl, payload, {
        'x-line-signature': createLineSignature(payload),
      });

      assert.equal(result.body.data.results[0].handled, true);
      const question = store.questions.find((item) => item.source === 'line');
      assert.equal(String(question.userId), ids.student);
      assert.equal(String(question.courseId), ids.publishedCourse);
    });

    it('A17 已綁定的學生再連結同一個 LINE：綁定與目前課程都不變，也不重複推播', async () => {
      const student = findUser(ids.student);
      const lineBindAt = new Date('2026-09-01T00:00:00.000Z');
      student.lineUserId = NEW_LINE_ID;
      student.lineBindAt = lineBindAt;
      student.activeCourseId = ids.publishedCourse;

      const result = await runFlow(studentToken);

      assert.equal(result.status, 200);
      assert.equal(result.body.data.alreadyBound, true);
      assert.equal(student.lineBindAt, lineBindAt);
      assert.equal(student.activeCourseId, ids.publishedCourse);
      assert.equal(lineCalls('/message/push').length, 0);
    });

    it('A18 回呼網址只來自伺服器設定，用戶端指定的導回網址不生效', async () => {
      const flow = await startFlow(studentToken, {
        redirectUri: 'https://evil.example/steal',
        redirect_uri: 'https://evil.example/steal',
        returnTo: 'https://evil.example/steal',
      });

      const result = await complete(studentToken, {
        code: 'auth-code-1',
        state: flow.state,
        returnTo: 'https://evil.example/steal',
      });

      assert.equal(flow.params.get('redirect_uri'), CALLBACK_URL);
      assert.equal(
        lineCalls('/oauth2/v2.1/token')[0].options.body.get('redirect_uri'),
        CALLBACK_URL,
      );
      assert.equal(JSON.stringify(result.body).includes('evil.example'), false);
    });

    it('A18 課程須是學生已修的課：已修的課會切換，未修的課不切換但綁定成功', async () => {
      const enrolled = await runFlow(studentToken, { startBody: { courseId: ids.publishedCourse } });
      assert.equal(enrolled.body.data.course.id, ids.publishedCourse);
      assert.equal(String(findUser(ids.student).activeCourseId), ids.publishedCourse);

      const student = findUser(ids.student);
      delete student.lineUserId;
      student.activeCourseId = null;
      const notEnrolled = await runFlow(studentToken, {
        startBody: { courseId: ids.teacherCourse },
        code: 'auth-code-2',
      });

      assert.equal(notEnrolled.status, 200);
      assert.equal(notEnrolled.body.data.course, null);
      assert.equal(student.activeCourseId, null);
      assert.equal(student.lineUserId, NEW_LINE_ID);
    });

    it('A18 課程只看開始時的紀錄，完成時竄改課程參數不生效', async () => {
      const flow = await startFlow(studentToken);

      const result = await complete(studentToken, {
        code: 'auth-code-1',
        state: flow.state,
        courseId: ids.publishedCourse,
      });

      assert.equal(result.body.data.course, null);
      assert.equal(findUser(ids.student).activeCourseId ?? null, null);
    });

    it('A18 課程參數格式錯誤時回 400', async () => {
      const result = await jsonRequest(serverContext.baseUrl, START, {
        method: 'POST',
        token: studentToken,
        body: { courseId: 'not-an-object-id' },
      });

      assert.equal(result.status, 400);
      assert.equal(store.lineLoginStates.length, 0);
    });

    it('A19 錯誤回應與 log 不含 token、secret、授權碼', async () => {
      const authCode = 'super-secret-authorization-code';
      const originalNodeEnv = env.nodeEnv;
      const logged = [];
      const methods = ['log', 'info', 'warn', 'error'];
      const originals = methods.map((method) => console[method]);
      env.nodeEnv = 'development';
      methods.forEach((method) => {
        console[method] = (...args) => logged.push(args.map(String).join(' '));
      });

      try {
        // LINE 的錯誤內容把機密原樣帶回來，也不能外流
        line.tokenResponse = () => jsonResponse(400, {
          error: 'invalid_grant',
          error_description: `${authCode} ${CHANNEL_SECRET} ${ACCESS_TOKEN}`,
        });
        const exchangeFailed = await runFlow(studentToken, { code: authCode });

        const badIdToken = signIdToken({ nonce: 'wrong-nonce' });
        line.tokenResponse = () => jsonResponse(200, { access_token: ACCESS_TOKEN, id_token: badIdToken });
        const idTokenFailed = await runFlow(studentToken, { code: authCode });

        line.tokenResponse = () => { throw new Error(`socket hang up ${authCode}`); };
        const networkFailed = await runFlow(studentToken, { code: authCode });

        const output = JSON.stringify([
          exchangeFailed.body,
          idTokenFailed.body,
          networkFailed.body,
          logged,
        ]);

        assert.equal(exchangeFailed.status, 502);
        assert.equal(idTokenFailed.status, 400);
        assert.equal(networkFailed.status, 502);
        assert.ok(logged.length > 0, '這個測試要真的經過 log');
        for (const secret of [authCode, CHANNEL_SECRET, ACCESS_TOKEN, badIdToken]) {
          assert.equal(output.includes(secret), false);
        }
      } finally {
        env.nodeEnv = originalNodeEnv;
        methods.forEach((method, index) => { console[method] = originals[index]; });
      }
    });
  });
});
