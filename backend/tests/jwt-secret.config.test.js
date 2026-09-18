const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const envModulePath = path.join(__dirname, '..', 'src', 'config', 'env.js');

// env.js 在 require 時就決定 jwtSecret，因此用子行程在不同環境變數下各載入一次。
function loadEnv(overrides) {
  const script = `
    require('dotenv').config = () => ({});
    try {
      const env = require(${JSON.stringify(envModulePath)});
      process.stdout.write(JSON.stringify({ ok: true, isDefault: env.jwtSecret === 'change-me-in-local-env' }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, message: error.message }));
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...overrides },
    encoding: 'utf8',
  });
  return JSON.parse(result.stdout);
}

describe('JWT_SECRET 啟動檢查', () => {
  it('production 沒有設定 JWT_SECRET 時拒絕啟動', () => {
    const result = loadEnv({ NODE_ENV: 'production', JWT_SECRET: '' });
    assert.equal(result.ok, false);
    assert.match(result.message, /JWT_SECRET/);
  });

  it('production 沿用預設值時拒絕啟動', () => {
    const result = loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'change-me-in-local-env' });
    assert.equal(result.ok, false);
  });

  it('production 設定自訂金鑰時正常啟動', () => {
    const result = loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'a-unique-secret-for-tests-0123456789' });
    assert.deepEqual(result, { ok: true, isDefault: false });
  });

  it('開發環境仍可使用預設值', () => {
    const result = loadEnv({ NODE_ENV: 'development', JWT_SECRET: '' });
    assert.deepEqual(result, { ok: true, isDefault: true });
  });
});
