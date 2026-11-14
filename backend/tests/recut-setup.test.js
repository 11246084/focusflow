const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const worker = fs.readFileSync(path.join(root, 'tools/recut/setup-worker.sh'), 'utf8').replace(/\r\n/g, '\n');
const source = worker.split('<<\'NODE\'\n')[1].split('\nNODE')[0];
const key = `rw_${'a'.repeat(24)}.${'b'.repeat(43)}`;

async function runLogin({ purpose, rejectCode = false, rejectCreate = false } = {}) {
  const calls = []; const output = []; const errors = [];
  const processMock = { env: { BACKEND_URL: 'http://127.0.0.1:4000', ADMIN_ORIGIN: 'https://focusflow.ntub.edu.tw',
    ADMIN_EMAIL: 'admin@example.test', ADMIN_PASSWORD: 'test-only', WORKER_NAME: 'test-worker' } };
  const pending = { requiresVerification: true, purpose, maskedEmail: 'a***@example.test' };
  const context = { process: processMock, AbortSignal, Map,
    console: { log: (s) => output.push(s), error: (s) => errors.push(s) },
    require: () => ({ spawnSync: () => ({ status: 0, stdout: '123456' }) }),
    fetch: async (url, options) => {
      const route = new URL(url).pathname.replace('/api/v1', '');
      calls.push({ route, ...options });
      let data; let status = 200; let cookies = [];
      if (route === '/auth/session' && options.method === 'POST') {
        data = purpose ? pending : { user: { role: 'admin' } };
        cookies = [purpose ? '__Host-ff_pending=pending; Secure' : '__Host-ff_session=session; Secure'];
      } else if (route === '/auth/pending/verify') {
        status = rejectCode ? 400 : 200;
        data = { user: { role: 'admin' } };
        if (!rejectCode) cookies = ['__Host-ff_pending=; Max-Age=0', '__Host-ff_session=session; Secure'];
      } else if (route === '/admin/recut-workers') {
        status = rejectCreate ? 403 : 201; data = { key };
      }
      return { ok: status < 400, status, headers: { getSetCookie: () => cookies },
        json: async () => ({ data, error: status >= 400 ? { code: 'TEST_REJECTED' } : undefined }) };
    } };
  await vm.runInNewContext(source, context);
  return { calls, output, errors, processMock };
}

test('worker 完成信箱驗證後才建立金鑰，並登出暫時 session', async () => {
  const result = await runLogin({ purpose: 'admin_2fa' });
  assert.deepEqual(result.calls.map((c) => `${c.method} ${c.route}`), [
    'POST /auth/session', 'POST /auth/pending/verify', 'POST /admin/recut-workers', 'DELETE /auth/session']);
  assert.equal(result.calls[1].headers.Cookie, '__Host-ff_pending=pending');
  assert.equal(result.calls[2].headers.Cookie, '__Host-ff_session=session');
  assert.equal(result.calls[2].headers['X-Requested-With'], 'FocusFlow');
  assert.equal(result.calls[2].headers.Origin, 'https://focusflow.ntub.edu.tw');
  assert.deepEqual(result.output, [`RECUT_WORKER_KEY=${key}`]);
  assert.equal(result.processMock.env.ADMIN_PASSWORD, undefined);
});

test('worker 無需驗證時也使用 Cookie 並登出', async () => {
  const result = await runLogin();
  assert.equal(result.calls.length, 3);
  assert.equal(result.calls[1].route, '/admin/recut-workers');
  assert.equal(result.calls[2].method, 'DELETE');
});

test('驗證碼錯誤或首次登入時不建立金鑰，取消 pending', async () => {
  for (const options of [{ purpose: 'admin_2fa', rejectCode: true }, { purpose: 'first_login' }]) {
    const result = await runLogin(options);
    assert.equal(result.calls.some((c) => c.route === '/admin/recut-workers'), false);
    assert.equal(result.calls.at(-1).route, '/auth/pending');
    assert.equal(result.calls.at(-1).method, 'DELETE');
    assert.equal(result.output.length, 0);
    assert.equal(result.processMock.exitCode, 1);
  }
});

test('建立金鑰被拒絕時仍登出，且不輸出金鑰', async () => {
  const result = await runLogin({ rejectCreate: true });
  assert.equal(result.calls.at(-1).method, 'DELETE');
  assert.equal(result.output.length, 0);
  assert.equal(result.processMock.exitCode, 1);
});

test('VM 選填設定不存在時可在 pipefail 下套用預設值', (t) => {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  if (process.platform === 'win32' && !fs.existsSync(bash)) return t.skip('未安裝 Git Bash');
  const script = fs.readFileSync(path.join(root, 'tools/recut/setup-vm.sh'), 'utf8').replace(/\r\n/g, '\n');
  const fn = script.slice(script.indexOf('env_value() {'), script.indexOf('\nstep "1.'));
  const result = spawnSync(bash, ['-c', `set -euo pipefail\nENV_FILE="$1"\n[ -f "$ENV_FILE" ]\n${fn}\nvalue="$(env_value RECUT_GEMINI_MODEL)"\nvalue="\${value:-fallback}"\nprintf '%s' "$value"`, 'test', __filename.replace(/\\/g, '/')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'fallback');
});
