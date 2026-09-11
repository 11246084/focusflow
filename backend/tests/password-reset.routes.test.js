const assert = require('node:assert/strict');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
const mailer = require('../src/services/mailer.service');
const {
  store,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
} = require('./helpers/backendTestHarness');

const STUDENT_EMAIL = 'student@focusflow.local';

describe('忘記密碼（Email 驗證碼）', () => {
  let serverContext;
  let sent;

  before(async () => { serverContext = await startServer(); });
  after(async () => { await stopServer(serverContext.server); });
  beforeEach(() => {
    resetStore();
    sent = [];
    mailer.setTransportForTests({ sendMail: async (message) => { sent.push(message); } });
  });
  afterEach(() => mailer.setTransportForTests(null));

  function request(email = STUDENT_EMAIL) {
    return jsonRequest(serverContext.baseUrl, '/api/v1/auth/password-reset/request', {
      method: 'POST', body: { email },
    });
  }

  function confirm(body) {
    return jsonRequest(serverContext.baseUrl, '/api/v1/auth/password-reset/confirm', {
      method: 'POST', body: { email: STUDENT_EMAIL, ...body },
    });
  }

  function login(password) {
    return jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST', body: { email: STUDENT_EMAIL, password, role: 'student' },
    });
  }

  function sentCode() {
    return sent.at(-1).text.match(/(\d{6})/)[1];
  }

  function studentRecord() {
    return store.users.find((item) => item.email === STUDENT_EMAIL);
  }

  it('寄出驗證碼後可用驗證碼設定新密碼並以新密碼登入', async () => {
    const requested = await request();
    const confirmed = await confirm({ code: sentCode(), newPassword: 'ResetPass789!' });

    assert.equal(requested.status, 200);
    assert.equal(sent[0].to, STUDENT_EMAIL);
    assert.equal(confirmed.status, 200);
    assert.equal((await login('ResetPass789!')).status, 200);
    assert.equal((await login('Student123!')).status, 401);
    assert.equal(studentRecord().passwordReset, null);
  });

  it('資料庫只存驗證碼雜湊，不存明碼', async () => {
    await request();

    const reset = studentRecord().passwordReset;
    assert.notEqual(reset.codeHash, sentCode());
    assert.equal(reset.codeHash.includes(sentCode()), false);
  });

  it('不存在的 Email 回相同成功訊息且不寄信', async () => {
    const result = await request('nobody@example.com');

    assert.equal(result.status, 200);
    assert.equal(sent.length, 0);
  });

  it('驗證碼錯誤回 PASSWORD_RESET_CODE_INVALID，錯滿 5 次後正確碼也失效', async () => {
    await request();
    const code = sentCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await confirm({ code: wrong, newPassword: 'ResetPass789!' });
      assert.equal(result.body.error.code, 'PASSWORD_RESET_CODE_INVALID');
    }
    const locked = await confirm({ code, newPassword: 'ResetPass789!' });

    assert.equal(locked.status, 400);
    assert.equal(locked.body.error.code, 'PASSWORD_RESET_CODE_INVALID');
  });

  it('驗證碼過期後不能使用', async () => {
    await request();
    studentRecord().passwordReset.expiresAt = new Date(Date.now() - 1000);

    const result = await confirm({ code: sentCode(), newPassword: 'ResetPass789!' });

    assert.equal(result.body.error.code, 'PASSWORD_RESET_CODE_INVALID');
  });

  it('驗證碼使用過一次後就失效', async () => {
    await request();
    const code = sentCode();
    await confirm({ code, newPassword: 'ResetPass789!' });

    const reused = await confirm({ code, newPassword: 'AnotherPass1!' });

    assert.equal(reused.body.error.code, 'PASSWORD_RESET_CODE_INVALID');
  });

  it('60 秒內重複申請不會重寄', async () => {
    await request();
    await request();

    assert.equal(sent.length, 1);
  });

  it('新密碼少於 8 碼時回驗證錯誤', async () => {
    await request();

    const result = await confirm({ code: sentCode(), newPassword: 'short' });

    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  });

  it('未設定寄信帳號時回 503 PASSWORD_RESET_UNAVAILABLE', async () => {
    mailer.setTransportForTests(null);

    const result = await request();

    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'PASSWORD_RESET_UNAVAILABLE');
  });

  it('寄信失敗時回 502 且驗證碼不留在資料庫', async () => {
    mailer.setTransportForTests({ sendMail: async () => { throw new Error('smtp down'); } });

    const result = await request();

    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, 'PASSWORD_RESET_EMAIL_FAILED');
    assert.equal(studentRecord().passwordReset, null);
  });
});
