const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');

const envModulePath = path.join(__dirname, '..', 'src', 'config', 'env.js');

// env.js 在 require 時就決定 qaMatchLimit，且會載入開發者本機的 .env，
// 因此用子行程、停用 dotenv，在乾淨的環境變數下各載入一次。
function loadQaMatchLimit(overrides) {
  const script = `
    require('dotenv').config = () => ({});
    const env = require(${JSON.stringify(envModulePath)});
    process.stdout.write(JSON.stringify({ qaMatchLimit: env.qaMatchLimit }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...overrides },
    encoding: 'utf8',
  });
  return JSON.parse(result.stdout).qaMatchLimit;
}

describe('QA_MATCH_LIMIT 預設值', () => {
  it('未設定 QA_MATCH_LIMIT 時預設為 15，與 .env.example 一致', () => {
    assert.equal(loadQaMatchLimit({}), 15);
  });

  it('設定 QA_MATCH_LIMIT 時沿用設定值', () => {
    assert.equal(loadQaMatchLimit({ QA_MATCH_LIMIT: '5' }), 5);
  });
});
