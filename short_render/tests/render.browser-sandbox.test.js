'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ensureFontLoaded } = require('../src/render/browser');

const fakeBrowser = (state) => async (options) => { state.options = options; return { newPage: async () => ({ setRequestInterception: async () => {},
  on: (_name, callback) => { state.interceptor = callback; }, goto: async () => {}, evaluate: async () => true }), close: async () => { state.closed = true; } }; };

// 2026-11-05：雲端容器以 root 執行，Chromium 未帶 --no-sandbox 拒絕啟動，字型檢查失敗、渲染被擋。
test('font preflight adds --no-sandbox only when running as Linux root and still blocks remote requests', async () => {
  const root = {};
  assert.equal(await ensureFontLoaded({ stageDir: '.', launch: fakeBrowser(root), isLinuxRoot: () => true }), true);
  assert.deepEqual(root.options.args, ['--no-sandbox']);
  let aborted = false; root.interceptor({ url: () => 'https://example.invalid', abort: () => { aborted = true; } });
  assert.equal(aborted, true); assert.equal(root.closed, true);
  const user = {};
  assert.equal(await ensureFontLoaded({ stageDir: '.', launch: fakeBrowser(user), isLinuxRoot: () => false }), true);
  assert.equal(user.options.args, undefined);
});
