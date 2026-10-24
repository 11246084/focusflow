import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { it } from 'node:test';

const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vite.config.js');
function loadConfig(files, apiOverride) {
  const directory = mkdtempSync(path.join(tmpdir(), 'focusflow-api-build-'));
  try {
    for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(directory, name), contents);
    const env = { ...process.env };
    delete env.VITE_API_BASE_URL;
    delete env.VITE_DEV_PROXY_TARGET;
    if (apiOverride !== undefined) env.VITE_API_BASE_URL = apiOverride;
    const script = `try {
      const { default: factory } = await import(${JSON.stringify(pathToFileURL(configPath).href)});
      const config = factory({ mode: 'production', command: 'build' });
      console.log(JSON.stringify({ ok: true, apiTarget: config.server.proxy['/api'].target, uploadsTarget: config.server.proxy['/uploads'].target }));
    } catch (error) { console.log(JSON.stringify({ ok: false, message: error.message })); }`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
it('production build 以 Vite 解析後的 .env.production 為準，阻擋絕對 API', () => {
  const result = loadConfig({ '.env': 'VITE_API_BASE_URL=/api/v1', '.env.production': 'VITE_API_BASE_URL=https://fixture.invalid/api/v1' });
  assert.equal(result.ok, false); assert.match(result.message, /same-origin build/);
});
it('production build 最高優先的既有環境變數不可繞過檢查', () => {
  assert.equal(loadConfig({ '.env.production': 'VITE_API_BASE_URL=/api/v1' }, 'https://fixture.invalid/api/v1').ok, false);
  assert.equal(loadConfig({ '.env.production': 'VITE_API_BASE_URL=https://fixture.invalid/api/v1' }, '/api/v1').ok, true);
});
it('空值與 /api/v1 可打包，本機 API 與 uploads 預設走同一代理', () => {
  for (const value of ['', '/api/v1']) {
    const result = loadConfig({ '.env.production': `VITE_API_BASE_URL=${value}` });
    assert.equal(result.ok, true);
    assert.equal(result.apiTarget, 'http://127.0.0.1:4000'); assert.equal(result.uploadsTarget, result.apiTarget);
  }
});
