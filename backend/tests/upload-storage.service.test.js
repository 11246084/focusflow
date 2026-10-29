const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const env = require('../src/config/env');
const RuntimeSetting = require('../src/models/runtimeSetting.model');
const storage = require('../src/services/uploadStorage.service');

test('concurrent reservations use version checks and release space', async () => {
  const old = { dir: env.uploadDir, min: env.uploadMinFreeGb, factor: env.uploadSpaceFactor, findOne: RuntimeSetting.findOne, create: RuntimeSetting.create, updateOne: RuntimeSetting.updateOne };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-space-'));
  let doc = null;
  try {
    env.uploadDir = dir;
    env.uploadSpaceFactor = 1;
    const stat = fs.statfsSync(dir);
    const free = Number(stat.bavail) * Number(stat.bsize);
    env.uploadMinFreeGb = (free - 100000) / 1024 ** 3;
    RuntimeSetting.findOne = () => ({ lean: async () => doc && structuredClone(doc) });
    RuntimeSetting.create = async (data) => { if (doc) { const error = new Error('duplicate'); error.code = 11000; throw error; } doc = structuredClone(data); };
    RuntimeSetting.updateOne = async (query, update) => {
      if (doc.value.version !== query['value.version']) return { modifiedCount: 0 };
      doc.value = structuredClone(update.$set.value);
      return { modifiedCount: 1 };
    };
    const results = await Promise.allSettled([storage.reserve(70000), storage.reserve(70000)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected')[0].reason.code, 'UPLOAD_STORAGE_LOW');
    const token = results.find((r) => r.status === 'fulfilled').value;
    assert.equal((await storage.status()).reservedBytes, 70000);
    await storage.heartbeat(token);
    await storage.release(token);
    assert.equal((await storage.status()).reservedBytes, 0);
  } finally {
    env.uploadDir = old.dir; env.uploadMinFreeGb = old.min; env.uploadSpaceFactor = old.factor;
    RuntimeSetting.findOne = old.findOne; RuntimeSetting.create = old.create; RuntimeSetting.updateOne = old.updateOne;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
