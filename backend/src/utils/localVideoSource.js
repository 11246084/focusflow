const fs = require('fs');
const path = require('path');

function resolveLocalUploadPath(filePath) {
  const env = require('../config/env');
  return path.resolve(env.projectRoot, String(filePath || ''));
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function pathKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

// 缺檔也辨識真正的父目錄；不能把 junction 外的缺檔誤認成根目錄內。
function realPathIncludingMissing(target) {
  try { return fs.realpathSync.native(target); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(target);
    if (parent === target) throw error;
    return path.join(realPathIncludingMissing(parent), path.basename(target));
  }
}

function inspectLocalUploadFile(filePath) {
  const env = require('../config/env');
  const root = path.resolve(env.uploadDir);
  const realRoot = fs.realpathSync.native(root);
  const localPath = resolveLocalUploadPath(filePath);
  const realPath = realPathIncludingMissing(localPath);
  let stats = null;
  try { stats = fs.statSync(localPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let linked = false;
  if (isInside(root, localPath)) {
    let current = root;
    for (const component of path.relative(root, localPath).split(path.sep)) {
      current = path.join(current, component);
      try { if (fs.lstatSync(current).isSymbolicLink()) linked = true; } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return {
    localPath, realPath,
    // 根目錄本身、目錄、根外與連結均不可刪；引用辨識仍保留其實體身份。
    safe: Boolean(filePath) && isInside(root, localPath) && isInside(realRoot, realPath)
      && !linked && (!stats || stats.isFile()),
    exists: Boolean(stats),
    sizeBytes: stats?.size || 0,
    pathKey: pathKey(realPath),
    physicalKey: stats?.ino ? `${stats.dev}:${stats.ino}` : null,
    fingerprint: stats ? `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}` : 'missing',
  };
}

function sameLocalFile(left, right) {
  return left.pathKey === right.pathKey
    || Boolean(left.physicalKey && left.physicalKey === right.physicalKey);
}

function isLocalVideoSourceAvailable(filePath) {
  if (!filePath) return false;
  try { const file = inspectLocalUploadFile(filePath); return file.safe && file.exists; } catch { return false; }
}

module.exports = { inspectLocalUploadFile, isLocalVideoSourceAvailable, resolveLocalUploadPath, sameLocalFile };
