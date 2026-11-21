'use strict';

// Whole-site Gemini API key, host-local only.
//
// - Until the first rotation every consumer keeps using GEMINI_API_KEY from the
//   process environment (env.geminiEnvironmentApiKey).
// - After a rotation the active key lives in this process. When the operator set
//   GEMINI_KEY_OVERRIDE_FILE it is also persisted to that dedicated private file
//   (absolute path, outside the checkout and upload trees). On Unix the parent
//   directory must be owner-only and the file is replaced atomically with 0600.
// - Only the server entrypoint calls initialize(); offline CLI tools never see
//   the override and keep their own environment configuration.
// - Nothing here logs, returns or audits the key value.

const crypto = require('node:crypto');
const nodePath = require('node:path');
const AppError = require('../utils/appError');

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 4096;
const KEY_PATTERN = /^[A-Za-z0-9._-]{20,256}$/;
const VERSION_PATTERN = /^[0-9a-f-]{36}$/;

function storageError(code = 'GEMINI_KEY_STORAGE_FAILED') {
  return new AppError('Gemini key storage is unavailable.', 500, code);
}

function isValidKeyFormat(value) {
  return typeof value === 'string' && KEY_PATTERN.test(value);
}

function isSameOrDescendant(parent, candidate, pathImpl) {
  const relative = pathImpl.relative(pathImpl.resolve(parent), pathImpl.resolve(candidate));
  return relative !== '..' && !relative.startsWith(`..${pathImpl.sep}`) && !pathImpl.isAbsolute(relative);
}

