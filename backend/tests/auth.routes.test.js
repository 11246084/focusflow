const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  env,
  ids,
  store,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
} = require('./helpers/backendTestHarness');

describe('auth routes', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(() => {
    resetStore();
  });

  it('logs in and fetches the current user', async () => {
    const loginResult = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'teacher@focusflow.local',
        password: 'Teacher123!',
      },
    });
    const token = loginResult.body.data.token;
    const decodedToken = jwt.verify(token, env.jwtSecret);
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me', {
      token,
    });

    assert.equal(loginResult.status, 200);
    assert.equal(decodedToken.sub, ids.teacher);
    assert.equal(Object.hasOwn(decodedToken, 'role'), false);
    assert.equal(Object.hasOwn(loginResult.body.data.user, 'lineUserId'), false);
    assert.equal(loginResult.body.data.user.lineConversationState, 'idle');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.user.email, 'teacher@focusflow.local');
    assert.equal(Object.hasOwn(result.body.data.user, 'lineUserId'), false);
    assert.equal(result.body.data.user.lineConversationState, 'idle');
    assert.equal(store.usageLogs[0].event, 'login');
  });

  it('rejects missing email or password', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'teacher@focusflow.local' },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects wrong passwords', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'teacher@focusflow.local',
        password: 'WrongPassword!',
      },
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'INVALID_CREDENTIALS');
  });

  it('rejects inactive users', async () => {
    store.users.find((user) => user._id === ids.student).isActive = false;

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'student@focusflow.local',
        password: 'Student123!',
      },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'USER_INACTIVE');
  });

  it('rejects /auth/me without a bearer token', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me');

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'UNAUTHORIZED');
  });

  it('rejects /auth/me with an invalid token', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me', {
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'INVALID_TOKEN');
  });

  it('rejects /auth/me when the token user is no longer available', async () => {
    const token = jwt.sign(
      {
        sub: ids.teacher,
        role: 'teacher',
      },
      env.jwtSecret,
      {
        expiresIn: env.jwtExpiresIn,
      },
    );

    store.users.find((user) => user._id === ids.teacher).isActive = false;

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'UNAUTHORIZED');
  });
});
