'use strict';
const assert = require('node:assert/strict');
const { describe, it, afterEach } = require('node:test');
const env = require('../src/config/env');
const { createGeminiKeyStore } = require('../src/services/geminiKeyStore.service');

const OLD_KEY = 'environment-key-0000000000000000';
const NEW_KEY = 'AIzaRotatedCandidateKey_0123456789ab';
const FILE = '/srv/focusflow-secrets/gemini-key.json';
const DIR = '/srv/focusflow-secrets';

function fakeEnv(extra = {}) {
  let resolver = null;
  return {
    projectRoot: '/srv/checkout/backend',
    uploadDir: '/var/focusflow/uploads',
    avatarUploadDir: '/var/focusflow/private-avatars',
    geminiKeyOverrideFile: '',
    geminiEnvironmentApiKey: OLD_KEY,
    setGeminiApiKeyOverride(fn) { resolver = fn; },
    get geminiApiKey() { return resolver?.() || this.geminiEnvironmentApiKey; },
    ...extra,
  };
}

function fakeFs(entries = {}, { failWrite = false, failRename = false } = {}) {
  const nodes = new Map(Object.entries(entries));
  const ops = [];
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  const statOf = (node) => ({
    isDirectory: () => node.type === 'dir', isFile: () => node.type === 'file', isSymbolicLink: () => node.type === 'link',
    mode: node.mode, uid: node.uid ?? 1000, size: String(node.content || '').length,
  });
  return {
    nodes, ops,
    lstat: async (p) => { const node = nodes.get(p); if (!node) throw enoent(); return statOf(node); },
    mkdir: async (p, options) => { ops.push(['mkdir', p, options.mode]); nodes.set(p, { type: 'dir', mode: options.mode, uid: 1000 }); },
    realpath: async (p) => p,
    readFile: async (p) => { const node = nodes.get(p); if (!node) throw enoent(); return node.content; },
    open: async (p, flags, mode) => {
      ops.push(['open', p, flags, mode]);
      if (flags === 'r') return { sync: async () => { ops.push(['dirsync', p]); }, close: async () => {} };
      if (nodes.has(p)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      const node = { type: 'file', mode, uid: 1000, content: '' }; nodes.set(p, node);
      return {
        writeFile: async (data) => { if (failWrite) throw new Error('disk full'); node.content = data; },
        chmod: async (m) => { node.mode = m; ops.push(['chmod', p, m]); },
        sync: async () => { ops.push(['sync', p]); },
        close: async () => { ops.push(['close', p]); },
      };
    },
    rename: async (from, to) => { ops.push(['rename', from, to]); if (failRename) throw new Error('EXDEV'); nodes.set(to, nodes.get(from)); nodes.delete(from); },
    unlink: async (p) => { ops.push(['unlink', p]); nodes.delete(p); },
  };
}

const unixStore = (fsImpl, envModule = fakeEnv(), extra = {}) => createGeminiKeyStore({
  envModule, fsImpl, platform: 'linux', getUid: () => 1000, ...extra,
});

describe('Gemini 金鑰主機本機保存', () => {
  afterEach(() => env.setGeminiApiKeyOverride(null));

  it('未初始化（CLI）或尚未輪替時沿用環境變數；初始化不會改變現值', async () => {
    const envModule = fakeEnv();
    const store = unixStore(fakeFs(), envModule);
    assert.equal(envModule.geminiApiKey, OLD_KEY);
    await assert.rejects(store.activate(NEW_KEY), { code: 'GEMINI_KEY_ROTATION_UNAVAILABLE' });
    const status = await store.initialize({ filePath: '' });
    assert.deepEqual({ source: status.source, persistence: status.persistence, rotationAvailable: status.rotationAvailable },
      { source: 'environment', persistence: 'memory', rotationAvailable: true });
    assert.equal(envModule.geminiApiKey, OLD_KEY);
    assert.equal(store.getRotatedKey(), '');
  });

  it('記憶體模式輪替後 env.geminiApiKey 立即改用新金鑰，狀態不含金鑰', async () => {
    const store = createGeminiKeyStore({ envModule: env, platform: process.platform });
    const original = env.geminiApiKey;
    try {
      await store.initialize({ filePath: '' });
      const result = await store.activate(NEW_KEY);
      assert.equal(env.geminiApiKey, NEW_KEY);
      assert.equal(store.getRotatedKey(), NEW_KEY);
      assert.equal(JSON.stringify({ result, status: store.getStatus() }).includes(NEW_KEY), false);
      assert.equal(store.getStatus().source, 'rotated');
      // Tests/CLI assignment keeps changing only the environment fallback.
      env.geminiApiKey = 'assigned-fallback-key-000000000';
      assert.equal(env.geminiApiKey, NEW_KEY);
    } finally { store.resetForTests(); env.geminiApiKey = original; }
    assert.equal(env.geminiApiKey, original);
  });

  it('拒絕相對路徑、checkout／uploads 內、.env 檔名，保留環境金鑰並停用輪替', async () => {
    for (const filePath of ['relative/key.json', '/srv/checkout/backend/private/key.json', '/srv/checkout/key.json', '/srv/checkout/..private/key.json',
      '/var/focusflow/uploads/key.json', '/srv/keys/.env', '/srv/keys/../keys/key.json']) {
      const envModule = fakeEnv();
      const store = unixStore(fakeFs({ '/srv/keys': { type: 'dir', mode: 0o700 } }), envModule);
      const status = await store.initialize({ filePath });
      assert.equal(status.rotationAvailable, false, filePath);
      assert.equal(status.storageError, 'GEMINI_KEY_STORAGE_PATH_INVALID', filePath);
      assert.equal(envModule.geminiApiKey, OLD_KEY);
      await assert.rejects(store.activate(NEW_KEY), { code: 'GEMINI_KEY_STORAGE_PATH_INVALID' });
    }
  });

  it('Unix 目錄須為本人擁有且 owner-only，不可為 symlink；缺少的最後一層以 0700 建立', async () => {
    for (const [node, uid] of [[{ type: 'dir', mode: 0o755 }, 1000], [{ type: 'dir', mode: 0o700, uid: 0 }, 1000], [{ type: 'link', mode: 0o700 }, 1000]]) {
      const store = unixStore(fakeFs({ [DIR]: node }), fakeEnv(), { getUid: () => uid });
      assert.equal((await store.initialize({ filePath: FILE })).storageError, 'GEMINI_KEY_STORAGE_PERMISSIONS_INVALID');
    }
    const fsImpl = fakeFs();
    const store = unixStore(fsImpl);
    const status = await store.initialize({ filePath: FILE });
    assert.equal(status.rotationAvailable, true);
    assert.deepEqual(fsImpl.ops[0], ['mkdir', DIR, 0o700]);
  });

  it('既有保存檔權限過寬、為 symlink 或內容損毀時不載入', async () => {
    const good = JSON.stringify({ schemaVersion: 1, apiKey: NEW_KEY, versionId: '00000000-0000-4000-8000-000000000001', activatedAt: '2026-11-20T00:00:00.000Z' });
    for (const [file, code] of [[{ type: 'file', mode: 0o644, content: good }, 'GEMINI_KEY_STORAGE_PERMISSIONS_INVALID'],
      [{ type: 'link', mode: 0o600, content: good }, 'GEMINI_KEY_STORAGE_PERMISSIONS_INVALID'],
      [{ type: 'file', mode: 0o600, content: '{not json' }, 'GEMINI_KEY_STORAGE_CORRUPT'],
      [{ type: 'file', mode: 0o600, content: JSON.stringify({ schemaVersion: 1, apiKey: 'short' }) }, 'GEMINI_KEY_STORAGE_CORRUPT']]) {
      const envModule = fakeEnv();
      const store = unixStore(fakeFs({ [DIR]: { type: 'dir', mode: 0o700 }, [FILE]: file }), envModule);
      assert.equal((await store.initialize({ filePath: FILE })).storageError, code);
      assert.equal(envModule.geminiApiKey, OLD_KEY);
    }
    const envModule = fakeEnv();
    const store = unixStore(fakeFs({ [DIR]: { type: 'dir', mode: 0o700 }, [FILE]: { type: 'file', mode: 0o600, content: good } }), envModule);
    const status = await store.initialize({ filePath: FILE });
    assert.equal(status.source, 'rotated'); assert.equal(status.persistence, 'file');
    assert.equal(envModule.geminiApiKey, NEW_KEY);
  });

  it('以 0600 暫存檔、fsync、rename 原子替換，並 fsync 目錄', async () => {
    const fsImpl = fakeFs({ [DIR]: { type: 'dir', mode: 0o700 }, [FILE]: { type: 'file', mode: 0o600,
      content: JSON.stringify({ schemaVersion: 1, apiKey: 'previous-rotated-key-0000000000', versionId: '00000000-0000-4000-8000-000000000001', activatedAt: '2026-11-20T00:00:00.000Z' }) } });
    const envModule = fakeEnv();
    const store = unixStore(fsImpl, envModule);
    await store.initialize({ filePath: FILE });
    await store.activate(NEW_KEY);
    const open = fsImpl.ops.find((op) => op[0] === 'open' && op[2] === 'wx');
    assert.ok(open[1].startsWith(`${DIR}/.gemini-key.json.`)); assert.equal(open[3], 0o600);
    const names = fsImpl.ops.map((op) => op[0]);
    assert.ok(names.indexOf('chmod') < names.indexOf('sync') && names.indexOf('sync') < names.indexOf('rename') && names.indexOf('rename') < names.indexOf('dirsync'));
    assert.deepEqual(fsImpl.ops.find((op) => op[0] === 'rename').slice(2), [FILE]);
    const persisted = fsImpl.nodes.get(FILE);
    assert.equal(persisted.mode, 0o600);
    assert.equal(JSON.parse(persisted.content).apiKey, NEW_KEY);
    assert.equal(envModule.geminiApiKey, NEW_KEY);
    assert.equal([...fsImpl.nodes.keys()].some((key) => key.endsWith('.tmp')), false);
  });

  it('寫入或 rename 失敗時清除暫存檔，金鑰維持原值且錯誤不含金鑰', async () => {
    for (const failure of [{ failWrite: true }, { failRename: true }]) {
      const fsImpl = fakeFs({ [DIR]: { type: 'dir', mode: 0o700 } }, failure);
      const envModule = fakeEnv();
      const store = unixStore(fsImpl, envModule);
      await store.initialize({ filePath: FILE });
      await assert.rejects(store.activate(NEW_KEY), (error) => error.code === 'GEMINI_KEY_STORAGE_FAILED' && !JSON.stringify(error).includes(NEW_KEY) && !error.message.includes(NEW_KEY));
      assert.equal(envModule.geminiApiKey, OLD_KEY);
      assert.equal(store.getStatus().source, 'environment');
      assert.equal([...fsImpl.nodes.keys()].some((key) => key.endsWith('.tmp')), false);
    }
  });

  it('並行啟用依序寫入，不會交錯', async () => {
    const fsImpl = fakeFs({ [DIR]: { type: 'dir', mode: 0o700 } });
    const store = unixStore(fsImpl);
    await store.initialize({ filePath: FILE });
    const second = 'AIzaSecondCandidateKey_0123456789abcd';
    await Promise.all([store.activate(NEW_KEY), store.activate(second)]);
    const sequence = fsImpl.ops.filter((op) => ['open', 'rename'].includes(op[0]) && op[2] !== 'r').map((op) => op[0]);
    assert.deepEqual(sequence, ['open', 'rename', 'open', 'rename']);
    assert.equal(store.getRotatedKey(), second);
  });

  it('格式不符的金鑰不寫入', async () => {
    const store = unixStore(fakeFs({ [DIR]: { type: 'dir', mode: 0o700 } }));
    await store.initialize({ filePath: FILE });
    for (const bad of ['', 'short', `${NEW_KEY}\r\nX-Injected: 1`, 'a b'.repeat(10)]) {
      await assert.rejects(store.activate(bad), { code: 'GEMINI_KEY_FORMAT_INVALID' });
    }
  });
});