function createGeminiKeyStore({
  envModule = require('../config/env'),
  fsImpl = require('node:fs/promises'),
  platform = process.platform,
  getUid = () => (typeof process.getuid === 'function' ? process.getuid() : null),
  randomUUID = () => crypto.randomUUID(),
  now = () => new Date(),
} = {}) {
  const unix = platform !== 'win32';
  const pathImpl = unix ? nodePath.posix : nodePath.win32;
  const state = { initialized: false, filePath: null, override: null, storageError: null };

  const forbiddenRoots = () => [
    pathImpl.resolve(envModule.projectRoot, '..'), // whole checkout (backend, frontend, STT_Whisper …)
    envModule.uploadDir,
    envModule.avatarUploadDir,
  ].filter(Boolean);

  function assertAllowedLocation(file) {
    if (forbiddenRoots().some((root) => isSameOrDescendant(root, file, pathImpl))) throw storageError('GEMINI_KEY_STORAGE_PATH_INVALID');
  }

  function validateConfiguredPath(file) {
    if (typeof file !== 'string' || !file || !pathImpl.isAbsolute(file) || /^[\\/]{2}/.test(file)
      || pathImpl.normalize(file) !== file || file.endsWith(pathImpl.sep)) throw storageError('GEMINI_KEY_STORAGE_PATH_INVALID');
    const base = pathImpl.basename(file);
    if (!base || /^\.env(?:\..*)?$/i.test(base) || /^CLAUDE\.local\.md$/i.test(base)) throw storageError('GEMINI_KEY_STORAGE_PATH_INVALID');
    assertAllowedLocation(file);
  }

  // Unix: the directory must be a real directory owned by this user with no
  // group/other bits. A missing leaf directory is created 0700; parents are not.
  async function prepareDirectory(directory) {
    let stat;
    try { stat = await fsImpl.lstat(directory); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw storageError();
      try { await fsImpl.mkdir(directory, { mode: 0o700 }); } catch { throw storageError(); }
      stat = await fsImpl.lstat(directory).catch(() => { throw storageError(); });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError('GEMINI_KEY_STORAGE_PERMISSIONS_INVALID');
    if (unix) {
      const uid = getUid();
      if ((uid !== null && stat.uid !== uid) || (stat.mode & 0o077) !== 0) throw storageError('GEMINI_KEY_STORAGE_PERMISSIONS_INVALID');
    }
    const real = await fsImpl.realpath(directory).catch(() => { throw storageError(); });
    assertAllowedLocation(real);
  }

  async function readPersisted(file) {
    let stat;
    try { stat = await fsImpl.lstat(file); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw storageError(); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw storageError('GEMINI_KEY_STORAGE_PERMISSIONS_INVALID');
    if (unix) {
      const uid = getUid();
      if ((uid !== null && stat.uid !== uid) || (stat.mode & 0o077) !== 0) throw storageError('GEMINI_KEY_STORAGE_PERMISSIONS_INVALID');
    }
    let record;
    try { record = JSON.parse(await fsImpl.readFile(file, 'utf8')); } catch { throw storageError('GEMINI_KEY_STORAGE_CORRUPT'); }
    if (!record || record.schemaVersion !== SCHEMA_VERSION || !isValidKeyFormat(record.apiKey)
      || !VERSION_PATTERN.test(String(record.versionId || '')) || Number.isNaN(Date.parse(record.activatedAt))) {
      throw storageError('GEMINI_KEY_STORAGE_CORRUPT');
    }
    return { apiKey: record.apiKey, versionId: record.versionId, activatedAt: record.activatedAt };
  }

  async function writeAtomic(file, record) {
    const directory = pathImpl.dirname(file);
    await prepareDirectory(directory);
    const temporary = pathImpl.join(directory, `.${pathImpl.basename(file)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    let handle;
    try {
      // 'wx' refuses to follow or reuse an existing path (including symlinks).
      handle = await fsImpl.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...record }), 'utf8');
      if (unix) await handle.chmod(0o600);
      await handle.sync();
      await handle.close(); handle = null;
      await fsImpl.rename(temporary, file);
      if (unix) {
        // Persist the rename itself; best effort where directories cannot be opened.
        const dir = await fsImpl.open(directory, 'r').catch(() => null);
        if (dir) { await dir.sync().catch(() => {}); await dir.close().catch(() => {}); }
      }
    } catch {
      if (handle) await handle.close().catch(() => {});
      await fsImpl.unlink(temporary).catch(() => {});
      throw storageError();
    }
  }

  async function initialize({ filePath = envModule.geminiKeyOverrideFile } = {}) {
    state.initialized = true; state.filePath = null; state.override = null; state.storageError = null;
    envModule.setGeminiApiKeyOverride(() => state.override?.apiKey || '');
    if (!filePath) return getStatus();
    try {
      validateConfiguredPath(filePath);
      await prepareDirectory(pathImpl.dirname(filePath));
      state.filePath = filePath;
      state.override = await readPersisted(filePath);
    } catch (error) {
      // Fail closed for rotation only: the environment key keeps serving and
      // the admin page reports the fixed storage code.
      state.filePath = null; state.override = null;
      state.storageError = /^GEMINI_KEY_STORAGE_[A-Z_]+$/.test(error?.code || '') ? error.code : 'GEMINI_KEY_STORAGE_FAILED';
    }
    return getStatus();
  }

  function currentVersion() {
    if (state.override) return state.override.versionId;
    return envModule.geminiEnvironmentApiKey ? 'environment' : 'none';
  }

  // Writes are serialized so two activations can never interleave file replacement.
  let writeChain = Promise.resolve();
  function activate(apiKey) {
    const run = writeChain.then(() => activateNow(apiKey));
    writeChain = run.catch(() => {});
    return run;
  }

  // Persist first, then swap in memory: a failed write never changes the key in use.
  async function activateNow(apiKey) {
    if (!state.initialized) throw new AppError('Gemini key rotation is not enabled in this process.', 503, 'GEMINI_KEY_ROTATION_UNAVAILABLE');
    if (state.storageError) throw storageError(state.storageError);
    if (!isValidKeyFormat(apiKey)) throw new AppError('Gemini API key format is invalid.', 400, 'GEMINI_KEY_FORMAT_INVALID');
    const record = { apiKey, versionId: randomUUID(), activatedAt: now().toISOString() };
    if (state.filePath) await writeAtomic(state.filePath, record);
    state.override = record;
    return { versionId: record.versionId, activatedAt: record.activatedAt };
  }

  function getStatus() {
    const source = state.override ? 'rotated' : (envModule.geminiEnvironmentApiKey ? 'environment' : 'none');
    return {
      source,
      versionId: currentVersion(),
      activatedAt: state.override?.activatedAt || null,
      persistence: state.filePath ? 'file' : 'memory',
      rotationAvailable: state.initialized && !state.storageError,
      storageError: state.storageError,
    };
  }

  return {
    initialize,
    activate,
    getStatus,
    currentVersion,
    // Used by backend-launched STT so the child receives the rotated key.
    getRotatedKey: () => state.override?.apiKey || '',
    isInitialized: () => state.initialized,
    resetForTests() {
      state.initialized = false; state.filePath = null; state.override = null; state.storageError = null;
      envModule.setGeminiApiKeyOverride(null);
    },
  };
}

const geminiKeyStore = createGeminiKeyStore();

module.exports = { createGeminiKeyStore, geminiKeyStore, isValidKeyFormat, KEY_PATTERN };
