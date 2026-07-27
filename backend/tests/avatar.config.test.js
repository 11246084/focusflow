const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

describe('avatar storage config', () => {
  it('啟動時拒絕 AVATAR_UPLOAD_DIR 等於或位於 public UPLOAD_DIR', () => {
    const backendRoot = path.resolve(__dirname, '..');

    for (const avatarUploadDir of ['public-files', 'public-files/avatars']) {
      const result = spawnSync(
        process.execPath,
        ['-e', "require('./src/config/env')"],
        {
          cwd: backendRoot,
          env: {
            ...process.env,
            UPLOAD_DIR: 'public-files',
            AVATAR_UPLOAD_DIR: avatarUploadDir,
          },
          encoding: 'utf8',
        },
      );

      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /AVATAR_UPLOAD_DIR must be outside UPLOAD_DIR/,
      );
    }
  });
});
