const { EventEmitter } = require('events');
const { mkdtempSync, openSync, readFileSync, rmSync } = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  attachSttProcessLifecycle,
  buildSttProcessEnvironment,
} = require('../src/services/sttProcessLifecycle.service');

const temporaryDirectories = [];

function createLogFile() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'focusflow-stt-lifecycle-'));
  temporaryDirectories.push(directory);
  const logPath = path.join(directory, 'pipeline.log');
  return {
    logFd: openSync(logPath, 'a'),
    logPath,
  };
}

function waitForEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('STT child process lifecycle', () => {
  afterEach(() => {
    while (temporaryDirectories.length) {
      rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
    }
  });

  it('正常退出時記錄 exit code 且不標記失敗', async () => {
    const sttProcess = new EventEmitter();
    const { logFd, logPath } = createLogFile();
    const failures = [];

    attachSttProcessLifecycle({
      sttProcess,
      logFd,
      videoId: 'video_001',
      onUnexpectedExit: async (failure) => failures.push(failure),
    });

    sttProcess.emit('exit', 0, null);
    sttProcess.emit('close', 0, null);
    await waitForEventLoop();

    assert.deepEqual(failures, []);
    assert.match(readFileSync(logPath, 'utf8'), /pipeline close.*exit code=0 signal=none/);
  });

  it('非零退出時記錄原因並標記失敗', async () => {
    const sttProcess = new EventEmitter();
    const { logFd, logPath } = createLogFile();
    let failure;

    attachSttProcessLifecycle({
      sttProcess,
      logFd,
      videoId: 'video_002',
      onUnexpectedExit: async (details) => { failure = details; },
    });

    sttProcess.emit('exit', 1, null);
    sttProcess.emit('close', 1, null);
    await waitForEventLoop();

    assert.equal(failure.errorCode, 'PIPELINE_PROCESS_EXITED');
    assert.match(failure.errorMessage, /exit code=1 signal=none/);
    assert.match(readFileSync(logPath, 'utf8'), /pipeline exit.*code=1/);
  });

  it('spawn error 後只在 close 時回報一次失敗', async () => {
    const sttProcess = new EventEmitter();
    const { logFd } = createLogFile();
    let failureCount = 0;

    attachSttProcessLifecycle({
      sttProcess,
      logFd,
      videoId: 'video_003',
      onUnexpectedExit: async () => { failureCount += 1; },
    });

    sttProcess.emit('error', new Error('python executable missing'));
    sttProcess.emit('close', -1, null);
    await waitForEventLoop();

    assert.equal(failureCount, 1);
  });
});

describe('STT child process environment', () => {
  it('移除 Backend 的空 Gemini Key，讓 STT dotenv 可載入自己的設定', () => {
    const environment = buildSttProcessEnvironment(
      { GEMINI_API_KEY: '', PATH: 'test-path' },
      { BACKEND_URL: 'http://localhost:4000' },
    );

    assert.equal(Object.hasOwn(environment, 'GEMINI_API_KEY'), false);
    assert.equal(environment.PATH, 'test-path');
    assert.equal(environment.BACKEND_URL, 'http://localhost:4000');
  });

  it('保留明確設定的非空 Gemini Key', () => {
    const environment = buildSttProcessEnvironment(
      { GEMINI_API_KEY: 'configured-key' },
      {},
    );

    assert.equal(environment.GEMINI_API_KEY, 'configured-key');
  });
});
