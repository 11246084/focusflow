'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createRenderer } = require('../src/worker/render');
const { createCommandRunner, toolEnvironment } = require('../src/worker/process');
const { ensureFontLoaded } = require('../src/render/browser');
const { fixture } = require('./sentence.fixture');

test('真實adapter串接RC5與實測檢查器，各外部工具均可完整注入fake', async () => {
  const { plan, source, resolved } = fixture(), calls = [], signal = new AbortController().signal;
  const browserExecutable = path.resolve('synthetic-chrome.exe'), fontFile = path.resolve('synthetic-font.ttf');
  const renderer = createRenderer({ browserExecutable, fontFile, ffmpeg: 'pinned-ffmpeg', ffprobe: 'pinned-ffprobe' }, {
    runCommand: async (binary, args, options) => { calls.push('exec'); assert.equal(options.signal, signal); assert.equal(options.env.HYPERFRAMES_BROWSER_PATH, browserExecutable); assert(args.includes('render')); return { stdout: '', stderr: '' }; },
    stage: async (options) => { calls.push('stage'); assert.equal(options.plan, plan); assert.equal(options.resolveFont(), fontFile); return '/fake-stage'; },
    render: async (options) => {
      calls.push('render'); assert.equal(await options.ensureFontLoaded({ stageDir: '/fake-stage' }), true);
      await options.hyperframesImpl(['render', '.'], '/fake-stage'); return '/fake-stage/final.mp4';
    },
    fontCheck: async (options) => { calls.push('font'); assert.equal(options.signal, signal); assert.equal(options.browserExecutable, browserExecutable); return true; },
    inspect: async (options) => { calls.push('inspect'); assert.equal(options.fontLoaded, true); assert.equal(options.ffprobe, 'pinned-ffprobe'); return { observed: true }; },
  });
  const output = await renderer({ job: { plan, source }, resolved, sourcePath: '/synthetic.mp4', outDir: '/fake-out', signal });
  assert.deepEqual(calls, ['stage', 'render', 'font', 'exec', 'inspect']); assert.deepEqual(output.checks, { observed: true });
});
test('renderer必須指定既有browser與font，沒有自動安裝或fake預設', () => {
  assert.throws(() => createRenderer({}), { code: 'RECUT_RENDER_CONFIG_INVALID' });
});
test('已取消的adapter不啟動stage或執行工具', async () => {
  const controller = new AbortController(); controller.abort();
  const renderer = createRenderer({ browserExecutable: path.resolve('browser'), fontFile: path.resolve('font') }, { stage: () => assert.fail('must not stage') });
  await assert.rejects(renderer({ signal: controller.signal }), { name: 'AbortError' });
});
test('browser字型驗證在取消時關閉自己開啟的browser', async () => {
  const controller = new AbortController(); let closed = 0;
  const browser = { close: async () => { closed++; }, newPage: async () => {
    controller.abort(); controller.signal.throwIfAborted();
  } };
  await assert.rejects(ensureFontLoaded({ stageDir: '/fake-stage', signal: controller.signal, launch: async () => browser }), { name: 'AbortError' });
  assert(closed >= 1);
});
function child() {
  const process = new EventEmitter(); process.pid = 321; process.exitCode = null;
  process.stdout = new PassThrough(); process.stderr = new PassThrough(); process.kill = () => process.emit('close', 1);
  return process;
}
test('Windows取消會終止自己spawn的整棵process tree並等close才釋放', async () => {
  const controller = new AbortController(), main = child(), calls = []; let closed = false;
  const execute = createCommandRunner({ platform: 'win32', spawnImpl: (binary, args, options) => {
    calls.push({ binary, args, options });
    if (binary === 'taskkill.exe') {
      const killer = new EventEmitter();
      setImmediate(() => { closed = true; main.emit('close', 1); killer.emit('close', 0); });
      return killer;
    }
    return main;
  } });
  const result = execute('fake-renderer', [], { signal: controller.signal }); controller.abort();
  await assert.rejects(result, { name: 'AbortError' }); assert.equal(closed, true);
  assert.deepEqual(calls[1].args, ['/PID', '321', '/T', '/F']); assert.equal(calls[1].options.windowsHide, true);
});
test('POSIX取消只終止自己的process group，不遺留renderer子程序', async () => {
  const controller = new AbortController(), main = child(); let killed;
  const execute = createCommandRunner({ platform: 'linux', spawnImpl: () => main,
    killGroup: (pid, signal) => { killed = [pid, signal]; setImmediate(() => main.emit('close', 1)); } });
  const result = execute('fake-renderer', [], { signal: controller.signal }); controller.abort();
  await assert.rejects(result, { name: 'AbortError' }); assert.deepEqual(killed, [-321, 'SIGKILL']);
});
test('正常exec收集原始測值；失敗不把stderr的秘密或路徑放進錯誤', async () => {
  const main = child();
  const execute = createCommandRunner({ spawnImpl: () => main });
  const result = execute('fake-probe', []); main.stdout.write('observed'); main.stderr.write('private-path'); main.emit('close', 0);
  assert.deepEqual(await result, { stdout: 'observed', stderr: 'private-path' });
  const failed = execute('fake-probe', []); main.emit('close', 1);
  await assert.rejects(failed, (error) => error.code === 'RECUT_RENDER_TRANSIENT' && !error.message.includes('private-path'));
});
test('工具環境只保留OS路徑，不傳worker金鑰或其他app秘密', () => {
  assert.deepEqual(toolEnvironment({ Path: 'synthetic-path', SystemRoot: 'synthetic-windows', RECUT_WORKER_KEY: 'synthetic-key', OTHER_SECRET: 'synthetic-secret' }),
    { Path: 'synthetic-path', SystemRoot: 'synthetic-windows' });
});
