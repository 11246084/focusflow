const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const RuntimeSetting = require('../models/runtimeSetting.model');
const env = require('../config/env');
const AppError = require('../utils/appError');
const LEASE_MS = 2 * 60 * 60 * 1000;
const active = new Set();

async function identity() {
  await fs.promises.mkdir(env.uploadDir, { recursive: true });
  const root = await fs.promises.realpath(env.uploadDir);
  const stat = await fs.promises.stat(root);
  return { root, key: `upload_storage:${os.hostname()}:${root}:${stat.dev}` };
}
async function available(root) {
  const stats = await fs.promises.statfs(root);
  return Number(stats.bavail) * Number(stats.bsize);
}
async function mutate(fn) {
  const { root, key } = await identity();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let doc = await RuntimeSetting.findOne({ key }).lean();
    if (!doc) {
      try { await RuntimeSetting.create({ key, value: { version: 0, reservations: [] } }); } catch (error) { if (error.code !== 11000) throw error; }
      continue;
    }
    const version = doc.value?.version || 0;
    const now = Date.now();
    const reservations = (doc.value?.reservations || []).filter((r) => new Date(r.expiresAt).getTime() > now);
    const result = await fn(reservations, root);
    const updated = await RuntimeSetting.updateOne({ key, 'value.version': version }, { $set: { value: { version: version + 1, reservations } } });
    if (updated.modifiedCount === 1) return result;
  }
  throw new AppError('Upload storage reservation is busy.', 503, 'UPLOAD_STORAGE_BUSY');
}
async function reserve(bytes) {
  const token = crypto.randomUUID();
  await mutate(async (reservations, root) => {
    const free = await available(root);
    const reserved = reservations.reduce((total, item) => total + item.bytes, 0);
    const factor = env.uploadSpaceFactor ?? 1;
    const minimum = (env.uploadMinFreeGb ?? 5) * 1024 ** 3;
    if (free - reserved - bytes * factor < minimum) throw new AppError('Insufficient upload storage.', 507, 'UPLOAD_STORAGE_LOW');
    reservations.push({ token, bytes: Math.ceil(bytes * factor), expiresAt: new Date(Date.now() + LEASE_MS) });
  });
  active.add(token);
  return token;
}
async function heartbeat(token) {
  return mutate(async (reservations) => {
    const reservation = reservations.find((r) => r.token === token);
    if (!reservation) throw new AppError('Upload reservation expired.', 503, 'UPLOAD_RESERVATION_EXPIRED');
    reservation.expiresAt = new Date(Date.now() + LEASE_MS);
  });
}
async function release(token) {
  active.delete(token);
  return mutate(async (reservations) => {
    const index = reservations.findIndex((r) => r.token === token);
    if (index >= 0) reservations.splice(index, 1);
  });
}
async function status() {
  const { root, key } = await identity();
  const [freeBytes, doc] = await Promise.all([available(root), RuntimeSetting.findOne({ key }).lean()]);
  const reservedBytes = (doc?.value?.reservations || []).filter((r) => new Date(r.expiresAt).getTime() > Date.now()).reduce((sum, r) => sum + r.bytes, 0);
  const minimumFreeBytes = (env.uploadMinFreeGb ?? 5) * 1024 ** 3;
  return { freeBytes, reservedBytes, minimumFreeBytes, availableBytes: Math.max(0, freeBytes - reservedBytes - minimumFreeBytes) };
}
async function cleanupIncoming() {
  const { root, key } = await identity();
  const incoming = path.join(root, '.incoming');
  await fs.promises.mkdir(incoming, { recursive: true });
  const actual = await fs.promises.realpath(incoming);
  if (actual !== incoming) throw new Error('Incoming directory resolves outside upload directory.');
  const doc = await RuntimeSetting.findOne({ key }).lean();
  if (!doc || !Array.isArray(doc.value?.reservations)) { console.error('Cannot verify incoming reservations; cleanup skipped.'); return; }
  const reservations = doc.value.reservations;
  for (const entry of await fs.promises.readdir(incoming, { withFileTypes: true })) {
    try {
      const token = entry.name.split('--')[0];
      if (!entry.isFile() || !/^[0-9a-f-]{36}$/.test(token)) { console.error('Cannot identify incoming upload safely:', entry.name); continue; }
      if (active.has(token) || reservations.some((r) => r.token === token && new Date(r.expiresAt).getTime() > Date.now())) continue;
      const file = path.join(incoming, entry.name);
      if ((await fs.promises.realpath(file)) !== file) continue;
      const stat = await fs.promises.stat(file);
      if (Date.now() - stat.mtimeMs > 3 * 60 * 60 * 1000) await fs.promises.unlink(file);
    } catch (error) { console.error('Cannot safely clean an incoming upload.', error.message); }
  }
}
async function warnLowSpace() {
  const { notifyYouTubeSystemEvent } = require('./notification.service');
  const data = await status();
  if (data.freeBytes >= 2 * env.youtubeUploadCleanupMinFreeGb * 1024 ** 3) return;
  const day = new Date().toISOString().slice(0, 10);
  await notifyYouTubeSystemEvent({ dedupeKey: `upload_storage_low:${day}`, title: '影片儲存空間不足', content: '影片儲存空間低於預警門檻，請管理員檢查。', urgent: true });
}
module.exports = { reserve, heartbeat, release, status, cleanupIncoming, identity, warnLowSpace };
