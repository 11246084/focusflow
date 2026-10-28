const { EventEmitter } = require('node:events');
let spawned = 0; const fakeChildren = [];
require('node:child_process').spawn = () => {
  spawned += 1; const child = new EventEmitter(); child.pid = 12345; child.unref = () => {}; fakeChildren.push(child); return child;
};
const { env, deferred } = require('./youtubeReviewFixture');
const mongoose = require('mongoose');
const path = require('node:path');
const { assertLoopbackMongoUri } = require('./isolatedYouTubeMongo');
process.once('message', async (config) => {
  try {
    assertLoopbackMongoUri(config.uri);
    if (!/^focusflow_youtube_test_[a-f0-9]{16}$/.test(config.dbName)) throw new Error('Unowned database');
    await mongoose.connect(config.uri, { dbName: config.dbName, autoIndex: false, autoCreate: false });
    env.uploadDir = config.root; env.projectRoot = path.join(config.root, 'backend'); env.mongodbUri = config.uri;
    const gate = deferred(); process.on('message', (message) => { if (message === 'continue') gate.resolve(); });
    const pause = async () => { process.send({ event: 'ready' }); await gate.promise; };
    if (config.action === 'reprocess') {
      const Video = require('../../src/models/video.model'); const original = Video.findOneAndUpdate; let first = true;
      Video.findOneAndUpdate = async function (...args) {
        if (first && args[1].$set?.['processing.status'] === 'queued') { first = false; await pause(); }
        return original.apply(this, args);
      };
      // Exercise the production scheduling path with only spawn mocked. Both
      // pipeline logs and source files stay under the suite-owned temp root.
      process.env.NODE_ENV = 'review'; env.processingWebhookSecret = 'isolated-f3-mock-only'; env.videoProcessingConcurrency = 1;
      await require('../../src/services/video.service').retryExistingVideoProcessing(config.id, { id: config.userId, role: config.role || 'teacher' });
      for (const child of fakeChildren) child.emit('close', 0, null);
      await new Promise(resolve => setImmediate(resolve));
      process.send({ event: 'result', spawned });
    } else if (config.action === 'history') {
      const Setting = require('../../src/models/runtimeSetting.model'); const original = Setting.findOne; let first = true;
      Setting.findOne = function (...args) { const query = original.apply(this, args); return { lean: async () => {
        const value = await query.lean(); if (first) { first = false; await pause(); } return value;
      } }; };
      const service = require('../../src/services/youtubeLifecycleSettings.service');
      for (const enabled of config.values) await service.setYouTubeLifecycleSwitch({ key: 'upload', enabled, user: { id: config.userId, email: config.email } });
      process.send({ event: 'result' });
    } else throw new Error('Unknown action');
  } catch (error) { process.send({ event: 'error', code: error.code, message: error.message, spawned }); }
  finally { await mongoose.disconnect(); process.disconnect(); }
});
