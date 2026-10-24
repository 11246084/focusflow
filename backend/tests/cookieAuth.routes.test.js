const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { describe, it, before, after, beforeEach } = require('node:test');
const { env, ids, store, resetStore, startServer, stopServer, jsonRequest, loginAs, postLineWebhook, createLineSignature } = require('./helpers/backendTestHarness');
const tokens = require('../src/services/authTokens.service');
const cookie = require('../src/utils/authCookies');
const mailer = require('../src/services/mailer.service');
const pendingService = require('../src/services/pendingVerification.service');
const { assertStepUp } = require('../src/services/stepUp.service');

describe('cookie authentication decisions 1–25', () => {
  let server; let sent;
  const origin = 'http://localhost:5173';
  const browser = { Origin: origin, 'X-Requested-With': 'FocusFlow' };
  const credentials = (role = 'student') => ({ email: `${role}@focusflow.local`, password: `${role[0].toUpperCase()}${role.slice(1)}123!`, role });
  const setCookies = (result) => result.response.headers.getSetCookie();
  const cookieFor = (result, kind) => setCookies(result).find((value) => value.startsWith(`${cookie.cookieName(kind)}=`) && value.split(';')[0] !== `${cookie.cookieName(kind)}=`)?.split(';')[0];
  const request = (path, options) => jsonRequest(server.baseUrl, `/api/v1${path}`, options);
  const session = (role = 'student') => request('/auth/session', { method: 'POST', headers: browser, body: credentials(role) });
  before(async () => { server = await startServer(); });
  after(async () => { env.nodeEnv = 'test'; mailer.setTransportForTests(null); await stopServer(server.server); });
  beforeEach(() => {
    resetStore(); env.nodeEnv = 'test'; env.adminEmail2faEnabled = true; env.emailVerificationEnabled = true;
    sent = []; mailer.setTransportForTests({ sendMail: async (mail) => { sent.push(mail); } });
  });
  function production() {
    env.nodeEnv = 'production';
    for (const user of store.users) Object.assign(user, { tokenVersion: 0, mustChangePassword: false, emailVerifiedAt: null });
  }
  function lastCode() { return sent.at(-1).subject.match(/^\d{6}/)[0]; }

  it('cookie options, role expiry, millisecond conversion and setter origin boundary', async () => {
    assert.equal(cookie.cookieMaxAge(1000, 100), 999900);
    assert.throws(() => cookie.setAuthCookie({ headers: {} }, {}, 'session', 'value', 1000), { code: 'CSRF_REJECTED' });
    for (const role of ['admin', 'teacher', 'student']) {
      const result = await session(role);
      assert.equal(result.status, 200);
      assert.equal(result.body.data.token, undefined);
      const header = setCookies(result).find((value) => value.startsWith('ff_session='));
      assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Strict/); assert.match(header, /Path=\//);
      assert.doesNotMatch(header, /Secure|Domain=/);
      const payload = tokens.verifyToken(header.split(';')[0].split('=')[1]);
      assert.equal(payload.exp - payload.iat, role === 'admin' ? 43200 : 604800);
      assert.equal(new Date(store.authSessions.at(-1).expiresAt).getTime(), payload.exp * 1000);
      assert.equal(result.response.headers.get('cache-control'), 'no-store');
    }
  });
  it('script login rejects every browser signal and has no Set-Cookie', async () => {
    for (const headers of [{ Origin: origin }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'none' }, { 'Sec-Fetch-Dest': 'empty' }]) {
      assert.equal((await request('/auth/login', { method: 'POST', headers, body: credentials() })).status, 403);
    }
    // Native Node fetch supplies Sec-Fetch-Mode: cors automatically.
    const result = await request('/auth/login', { method: 'POST', body: credentials() });
    assert.ok(result.body.data.token); assert.equal(setCookies(result).length, 0);
  });
  it('CSRF origin/header/cookie/Bearer matrix, preflight and no fallback', async () => {
    const current = await session(); const sessionCookie = cookieFor(current, 'session');
    const token = sessionCookie.split('=')[1];
    for (const Origin of [undefined, 'null', 'https://evil.ntub.edu.tw', origin]) {
      for (const custom of [false, true]) {
        const headers = { Cookie: sessionCookie, ...(Origin ? { Origin } : {}), ...(custom ? { 'X-Requested-With': 'FocusFlow' } : {}) };
        const result = await request('/auth/me', { method: 'PATCH', headers, body: { name: 'Updated' } });
        assert.equal(result.status, Origin === origin && custom ? 200 : 403);
        const bearer = await request('/auth/me', { method: 'PATCH', token, headers, body: { name: 'Bearer' } });
        assert.equal(bearer.status, 200);
      }
    }
    assert.equal((await request('/auth/me', { headers: { Cookie: sessionCookie, Authorization: 'Bearer invalid' } })).status, 401);
    assert.equal((await request('/auth/me', { method: 'OPTIONS', headers: { Origin: origin } })).status, 204);
  });
  it('logout immediately revokes, is idempotent, and Bearer never clears cookie sessions', async () => {
    const first = await session(); const second = await session();
    const a = cookieFor(first, 'session'); const b = cookieFor(second, 'session');
    const result = await request('/auth/session', { method: 'DELETE', token: a.split('=')[1], headers: { Cookie: b } });
    assert.equal(result.status, 204); assert.equal(setCookies(result).length, 0);
    assert.equal((await request('/auth/me', { headers: { Cookie: a } })).status, 401);
    assert.equal((await request('/auth/me', { headers: { Cookie: b } })).status, 200);
    for (let n = 0; n < 2; n += 1) {
      const out = await request('/auth/session', { method: 'DELETE', headers: { ...browser, Cookie: b } });
      assert.equal(out.status, 204); assert.equal(setCookies(out).length, 2);
      assert.ok(setCookies(out).every((value) => /Expires=Thu, 01 Jan 1970/.test(value)));
    }
  });
  it('old JWT, missing claims and expired persisted sessions are rejected', async () => {
    const token = jwt.sign({ sub: ids.student }, env.jwtSecret);
    assert.equal((await request('/auth/me', { token })).body.error.code, 'INVALID_TOKEN');
    const current = await session(); const value = cookieFor(current, 'session');
    store.authSessions[0].expiresAt = new Date(0);
    assert.equal((await request('/auth/me', { headers: { Cookie: value } })).status, 401);
  });
  it('storage write/read/delete failures fail closed, including version-before-delete', async () => {
    store.nextAuthSessionWriteError = new Error('offline');
    assert.equal((await session()).status, 503); assert.equal(store.authSessions.length, 0);
    const value = cookieFor(await session(), 'session');
    store.nextAuthSessionReadError = new Error('offline');
    assert.equal((await request('/auth/me', { headers: { Cookie: value } })).status, 503);
    store.nextAuthSessionDeleteError = new Error('offline');
    assert.equal((await request('/auth/logout-all', { method: 'POST', headers: { ...browser, Cookie: value } })).status, 503);
    assert.equal(store.users.find((user) => user._id === ids.student).tokenVersion, 1);
    assert.equal((await request('/auth/me', { headers: { Cookie: value } })).status, 401);
  });
  it('password rotation creates a new sid, increments version and deletes other sessions', async () => {
    const old = cookieFor(await session(), 'session'); await session();
    const changed = await request('/auth/me/password', { method: 'PATCH', headers: { ...browser, Cookie: old },
      body: { currentPassword: 'Student123!', newPassword: 'NewStudent123!' } });
    assert.equal(changed.status, 200); const current = cookieFor(changed, 'session'); assert.notEqual(current, old);
    assert.equal(store.authSessions.length, 1);
    assert.equal((await request('/auth/me', { headers: { Cookie: old } })).status, 401);
    assert.equal((await request('/auth/me', { headers: { Cookie: current } })).status, 200);
  });
  it('concurrent issuance settles at twenty sessions, and user agent is bounded', async () => {
    const user = store.users.find((item) => item._id === ids.student);
    await Promise.all(Array.from({ length: 50 }, () => tokens.issueSession(user, { userAgent: 'a'.repeat(300) })));
    assert.ok(store.authSessions.length <= 20); assert.equal(store.authSessions[0].userAgent.length, 200);
    assert.deepEqual(Object.keys(store.authSessions[0]).sort(), ['_id', 'userId', 'createdAt', 'expiresAt', 'userAgent'].sort());
  });
  it('production pending verification is single use and cannot authenticate normal routes', async () => {
    production(); const login = await session(); assert.equal(login.body.data.purpose, 'email_verify');
    const value = cookieFor(login, 'pending');
    assert.match(value, /^__Host-ff_pending=/); assert.match(setCookies(login).at(-1), /Secure/);
    assert.equal((await request('/auth/me', { token: value.split('=')[1] })).status, 401);
    const code = lastCode();
    const responses = await Promise.all(Array.from({ length: 4 }, () => request('/auth/pending/verify', { method: 'POST', headers: { ...browser, Cookie: value }, body: { code } })));
    assert.equal(responses.filter((result) => result.status === 200).length, 1);
    assert.equal(responses.filter((result) => cookieFor(result, 'session')).length, 1);
  });
  it('legacy admin must verify then change password, without migration', async () => {
    production(); const user = store.users.find((item) => item._id === ids.admin);
    delete user.mustChangePassword; delete user.tokenVersion;
    const login = await session('admin'); assert.equal(login.body.data.purpose, 'first_login');
    const value = cookieFor(login, 'pending');
    const premature = await request('/auth/pending/password', { method: 'POST', headers: { ...browser, Cookie: value }, body: { newPassword: 'NewAdmin123!' } });
    assert.equal(premature.status, 401);
    const verified = await request('/auth/pending/verify', { method: 'POST', headers: { ...browser, Cookie: value }, body: { code: lastCode() } });
    assert.equal(verified.body.data.codeVerified, true); assert.equal(cookieFor(verified, 'session'), undefined);
    const next = cookieFor(verified, 'pending'); assert.notEqual(next, value);
    const completed = await request('/auth/pending/password', { method: 'POST', headers: { ...browser, Cookie: next }, body: { newPassword: 'NewAdmin123!', trustDevice: true } });
    assert.equal(completed.status, 200); assert.ok(cookieFor(completed, 'session'));
    assert.equal(user.mustChangePassword, false); assert.equal(user.tokenVersion, 1);
    assert.ok(user.emailVerifiedAt);
  });
  it('pending attempts, replacement jti, resend budget and account pause survive login', async () => {
    production(); const login = await session('admin'); const value = cookieFor(login, 'pending');
    const originalExpiry = store.users.find((item) => item._id === ids.admin).pendingVerification.expiresAt;
    await request('/auth/pending/verify', { method: 'POST', headers: { ...browser, Cookie: value }, body: { code: 'wrong!' } });
    for (let i = 0; i < 5; i += 1) {
      const resend = await request('/auth/pending/resend', { method: 'POST', headers: { ...browser, Cookie: value } });
      assert.equal(resend.status, 200); assert.equal(resend.body.data.remainingResends, 4 - i);
    }
    assert.equal(new Date(store.users.find((item) => item._id === ids.admin).pendingVerification.expiresAt).getTime(), new Date(originalExpiry).getTime());
    assert.equal((await session('admin')).status, 429);
    const confirmed = await request('/auth/pending/verify', { method: 'POST', headers: { ...browser, Cookie: value }, body: { code: lastCode() } });
    assert.equal(confirmed.status, 200);
  });
  it('five wrong codes invalidate pending and mail errors never issue sessions', async () => {
    production(); const login = await session(); const value = cookieFor(login, 'pending');
    const wrong = lastCode() === '000000' ? '999999' : '000000';
    for (let i = 0; i < 5; i += 1) assert.equal((await request('/auth/pending/verify', { method: 'POST', headers: { ...browser, Cookie: value }, body: { code: wrong } })).status, 401);
    assert.equal(store.users.find((item) => item._id === ids.student).pendingVerification, null);
    mailer.setTransportForTests({ sendMail: async () => { throw new Error('sensitive SMTP failure'); } });
    const failed = await session('admin'); assert.equal(failed.status, 502); assert.equal(cookieFor(failed, 'session'), undefined);
    assert.equal(JSON.stringify(failed.body).includes('sensitive'), false);
  });
  it('trusted device uses opaque cookie, caps at five and logout-all invalidates it', async () => {
    production(); let trusted;
    for (let i = 0; i < 6; i += 1) {
      const login = await session('admin');
      const verified = await request('/auth/pending/verify', { method: 'POST', headers: { ...browser, Cookie: cookieFor(login, 'pending') }, body: { code: lastCode(), trustDevice: true } });
      assert.equal(verified.status, 200); trusted = cookieFor(verified, 'trusted');
    }
    const user = store.users.find((item) => item._id === ids.admin);
    assert.equal(user.trustedDevices.length, 5); assert.notEqual(user.trustedDevices.at(-1).hash, trusted.split('=')[1]);
    const login = await request('/auth/session', { method: 'POST', headers: { ...browser, Cookie: trusted }, body: credentials('admin') });
    assert.equal(login.body.data.requiresVerification, undefined); const current = cookieFor(login, 'session');
    assert.equal((await request('/auth/logout-all', { method: 'POST', headers: { ...browser, Cookie: current } })).status, 204);
    assert.equal(user.trustedDevices.length, 0);
    assert.equal((await request('/auth/session', { method: 'POST', headers: { ...browser, Cookie: trusted }, body: credentials('admin') })).body.data.purpose, 'admin_2fa');
    assert.ok(store.adminAuditLogs.some((item) => item.event === 'trusted_device_use'));
    assert.equal(JSON.stringify(store.adminAuditLogs).includes(trusted.split('=')[1]), false);
  });
  it('step-up binds session and scope, caps expiry, rejects Bearer and locks independently', async () => {
    const login = await session('admin'); const value = cookieFor(login, 'session');
    const sessionToken = value.split('=')[1];
    assert.equal((await request('/auth/step-up', { method: 'POST', token: sessionToken, body: { password: 'Admin123!' } })).status, 403);
    const step = await request('/auth/step-up', { method: 'POST', headers: { ...browser, Cookie: value }, body: { password: 'Admin123!' } });
    assert.equal(step.status, 204); const stepCookie = cookieFor(step, 'stepup');
    const claim = tokens.verifyToken(stepCookie.split('=')[1]); assert.ok(claim.exp <= tokens.verifyToken(sessionToken).exp);
    const account = store.users.find((item) => item._id === ids.admin);
    assert.doesNotThrow(() => assertStepUp({ headers: { ...Object.fromEntries(Object.entries(browser).map(([k,v]) => [k.toLowerCase(),v])), cookie: `${value}; ${stepCookie}` }, auth: { account, payload: tokens.verifyToken(sessionToken) } }));
    const promoted = await request(`/admin/users/${ids.student}`, { method: 'PATCH', headers: { ...browser, Cookie: `${value}; ${stepCookie}` }, body: { role: 'admin' } });
    assert.equal(promoted.status, 200);
    for (let i = 0; i < 5; i += 1) await request('/auth/step-up', { method: 'POST', headers: { ...browser, Cookie: value }, body: { password: 'wrong' } });
    assert.equal((await request('/auth/step-up', { method: 'POST', headers: { ...browser, Cookie: value }, body: { password: 'Admin123!' } })).status, 429);
    assert.equal((await session('admin')).status, 200);
  });
  it('strict admin updates, self protection, disabling and demotion revoke sessions', async () => {
    const token = await loginAs(server.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');
    assert.equal((await request(`/admin/users/${ids.student}`, { method: 'PATCH', token, body: { isActive: 'false' } })).status, 400);
    assert.equal((await request(`/admin/users/${ids.admin}`, { method: 'PATCH', token, body: { isActive: false } })).status, 400);
    const current = cookieFor(await session(), 'session');
    assert.equal((await request(`/admin/users/${ids.student}`, { method: 'PATCH', token, body: { isActive: false } })).status, 200);
    assert.equal((await request('/auth/me', { headers: { Cookie: current } })).status, 401);
  });
  it('password policy and HTML/text mail apply to password reset too', async () => {
    const denied = await request('/auth/register', { method: 'POST', headers: browser,
      body: { name: 'Test', email: 'example@example.com', password: '12345678' } });
    assert.equal(denied.status, 400);
    await request('/auth/password-reset/request', { method: 'POST', body: { email: 'student@focusflow.local' } });
    const mail = sent.at(-1); assert.ok(mail.html.includes('<table')); assert.ok(mail.text.includes('如果不是你本人操作'));
    assert.doesNotMatch(mail.html, /<img|https?:\/\//);
    const same = await request('/auth/password-reset/confirm', { method: 'POST', body: { email: 'student@focusflow.local', code: lastCode(), newPassword: 'Student123!' } });
    assert.equal(same.status, 400);
  });
  it('非正式環境略過寄信，但匯入帳號仍須先設定新密碼', async () => {
    store.users.find((user) => user._id === ids.student).mustChangePassword = true;
    const login = await session();
    assert.equal(login.body.data.purpose, 'first_login');
    assert.equal(login.body.data.codeVerified, true); assert.equal(sent.length, 0);
    assert.equal(cookieFor(login, 'session'), undefined);
    const changed = await request('/auth/pending/password', { method: 'POST', headers: { ...browser, Cookie: cookieFor(login, 'pending') }, body: { newPassword: 'FreshStudent123!' } });
    assert.equal(changed.status, 200); assert.ok(cookieFor(changed, 'session'));
  });
  it('重新登入換 jti、取消受 CSRF 保護，腳本需驗證時不發 pending', async () => {
    production();
    const script = await request('/auth/login', { method: 'POST', body: credentials('admin') });
    assert.equal(script.status, 403); assert.equal(script.body.error.code, 'VERIFICATION_REQUIRED');
    assert.equal(setCookies(script).length, 0);
    const old = cookieFor(await session('admin'), 'pending');
    const next = cookieFor(await session('admin'), 'pending');
    assert.notEqual(old, next);
    assert.equal((await request('/auth/pending/verify', { method: 'POST', headers: { ...browser, Cookie: old }, body: { code: lastCode() } })).status, 401);
    assert.equal((await request('/auth/pending', { method: 'DELETE', headers: { Cookie: next } })).status, 403);
    assert.equal((await request('/auth/pending', { method: 'DELETE', headers: { ...browser, Cookie: next } })).status, 204);
    assert.equal(store.users.find((user) => user._id === ids.admin).pendingVerification, null);
  });
  it('step-up 不可跨 session、版本或使用者，期限不超過短 session', async () => {
    const account = store.users.find((user) => user._id === ids.admin);
    const session = await tokens.issueSession(account, { expiresIn: 30 });
    const payload = tokens.verifyToken(session.token);
    const step = tokens.signStepUpToken(account, payload);
    assert.ok(tokens.verifyToken(step).exp <= payload.exp);
    const req = { headers: { origin, 'x-requested-with': 'FocusFlow', cookie: `ff_stepup=${step}` }, auth: { account, payload } };
    assert.doesNotThrow(() => assertStepUp(req));
    for (const badPayload of [{ ...payload, sid: 'a'.repeat(32) }, { ...payload, exp: payload.exp - 1 }]) {
      assert.throws(() => assertStepUp({ ...req, auth: { account, payload: badPayload } }), { code: 'STEP_UP_REQUIRED' });
    }
    for (const badAccount of [{ ...account, _id: ids.student }, { ...account, tokenVersion: 1 }, { ...account, role: 'student' }]) {
      assert.throws(() => assertStepUp({ ...req, auth: { account: badAccount, payload } }), { code: 'STEP_UP_REQUIRED' });
    }
  });
  it('目前角色來自 User，管理員降級他人會撤銷該帳號 session', async () => {
    const teacher = cookieFor(await session('teacher'), 'session');
    const actor = await loginAs(server.baseUrl, 'admin@focusflow.local', 'Admin123!', 'admin');
    const result = await request(`/admin/users/${ids.teacher}`, { method: 'PATCH', token: actor, body: { role: 'student' } });
    assert.equal(result.status, 200);
    assert.equal(store.users.find((user) => user._id === ids.teacher).tokenVersion, 1);
    assert.equal((await request('/auth/me', { headers: { Cookie: teacher } })).status, 401);
    const student = cookieFor(await session(), 'session');
    assert.equal((await request('/stats/teacher', { headers: { Cookie: student } })).status, 403);
  });
  it('忘記密碼重寄 5 次後暫停寄信，既有未過期驗證碼仍可使用', async () => {
    const body = { email: 'student@focusflow.local' };
    for (let n = 0; n <= 5; n += 1) {
      const result = await request('/auth/password-reset/request', { method: 'POST', body });
      assert.equal(result.status, 200); assert.equal(result.body.data.remainingResends, 5 - n);
    }
    assert.equal((await request('/auth/password-reset/request', { method: 'POST', body })).status, 429);
    const confirmed = await request('/auth/password-reset/confirm', { method: 'POST', body: { ...body, code: lastCode(), newPassword: 'ResetStudent123!' } });
    assert.equal(confirmed.status, 200); assert.equal(setCookies(confirmed).length, 0);
  });
  it('LINE 與 internal webhook 忽略 cookie，沿用自己的驗證', async () => {
    const foreign = { Origin: 'https://foreign.example.invalid', Cookie: 'ff_session=invalid' };
    const lineBody = { events: [] };
    const line = await postLineWebhook(server.baseUrl, lineBody, {
      ...foreign, 'X-Line-Signature': createLineSignature(JSON.stringify(lineBody)),
    });
    assert.equal(line.status, 200);
    const video = store.videos.find((item) => item._id === ids.teacherVideo);
    video.processing = { status: 'queued', attemptCount: 0 };
    const internal = await request(`/internal/videos/${ids.teacherVideo}/processing/start`, {
      method: 'POST', headers: { ...foreign, 'X-Processing-Secret': env.processingWebhookSecret }, body: {},
    });
    assert.equal(internal.status, 200);
  });
  it('只在實際升為管理員時要求 step-up，原有管理員改姓名不需重驗', async () => {
    const value = cookieFor(await session('admin'), 'session');
    const headers = { ...browser, Cookie: value };
    const renamed = await request(`/admin/users/${ids.admin}`, { method: 'PATCH', headers,
      body: { name: 'Renamed admin', role: 'admin', isActive: true } });
    assert.equal(renamed.status, 200);
    const promotion = await request(`/admin/users/${ids.student}`, { method: 'PATCH', headers,
      body: { name: 'Student', role: 'admin', isActive: true } });
    assert.equal(promotion.status, 403); assert.equal(promotion.body.error.code, 'STEP_UP_REQUIRED');
  });
});
