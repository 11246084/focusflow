const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { after, before, beforeEach, describe, it } = require('node:test');
const User = require('../src/models/user.model');
const logger = require('../src/utils/logger');
const { MAX_AVATAR_BYTES } = require('../src/middleware/avatarUpload.middleware');
const {
  env,
  ids,
  store,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
  cleanupTestAvatars,
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

function avatarFiles() {
  if (!fs.existsSync(env.avatarUploadDir)) {
    return [];
  }
  return fs.readdirSync(env.avatarUploadDir);
}

describe('auth avatar routes', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
    cleanupTestAvatars();
  });

  beforeEach(() => {
    resetStore();
  });

  it('User schema 僅儲存 nullable server avatar metadata', () => {
    const avatarPath = User.schema.path('avatar');
    assert.ok(avatarPath);
    assert.deepEqual(
      Object.keys(avatarPath.schema.paths).sort(),
      ['filename', 'mimeType', 'updatedAt'],
    );

    const withoutAvatar = new User({
      name: 'No Avatar',
      email: 'no-avatar@example.com',
      passwordHash: 'hash',
      role: 'student',
    });
    assert.equal(withoutAvatar.avatar, null);
    assert.equal(withoutAvatar.validateSync(), undefined);

    const invalidAvatar = new User({
      name: 'Unsafe Avatar',
      email: 'unsafe-avatar@example.com',
      passwordHash: 'hash',
      role: 'student',
      avatar: {
        filename: '../client/avatar.png',
        mimeType: 'image/png',
        updatedAt: new Date(),
      },
    });
    assert.ok(invalidAvatar.validateSync()?.errors['avatar.filename']);
  });

  it('未登入不可上傳或讀取頭貼', async () => {
    const upload = await uploadAvatar(serverContext.baseUrl, null);
    const read = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me/avatar');

    assert.equal(upload.status, 401);
    assert.equal(upload.body.error.code, 'UNAUTHORIZED');
    assert.equal(read.status, 401);
    assert.equal(read.body.error.code, 'UNAUTHORIZED');
    assert.deepEqual(avatarFiles(), []);
  });

  it('缺少 avatar multipart field 時回傳 AVATAR_REQUIRED', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/auth/me/avatar', {
      method: 'PUT',
      token,
      body: new FormData(),
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'AVATAR_REQUIRED');
    assert.deepEqual(avatarFiles(), []);
  });

  it('wrong field、repeated file 與 malformed multipart 統一回傳安全 UPLOAD_ERROR', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
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
    assert.deepEqual(avatarFiles(), []);
  });

  it('超過 5 MiB 時拒絕且不留下檔案', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const bytes = Buffer.alloc(MAX_AVATAR_BYTES + 1);
    PNG_BYTES.copy(bytes);
    const result = await uploadAvatar(serverContext.baseUrl, token, {
      bytes,
      mimeType: 'image/png',
    });

    assert.equal(result.status, 413);
    assert.equal(result.body.error.code, 'AVATAR_TOO_LARGE');
    assert.deepEqual(avatarFiles(), []);
  });

  it('拒絕非允許 MIME 與 SVG 且不留下檔案', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
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
    assert.deepEqual(avatarFiles(), []);
  });

  it('拒絕偽造 magic signature 或宣告 MIME 不符的內容', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
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
    assert.deepEqual(avatarFiles(), []);
  });

  for (const imageCase of [
    { label: 'PNG', mimeType: 'image/png', extension: 'png', bytes: PNG_BYTES },
    { label: 'JPEG', mimeType: 'image/jpeg', extension: 'jpg', bytes: JPEG_BYTES },
    { label: 'WebP', mimeType: 'image/webp', extension: 'webp', bytes: WEBP_BYTES },
  ]) {
    it(`${imageCase.label} 依真實格式安全命名並關聯目前使用者`, async () => {
      const token = await loginAs(
        serverContext.baseUrl,
        'student@focusflow.local',
        'Student123!',
      );
      const result = await uploadAvatar(serverContext.baseUrl, token, {
        bytes: imageCase.bytes,
        mimeType: imageCase.mimeType,
        filename: '../../client-controlled-name.png',
      });
      const storedUser = store.users.find((user) => user._id === ids.student);

      assert.equal(result.status, 200);
      assert.equal(result.body.data.user.hasAvatar, true);
      assert.ok(result.body.data.user.avatarUpdatedAt);
      assert.equal(result.body.data.avatar.mimeType, imageCase.mimeType);
      assert.ok(result.body.data.avatar.updatedAt);
      assert.equal(JSON.stringify(result.body).includes('filename'), false);
      assert.equal(JSON.stringify(result.body).includes('client-controlled-name'), false);
      assert.match(
        storedUser.avatar.filename,
        new RegExp(`^[0-9a-f-]+\\.${imageCase.extension}$`, 'i'),
      );
      assert.equal(storedUser.avatar.mimeType, imageCase.mimeType);
      assert.ok(storedUser.avatar.updatedAt);
      assert.deepEqual(
        fs.readFileSync(path.join(env.avatarUploadDir, storedUser.avatar.filename)),
        imageCase.bytes,
      );
    });
  }

  it('沒有頭貼時回傳 AVATAR_NOT_FOUND', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/auth/me/avatar',
      { token },
    );

    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'AVATAR_NOT_FOUND');
  });

  it('讀取頭貼回傳 binary、真實 Content-Type 與 private security headers', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
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

  it('匿名請求無法透過 /uploads 猜測 server avatar filename', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    await uploadAvatar(serverContext.baseUrl, token);
    const storedUser = store.users.find((user) => user._id === ids.student);

    const guessed = await fetch(
      `${serverContext.baseUrl}/uploads/${storedUser.avatar.filename}`,
    );

    assert.equal(guessed.status, 404);
  });

  it('me route 不允許其他帳號讀取目前使用者以外的頭貼', async () => {
    const studentToken = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
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

  it('替換頭貼先更新新檔與 User，再刪除舊檔', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    await uploadAvatar(serverContext.baseUrl, token);
    const storedUser = store.users.find((user) => user._id === ids.student);
    const oldFilename = storedUser.avatar.filename;
    const oldPath = path.join(env.avatarUploadDir, oldFilename);
    assert.equal(fs.existsSync(oldPath), true);

    const replacement = await uploadAvatar(serverContext.baseUrl, token, {
      bytes: JPEG_BYTES,
      mimeType: 'image/jpeg',
      filename: 'replacement.jpeg',
    });
    const newFilename = storedUser.avatar.filename;

    assert.equal(replacement.status, 200);
    assert.notEqual(newFilename, oldFilename);
    assert.equal(fs.existsSync(oldPath), false);
    assert.equal(fs.existsSync(path.join(env.avatarUploadDir, newFilename)), true);
    assert.deepEqual(avatarFiles(), [newFilename]);
  });

  it('DB 寫入失敗時清除新檔並保留既有頭貼', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    await uploadAvatar(serverContext.baseUrl, token);
    const storedUser = store.users.find((user) => user._id === ids.student);
    const oldAvatar = { ...storedUser.avatar };
    store.nextUserFindByIdAndUpdateError = new Error('simulated user write failure');

    const result = await uploadAvatar(serverContext.baseUrl, token, {
      bytes: JPEG_BYTES,
      mimeType: 'image/jpeg',
    });

    assert.equal(result.status, 500);
    assert.deepEqual(storedUser.avatar, oldAvatar);
    assert.deepEqual(avatarFiles(), [oldAvatar.filename]);
  });

  it('同一使用者併發上傳以 atomic CAS 決勝，loser 清除自己的新檔', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    let arrivals = 0;
    let releaseBarrier;
    const barrier = new Promise((resolve) => {
      releaseBarrier = resolve;
    });
    store.beforeUserAvatarCompareAndSwap = async () => {
      arrivals += 1;
      if (arrivals === 2) {
        releaseBarrier();
      }
      await barrier;
    };

    const results = await Promise.all([
      uploadAvatar(serverContext.baseUrl, token, {
        bytes: PNG_BYTES,
        mimeType: 'image/png',
      }),
      uploadAvatar(serverContext.baseUrl, token, {
        bytes: JPEG_BYTES,
        mimeType: 'image/jpeg',
      }),
    ]);
    const winner = results.find((result) => result.status === 200);
    const loser = results.find((result) => result.status === 409);
    const storedUser = store.users.find((user) => user._id === ids.student);

    assert.ok(winner);
    assert.equal(loser?.body.error.code, 'AVATAR_UPDATE_CONFLICT');
    assert.deepEqual(avatarFiles(), [storedUser.avatar.filename]);
    assert.equal(
      fs.existsSync(path.join(env.avatarUploadDir, storedUser.avatar.filename)),
      true,
    );
  });

  it('舊檔 unlink 真 I/O 錯誤只記錄結構化 warning，不回滾成功替換', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    await uploadAvatar(serverContext.baseUrl, token);
    const storedUser = store.users.find((user) => user._id === ids.student);
    const oldFilename = storedUser.avatar.filename;
    const originalUnlink = fsPromises.unlink;
    const originalWarn = logger.warn;
    const warnings = [];

    fsPromises.unlink = async (target) => {
      if (String(target).endsWith(oldFilename)) {
        const error = new Error('simulated access denied');
        error.code = 'EACCES';
        throw error;
      }
      return originalUnlink(target);
    };
    logger.warn = (event, metadata) => warnings.push({ event, metadata });

    try {
      const result = await uploadAvatar(serverContext.baseUrl, token, {
        bytes: JPEG_BYTES,
        mimeType: 'image/jpeg',
      });

      assert.equal(result.status, 200);
      assert.notEqual(storedUser.avatar.filename, oldFilename);
      assert.equal(fs.existsSync(path.join(env.avatarUploadDir, oldFilename)), true);
      assert.deepEqual(warnings, [{
        event: 'avatar.cleanup_failed',
        metadata: {
          reason: 'replaced',
          filename: oldFilename,
          errorCode: 'EACCES',
        },
      }]);
    } finally {
      fsPromises.unlink = originalUnlink;
      logger.warn = originalWarn;
      fs.rmSync(path.join(env.avatarUploadDir, oldFilename), { force: true });
    }
  });

  it('檔案系統失敗時不更新 User 且不留下 avatar temp file', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const originalDirectory = env.avatarUploadDir;
    const blockedPath = path.join(path.dirname(originalDirectory), 'blocked-avatar-target');
    fs.writeFileSync(blockedPath, 'not a directory');
    env.avatarUploadDir = blockedPath;

    try {
      const result = await uploadAvatar(serverContext.baseUrl, token);
      const storedUser = store.users.find((user) => user._id === ids.student);

      assert.equal(result.status, 500);
      assert.equal(result.body.error.code, 'AVATAR_STORAGE_ERROR');
      assert.equal(storedUser.avatar, null);
      assert.equal(fs.statSync(blockedPath).isFile(), true);
    } finally {
      env.avatarUploadDir = originalDirectory;
      fs.rmSync(blockedPath, { force: true });
    }

    assert.deepEqual(avatarFiles(), []);
  });

  it('重疊設定會 fail fast，realpath guard 也拒絕 symlink 導回 public uploads', async () => {
    assert.throws(
      () => env.assertPrivateAvatarUploadDir(env.uploadDir, env.uploadDir),
      /outside UPLOAD_DIR/,
    );
    assert.throws(
      () => env.assertPrivateAvatarUploadDir(
        env.uploadDir,
        path.join(env.uploadDir, 'avatars'),
      ),
      /outside UPLOAD_DIR/,
    );

    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const originalDirectory = env.avatarUploadDir;
    const suffix = `${process.pid}-${Date.now()}`;
    const publicTarget = path.join(env.uploadDir, `avatar-public-target-${suffix}`);
    const linkedAvatarDirectory = path.join(
      path.dirname(originalDirectory),
      `avatar-public-link-${suffix}`,
    );
    fs.mkdirSync(publicTarget, { recursive: true });
    fs.symlinkSync(publicTarget, linkedAvatarDirectory, 'junction');
    env.avatarUploadDir = linkedAvatarDirectory;

    try {
      const result = await uploadAvatar(serverContext.baseUrl, token);
      const storedUser = store.users.find((user) => user._id === ids.student);

      assert.equal(result.status, 500);
      assert.equal(result.body.error.code, 'AVATAR_STORAGE_CONFIG_ERROR');
      assert.equal(storedUser.avatar, null);
      assert.deepEqual(fs.readdirSync(publicTarget), []);
    } finally {
      env.avatarUploadDir = originalDirectory;
      fs.rmSync(linkedAvatarDirectory, { recursive: true, force: true });
      fs.rmSync(publicTarget, { recursive: true, force: true });
    }
  });

  it('不讀取或刪除 avatar directory 外的惡意 metadata 路徑', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const outsidePath = path.join(path.dirname(env.avatarUploadDir), 'outside-avatar.png');
    fs.writeFileSync(outsidePath, PNG_BYTES);
    const storedUser = store.users.find((user) => user._id === ids.student);
    storedUser.avatar = {
      filename: '../outside-avatar.png',
      mimeType: 'image/png',
      updatedAt: new Date().toISOString(),
    };

    try {
      const readResult = await jsonRequest(
        serverContext.baseUrl,
        '/api/v1/auth/me/avatar',
        { token },
      );
      assert.equal(readResult.status, 404);
      assert.equal(readResult.body.error.code, 'AVATAR_NOT_FOUND');

      const uploadResult = await uploadAvatar(serverContext.baseUrl, token);
      assert.equal(uploadResult.status, 200);
      assert.equal(fs.existsSync(outsidePath), true);
      assert.notEqual(storedUser.avatar.filename, '../outside-avatar.png');
    } finally {
      fs.rmSync(outsidePath, { force: true });
    }
  });

  it('login、register 與 auth/me 公開 user 只增加 avatar presence fields', async () => {
    const teacher = store.users.find((user) => user._id === ids.teacher);
    teacher.avatar = {
      filename: '123e4567-e89b-42d3-a456-426614174000.png',
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
      assert.equal(JSON.stringify(result.body).includes(teacher.avatar.filename), false);
    }
    assert.equal(register.body.data.user.hasAvatar, false);
    assert.equal(register.body.data.user.avatarUpdatedAt, null);
    assert.equal(Object.hasOwn(register.body.data.user, 'avatar'), false);
  });
});
