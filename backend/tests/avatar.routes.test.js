const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const User = require('../src/models/user.model');
const Avatar = require('../src/models/avatar.model');
const { MAX_AVATAR_BYTES } = require('../src/middleware/avatarUpload.middleware');
const {
  ids,
  store,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
} = require('./helpers/backendTestHarness');

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-avatar'),
]);
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('jpeg-avatar'),
]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x04, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('webp-avatar'),
]);

function createAvatarForm({
  bytes = PNG_BYTES,
  mimeType = 'image/png',
  filename = 'avatar.png',
  fieldName = 'avatar',
} = {}) {
  const formData = new FormData();
  formData.append(fieldName, new Blob([bytes], { type: mimeType }), filename);
  return formData;
}

async function uploadAvatar(baseUrl, token, options = {}) {
  return jsonRequest(baseUrl, '/api/v1/auth/me/avatar', {
    method: 'PUT',
    token,
    body: createAvatarForm(options),
  });
}

function loginStudent(baseUrl) {
  return loginAs(baseUrl, 'student@focusflow.local', 'Student123!');
}

function studentUser() {
  return store.users.find((user) => user._id === ids.student);
}

function studentAvatars() {
  return store.avatars.filter((avatar) => String(avatar.userId) === ids.student);
}

describe('auth avatar routes', () => {
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

  it('User schema 只存 nullable avatar presence metadata，圖片本體在 avatars collection', () => {
    const avatarPath = User.schema.path('avatar');
    assert.ok(avatarPath);
    assert.deepEqual(
      Object.keys(avatarPath.schema.paths).sort(),
      ['mimeType', 'updatedAt'],
    );

    const withoutAvatar = new User({
      name: 'No Avatar',
      email: 'no-avatar@example.com',
      passwordHash: 'hash',
      role: 'student',
    });
    assert.equal(withoutAvatar.avatar, null);
    assert.equal(withoutAvatar.validateSync(), undefined);

    assert.equal(Avatar.collection.collectionName, 'avatars');
    assert.equal(Avatar.schema.path('userId').options.unique, true);
    assert.equal(Avatar.schema.path('data').instance, 'Buffer');
  });

  it('未登入不可上傳或讀取頭貼', async () => {
    const upload = await uploadAvatar(serverContext.baseUrl, null);
    const read = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me/avatar');

    assert.equal(upload.status, 401);
    assert.equal(upload.body.error.code, 'UNAUTHORIZED');
    assert.equal(read.status, 401);
    assert.equal(read.body.error.code, 'UNAUTHORIZED');
    assert.deepEqual(store.avatars, []);
  });

  it('缺少 avatar multipart field 時回傳 AVATAR_REQUIRED', async () => {
    const token = await loginStudent(serverContext.baseUrl);
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me/avatar', {
      method: 'PUT',
      token,
      body: new FormData(),
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'AVATAR_REQUIRED');
    assert.deepEqual(store.avatars, []);
  });

  it('wrong field、repeated file 與 malformed multipart 統一回傳安全 UPLOAD_ERROR', async () => {
    const token = await loginStudent(serverContext.baseUrl);
    const wrongField = await uploadAvatar(serverContext.baseUrl, token, {
      fieldName: 'photo',
    });
    const repeatedForm = createAvatarForm();
    repeatedForm.append(
      'avatar',
      new Blob([JPEG_BYTES], { type: 'image/jpeg' }),
      'second.jpg',
    );
    const repeated = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me/avatar', {
      method: 'PUT',
      token,
      body: repeatedForm,
    });
    const malformedResponse = await fetch(
      `${serverContext.baseUrl}/api/v1/auth/me/avatar`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data; boundary=broken-boundary',
        },
        body: '--broken-boundary\r\nContent-Disposition: form-data; name="avatar"',
      },
    );
    const malformed = await malformedResponse.json();

    for (const result of [wrongField, repeated]) {
      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'UPLOAD_ERROR');
      assert.equal(JSON.stringify(result.body).includes('Unexpected field'), false);
    }
    assert.equal(malformedResponse.status, 400);
    assert.equal(malformed.error.code, 'UPLOAD_ERROR');
    assert.equal(JSON.stringify(malformed).includes('Unexpected end of form'), false);
    assert.deepEqual(store.avatars, []);
  });

  it('超過 1 MiB 時回傳 AVATAR_TOO_LARGE 且不寫入', async () => {
    const token = await loginStudent(serverContext.baseUrl);
    const bytes = Buffer.alloc(MAX_AVATAR_BYTES + 1);
    PNG_BYTES.copy(bytes);
    const result = await uploadAvatar(serverContext.baseUrl, token, {
      bytes,
      mimeType: 'image/png',
    });

    assert.equal(MAX_AVATAR_BYTES, 1024 * 1024);
    assert.equal(result.status, 413);
    assert.equal(result.body.error.code, 'AVATAR_TOO_LARGE');
    assert.deepEqual(store.avatars, []);
  });

  it('拒絕非允許 MIME 與 SVG 且不寫入', async () => {
    const token = await loginStudent(serverContext.baseUrl);
    const textResult = await uploadAvatar(serverContext.baseUrl, token, {
      bytes: PNG_BYTES,
      mimeType: 'text/plain',
      filename: 'avatar.txt',
    });
    const svgResult = await uploadAvatar(serverContext.baseUrl, token, {
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      mimeType: 'image/svg+xml',
      filename: 'avatar.svg',
    });

    assert.equal(textResult.status, 400);
    assert.equal(textResult.body.error.code, 'INVALID_AVATAR_TYPE');
    assert.equal(svgResult.status, 400);
    assert.equal(svgResult.body.error.code, 'INVALID_AVATAR_TYPE');
    assert.deepEqual(store.avatars, []);
  });

  it('拒絕偽造 magic signature 或宣告 MIME 不符的內容', async () => {
    const token = await loginStudent(serverContext.baseUrl);
    const spoofResult = await uploadAvatar(serverContext.baseUrl, token, {
      bytes: Buffer.from('not really a png'),
      mimeType: 'image/png',
    });
    const mismatchResult = await uploadAvatar(serverContext.baseUrl, token, {
      bytes: JPEG_BYTES,
      mimeType: 'image/png',
    });

    assert.equal(spoofResult.status, 400);
    assert.equal(spoofResult.body.error.code, 'INVALID_AVATAR_FILE');
    assert.equal(mismatchResult.status, 400);
    assert.equal(mismatchResult.body.error.code, 'INVALID_AVATAR_FILE');
    assert.deepEqual(store.avatars, []);
  });

  for (const imageCase of [
    { label: 'PNG', mimeType: 'image/png', bytes: PNG_BYTES },
    { label: 'JPEG', mimeType: 'image/jpeg', bytes: JPEG_BYTES },
    { label: 'WebP', mimeType: 'image/webp', bytes: WEBP_BYTES },
  ]) {
    it(`${imageCase.label} 圖片本體存進 avatars，User 只記 metadata`, async () => {
      const token = await loginStudent(serverContext.baseUrl);
      const result = await uploadAvatar(serverContext.baseUrl, token, {
        bytes: imageCase.bytes,
        mimeType: imageCase.mimeType,
        filename: '../../client-controlled-name.png',
      });
      const [storedAvatar] = studentAvatars();

      assert.equal(result.status, 200);
      assert.equal(result.body.data.user.hasAvatar, true);
      assert.ok(result.body.data.user.avatarUpdatedAt);
      assert.equal(result.body.data.avatar.mimeType, imageCase.mimeType);
      assert.equal(JSON.stringify(result.body).includes('client-controlled-name'), false);
      assert.equal(studentAvatars().length, 1);
      assert.deepEqual(Buffer.from(storedAvatar.data), imageCase.bytes);
      assert.equal(storedAvatar.mimeType, imageCase.mimeType);
      assert.equal(storedAvatar.size, imageCase.bytes.length);
      assert.deepEqual(Object.keys(studentUser().avatar).sort(), ['mimeType', 'updatedAt']);
    });
  }

  it('沒有頭貼時回傳 AVATAR_NOT_FOUND', async () => {
    const token = await loginStudent(serverContext.baseUrl);
    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/auth/me/avatar',
      { token },
    );

    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'AVATAR_NOT_FOUND');
  });

  it('User 有舊版 metadata 但 avatars 沒有資料時回傳 AVATAR_NOT_FOUND', async () => {
    const token = await loginStudent(serverContext.baseUrl);
    studentUser().avatar = {
      filename: '123e4567-e89b-42d3-a456-426614174000.png',
      mimeType: 'image/png',
      updatedAt: '2026-09-03T07:44:00.502Z',
    };

    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/auth/me/avatar',
      { token },
    );

    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'AVATAR_NOT_FOUND');
  });

  it('讀取頭貼回傳 binary、真實 Content-Type 與 private security headers', async () => {
    const token = await loginStudent(serverContext.baseUrl);
    await uploadAvatar(serverContext.baseUrl, token, {
      bytes: WEBP_BYTES,
      mimeType: 'image/webp',
    });

    const response = await fetch(`${serverContext.baseUrl}/api/v1/auth/me/avatar`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const body = Buffer.from(await response.arrayBuffer());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('cache-control'), /^private,/);
    assert.deepEqual(body, WEBP_BYTES);
  });

  it('me route 不允許其他帳號讀取目前使用者以外的頭貼', async () => {
    const studentToken = await loginStudent(serverContext.baseUrl);
    const teacherToken = await loginAs(
      serverContext.baseUrl,
      'teacher@focusflow.local',
      'Teacher123!',
    );
    await uploadAvatar(serverContext.baseUrl, studentToken);

    const teacherResult = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/auth/me/avatar',
      { token: teacherToken },
    );

    assert.equal(teacherResult.status, 404);
    assert.equal(teacherResult.body.error.code, 'AVATAR_NOT_FOUND');
  });

  it('替換頭貼覆寫同一筆 avatars 文件並更新 Content-Type', async () => {
    const token = await loginStudent(serverContext.baseUrl);
    await uploadAvatar(serverContext.baseUrl, token);
    const replacement = await uploadAvatar(serverContext.baseUrl, token, {
      bytes: JPEG_BYTES,
      mimeType: 'image/jpeg',
      filename: 'replacement.jpeg',
    });
    const response = await fetch(`${serverContext.baseUrl}/api/v1/auth/me/avatar`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(replacement.status, 200);
    assert.equal(studentAvatars().length, 1);
    assert.equal(studentUser().avatar.mimeType, 'image/jpeg');
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), JPEG_BYTES);
  });

  it('avatars 寫入失敗時回傳 AVATAR_STORAGE_ERROR 且不更新 User', async () => {
    const token = await loginStudent(serverContext.baseUrl);
    store.nextAvatarWriteError = new Error('simulated avatar write failure');

    const result = await uploadAvatar(serverContext.baseUrl, token);

    assert.equal(result.status, 500);
    assert.equal(result.body.error.code, 'AVATAR_STORAGE_ERROR');
    assert.equal(studentUser().avatar, null);
    assert.deepEqual(store.avatars, []);
  });

  it('login、register 與 auth/me 公開 user 只增加 avatar presence fields', async () => {
    const teacher = store.users.find((user) => user._id === ids.teacher);
    teacher.avatar = {
      mimeType: 'image/png',
      updatedAt: '2026-07-24T12:00:00.000Z',
    };

    const login = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'teacher@focusflow.local',
        password: 'Teacher123!',
        role: 'teacher',
      },
    });
    const me = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me', {
      token: login.body.data.token,
    });
    const register = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        name: 'New Avatarless Student',
        email: 'avatarless@example.com',
        password: 'Password123!',
        role: 'student',
      },
    });

    for (const result of [login, me]) {
      assert.equal(result.body.data.user.hasAvatar, true);
      assert.equal(
        result.body.data.user.avatarUpdatedAt,
        '2026-07-24T12:00:00.000Z',
      );
      assert.equal(Object.hasOwn(result.body.data.user, 'avatar'), false);
    }
    assert.equal(register.body.data.user.hasAvatar, false);
    assert.equal(register.body.data.user.avatarUpdatedAt, null);
    assert.equal(Object.hasOwn(register.body.data.user, 'avatar'), false);
  });
});
