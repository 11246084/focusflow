const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
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

  const loginCases = [
    {
      role: 'student',
      email: 'student@focusflow.local',
      password: 'Student123!',
      id: ids.student,
    },
    {
      role: 'teacher',
      email: 'teacher@focusflow.local',
      password: 'Teacher123!',
      id: ids.teacher,
    },
    {
      role: 'admin',
      email: 'admin@focusflow.local',
      password: 'Admin123!',
      id: ids.admin,
    },
  ];

  for (const loginCase of loginCases) {
    it(`${loginCase.role} 使用正確帳號類型可登入`, async () => {
      const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
        method: 'POST',
        body: {
          email: loginCase.email,
          password: loginCase.password,
          role: loginCase.role,
        },
      });

      assert.equal(result.status, 200);
      assert.equal(result.body.message, 'Login successful.');
      assert.equal(result.body.data.user.role, loginCase.role);
      assert.equal(Object.hasOwn(result.body.data.user, 'passwordHash'), false);
      const decodedToken = jwt.verify(result.body.data.token, env.jwtSecret);
      assert.equal(decodedToken.sub, loginCase.id);
      assert.equal(Object.hasOwn(decodedToken, 'role'), false);
      assert.equal(store.usageLogs.length, 1);
      assert.equal(store.usageLogs[0].event, 'login');
    });
  }

  for (const loginCase of loginCases) {
    for (const requestedRole of ['student', 'teacher', 'admin']) {
      if (requestedRole === loginCase.role) continue;

      it(`${loginCase.role} 帳號選擇 ${requestedRole} 時拒絕跨身分登入`, async () => {
        const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
          method: 'POST',
          body: {
            email: loginCase.email,
            password: loginCase.password,
            role: requestedRole,
          },
        });

        assert.equal(result.status, 403);
        assert.equal(result.body.error.code, 'ROLE_MISMATCH');
        assert.equal(result.body.message, 'Account type does not match the selected role.');
        assert.equal(Object.hasOwn(result.body, 'data'), false);
        assert.equal(store.usageLogs.length, 0);
      });
    }
  }

  it('登入缺少 role 時回傳明確驗證錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'teacher@focusflow.local',
        password: 'Teacher123!',
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'Email, password, and role are required.');
    assert.equal(store.usageLogs.length, 0);
  });

  it('登入 role 不合法時回傳明確驗證錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'teacher@focusflow.local',
        password: 'Teacher123!',
        role: 'owner',
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'Role must be one of: student, teacher, admin.');
    assert.equal(store.usageLogs.length, 0);
  });

  it('登入 role 會 trim 並轉為 lowercase 後接受', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: '  TEACHER@FOCUSFLOW.LOCAL ',
        password: 'Teacher123!',
        role: '  TeAcHeR ',
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.user.email, 'teacher@focusflow.local');
    assert.equal(result.body.data.user.role, 'teacher');
    assert.equal(store.usageLogs.length, 1);
  });

  it('登入缺少 email 或 password 時回傳明確驗證錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'teacher@focusflow.local',
        role: 'teacher',
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'Email, password, and role are required.');
  });

  it('登入 email 只有空白時回傳必填驗證錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: '   ',
        password: 'Teacher123!',
        role: 'teacher',
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'Email, password, and role are required.');
    assert.equal(store.usageLogs.length, 0);
  });

  const nonStringLoginCases = [
    { field: 'email', value: { address: 'teacher@focusflow.local' } },
    { field: 'password', value: 12345678 },
    { field: 'role', value: ['teacher'] },
  ];

  for (const nonStringCase of nonStringLoginCases) {
    it(`登入 ${nonStringCase.field} 不是字串時拒絕請求`, async () => {
      const body = {
        email: 'teacher@focusflow.local',
        password: 'Teacher123!',
        role: 'teacher',
        [nonStringCase.field]: nonStringCase.value,
      };
      const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
        method: 'POST',
        body,
      });

      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
      assert.equal(result.body.message, 'Email, password, and role must be strings.');
      assert.equal(store.usageLogs.length, 0);
    });
  }

  it('密碼錯誤時拒絕登入且不記錄 LOGIN usage', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'teacher@focusflow.local',
        password: 'WrongPassword!',
        role: 'teacher',
      },
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(result.body.message, 'Invalid email or password.');
    assert.equal(store.usageLogs.length, 0);
  });

  it('密碼與 role 都錯誤時固定先回 INVALID_CREDENTIALS', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'teacher@focusflow.local',
        password: 'WrongPassword!',
        role: 'student',
      },
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(result.body.message, 'Invalid email or password.');
    assert.equal(store.usageLogs.length, 0);
  });

  it('停用帳號使用正確密碼與 role 時拒絕登入', async () => {
    store.users.find((user) => user._id === ids.student).isActive = false;

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'student@focusflow.local',
        password: 'Student123!',
        role: 'student',
      },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'USER_INACTIVE');
    assert.equal(result.body.message, 'User is inactive.');
    assert.equal(store.usageLogs.length, 0);
  });

  it('停用帳號且 role 錯誤時固定先回 USER_INACTIVE', async () => {
    store.users.find((user) => user._id === ids.student).isActive = false;

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'student@focusflow.local',
        password: 'Student123!',
        role: 'teacher',
      },
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'USER_INACTIVE');
    assert.equal(result.body.message, 'User is inactive.');
    assert.equal(store.usageLogs.length, 0);
  });

  it('登入後可取得目前使用者，且敏感欄位不外洩', async () => {
    const loginResult = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'teacher@focusflow.local',
        password: 'Teacher123!',
        role: 'teacher',
      },
    });
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me', {
      token: loginResult.body.data.token,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.user.email, 'teacher@focusflow.local');
    assert.equal(Object.hasOwn(result.body.data.user, 'passwordHash'), false);
    assert.equal(Object.hasOwn(result.body.data.user, 'lineUserId'), false);
    assert.equal(result.body.data.user.lineConversationState, 'idle');
  });

  it('未帶 bearer token 時拒絕 /auth/me', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me');

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'UNAUTHORIZED');
  });

  it('token 無效時拒絕 /auth/me', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me', {
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'INVALID_TOKEN');
  });

  it('token 對應帳號已停用時拒絕 /auth/me', async () => {
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

  for (const role of ['student', 'teacher']) {
    it(`${role} 可註冊，email 會正規化且密碼只儲存雜湊`, async () => {
      const email = `  NEW.${role.toUpperCase()}@Example.COM `;
      const password = `${role}Pass123!`;
      const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
        method: 'POST',
        body: {
          name: `  New ${role}  `,
          email,
          password,
          role,
        },
      });

      assert.equal(result.status, 201);
      assert.equal(result.body.message, 'Registration successful.');
      assert.equal(result.body.data.user.name, `New ${role}`);
      assert.equal(result.body.data.user.email, `new.${role}@example.com`);
      assert.equal(result.body.data.user.role, role);
      assert.equal(Object.hasOwn(result.body.data.user, 'passwordHash'), false);
      assert.equal(JSON.stringify(result.body).includes('passwordHash'), false);

      const storedUser = store.users.find((user) => user.email === `new.${role}@example.com`);
      assert.ok(storedUser);
      assert.notEqual(storedUser.passwordHash, password);
      assert.equal(await bcrypt.compare(password, storedUser.passwordHash), true);

      const decodedToken = jwt.verify(result.body.data.token, env.jwtSecret);
      assert.equal(decodedToken.sub, storedUser._id);
      assert.equal(Object.hasOwn(decodedToken, 'role'), false);
      assert.equal(store.usageLogs.length, 1);
      assert.equal(store.usageLogs[0].metadata.via, 'register');
    });
  }

  it('兩個不同 email 的註冊資料都不會產生 lineUserId null', async () => {
    for (const suffix of ['one', 'two']) {
      const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
        method: 'POST',
        body: {
          name: `No LINE ${suffix}`,
          email: `no-line-${suffix}@example.com`,
          password: 'Password123!',
          role: 'student',
        },
      });

      assert.equal(result.status, 201);
    }

    const registeredUsers = store.users.filter((user) => user.email.startsWith('no-line-'));
    assert.equal(registeredUsers.length, 2);
    for (const user of registeredUsers) {
      assert.equal(Object.hasOwn(user, 'lineUserId'), false);
    }
  });

  it('註冊空 body 時沿用欄位驗證回傳明確錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'Name is required.');
    assert.equal(store.usageLogs.length, 0);
  });

  it('註冊 body 為 array 時不解構非物件 payload，回傳欄位驗證錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: [{
        name: 'Array User',
        email: 'array@example.com',
        password: 'Password123!',
        role: 'student',
      }],
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'Name is required.');
    assert.equal(store.users.some((user) => user.email === 'array@example.com'), false);
    assert.equal(store.usageLogs.length, 0);
  });

  it('註冊 non-JSON scalar body 時回傳欄位驗證錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: 'not-an-object',
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'Name is required.');
    assert.equal(store.usageLogs.length, 0);
  });

  it('註冊缺少 name 時回傳明確驗證錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        email: 'new@example.com',
        password: 'Password123!',
        role: 'student',
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'Name is required.');
  });

  it('註冊缺少 email 時回傳明確驗證錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'New Student',
        password: 'Password123!',
        role: 'student',
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'A valid email is required.');
  });

  it('註冊 email 格式錯誤時回傳明確驗證錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'New Student',
        email: 'not-an-email',
        password: 'Password123!',
        role: 'student',
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'A valid email is required.');
  });

  it('註冊密碼少於八字元時回傳明確驗證錯誤', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'New Student',
        email: 'new@example.com',
        password: 'short',
        role: 'student',
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'Password must be at least 8 characters.');
  });

  const nonStringRegisterCases = [
    {
      field: 'name',
      value: 123,
      message: 'Name is required.',
    },
    {
      field: 'email',
      value: { address: 'new@example.com' },
      message: 'A valid email is required.',
    },
    {
      field: 'password',
      value: 12345678,
      message: 'Password must be at least 8 characters.',
    },
    {
      field: 'role',
      value: 123,
      message: 'Role is not open for self-registration.',
    },
  ];

  for (const nonStringCase of nonStringRegisterCases) {
    it(`註冊 ${nonStringCase.field} 不是字串時拒絕請求`, async () => {
      const body = {
        name: 'New Student',
        email: 'new@example.com',
        password: 'Password123!',
        role: 'student',
        [nonStringCase.field]: nonStringCase.value,
      };
      const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
        method: 'POST',
        body,
      });

      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
      assert.equal(result.body.message, nonStringCase.message);
      assert.equal(store.users.some((user) => user.email === 'new@example.com'), false);
    });
  }

  it('admin 不可透過自助註冊建立', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'New Admin',
        email: 'new-admin@example.com',
        password: 'Password123!',
        role: 'admin',
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(result.body.message, 'Role is not open for self-registration.');
    assert.equal(store.users.some((user) => user.email === 'new-admin@example.com'), false);
  });

  it('註冊已存在的 email 時由 precheck 回傳衝突', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'Duplicate Teacher',
        email: '  TEACHER@FOCUSFLOW.LOCAL ',
        password: 'Password123!',
        role: 'teacher',
      },
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'DUPLICATE_RESOURCE');
    assert.equal(result.body.message, 'Email is already registered.');
    assert.equal(store.usageLogs.length, 0);
  });

  it('precheck 後發生 unique index 競態時仍回傳一致的衝突錯誤', async () => {
    const duplicateError = new Error('E11000 duplicate key error');
    duplicateError.code = 11000;
    duplicateError.keyValue = { email: 'race@example.com' };
    store.nextUserCreateError = duplicateError;

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'Race Student',
        email: 'race@example.com',
        password: 'Password123!',
        role: 'student',
      },
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'DUPLICATE_RESOURCE');
    assert.equal(result.body.message, 'Email is already registered.');
    assert.equal(store.users.some((user) => user.email === 'race@example.com'), false);
    assert.equal(store.usageLogs.length, 0);
  });

  it('lineUserId unique index 衝突不會誤報為 email 已註冊', async () => {
    const duplicateError = new Error('E11000 duplicate key error');
    duplicateError.code = 11000;
    duplicateError.keyPattern = { lineUserId: 1 };
    duplicateError.keyValue = { lineUserId: 'line-already-linked' };
    store.nextUserCreateError = duplicateError;

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'LINE Conflict Student',
        email: 'line-conflict@example.com',
        password: 'Password123!',
        role: 'student',
      },
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'LINE_ACCOUNT_ALREADY_LINKED');
    assert.equal(result.body.message, 'LINE account is already linked to another user.');
    assert.notEqual(result.body.message, 'Email is already registered.');
    assert.equal(store.users.some((user) => user.email === 'line-conflict@example.com'), false);
    assert.equal(store.usageLogs.length, 0);
  });

  it('無 duplicate key 欄位資訊的 E11000 回傳安全的通用衝突', async () => {
    const duplicateError = new Error('E11000 duplicate key error');
    duplicateError.code = 11000;
    store.nextUserCreateError = duplicateError;

    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'Generic Conflict Student',
        email: 'generic-conflict@example.com',
        password: 'Password123!',
        role: 'student',
      },
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'DUPLICATE_RESOURCE');
    assert.equal(result.body.message, 'Account information conflicts with an existing user.');
    assert.notEqual(result.body.message, 'Email is already registered.');
    assert.equal(store.users.some((user) => user.email === 'generic-conflict@example.com'), false);
    assert.equal(store.usageLogs.length, 0);
  });
});
