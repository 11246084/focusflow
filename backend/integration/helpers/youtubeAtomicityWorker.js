const { env, deferred, fakeYouTube } = require('./youtubeReviewFixture');
const mongoose = require('mongoose');
const { assertLoopbackMongoUri } = require('./isolatedYouTubeMongo');
process.once('message', async (config) => {
  try {
    assertLoopbackMongoUri(config.uri);
    if (!/^focusflow_youtube_test_[a-f0-9]{16}$/.test(config.dbName)) throw new Error('Unowned test database');
    env.uploadDir = config.root;
    await mongoose.connect(config.uri, { dbName: config.dbName, autoIndex: false, autoCreate: false, directConnection: true });
    const gate = deferred();
    process.on('message', (m) => { if (m === 'continue') gate.resolve(); });
    const pause = async () => { process.send({ event: 'ready' }); await gate.promise; };
    let result;
    if (config.action === 'repair') {
      const model = require(`../../src/models/${config.kind === 'video' ? 'video' : 'shortAsset'}.model`);
      const original = model.findOneAndUpdate;
      let first = true;
      model.findOneAndUpdate = async function (...args) {
        if (first && config.pause) { first = false; await pause(); }
        const value = await original.apply(this, args);
        if (config.pauseAfterClaim && args[1].$set?.['youtubeUpload.cleanupIntent.phase'] === 'recovering') await pause();
        return value;
      };
      result = await require('../../src/services/localSourceCleanup.service').repairCleanupIntents();
    } else if (config.action === 'cleanup') {
      if (config.pauseAt === 'before-unlink') {
        const Setting = require('../../src/models/runtimeSetting.model'); const original = Setting.findOne; let reads = 0;
        Setting.findOne = function (...args) {
          const q = original.apply(this, args); if (++reads !== 2) return q;
          return { lean: async () => { const value = await q.lean(); await pause(); return value; } };
        };
      } else {
        const model = require(`../../src/models/${config.kind === 'video' ? 'video' : 'shortAsset'}.model`);
        const original = model.findOneAndUpdate;
        model.findOneAndUpdate = async function (...args) {
          if (args[1].$set?.['youtubeUpload.localCleanupAt']) await pause();
          return original.apply(this, args);
        };
      }
      result = config.kind === 'video'
        ? await require('../../src/services/youtubeUpload.service').cleanupUploadedLocalVideo(config.id)
        : await require('../../src/services/shortAssetCleanup.service').cleanupShortAssetLocalFile(config.id);
    } else if (config.action === 'rollback') {
      result = await require('../../src/services/shortAsset.service').rollbackCourseDeletionArchive([
        { assetId: config.id, status: 'draft', archivedAt: new Date(config.archivedAt) },
      ]);
    } else if (config.action === 'delete-course') {
      env.youtubePrivatizeOnDelete = false;
      if (config.pauseAt === 'before-write') {
        const Course = require('../../src/models/course.model'); const original = Course.findOneAndUpdate; let first = true;
        Course.findOneAndUpdate = async function (...args) { if (first) { first = false; await pause(); } return original.apply(this, args); };
      } else if (config.pauseAt === 'in-transaction') {
        const Faq = require('../../src/models/faq.model'); const original = Faq.deleteMany;
        Faq.deleteMany = async function (...args) { const value = await original.apply(this, args); await pause(); return value; };
      } else if (config.pauseAt === 'after-commit') {
        const original = mongoose.connection.transaction.bind(mongoose.connection);
        mongoose.connection.transaction = async (...args) => { const value = await original(...args); await pause(); return value; };
      }
      result = await require('../../src/services/course.service').deleteCourse(config.courseId, { id: config.teacherId, role: 'admin' });
    } else if (config.action === 'jobs') {
      env.youtubePrivatizeOnDelete = true;
      const upload = require('../../src/services/youtubeUpload.service'); const fake = fakeYouTube();
      const fetchImpl = async (url, options = {}) => {
        if (options.method === 'PUT' && String(url).startsWith(upload.YOUTUBE_VIDEOS_URL)) {
          await mongoose.connection.db.collection('testRemoteWrites').insertOne(JSON.parse(options.body));
          if (config.pauseAfterRemote) await pause();
        }
        return fake(url, options);
      };
      result = await require('../../src/services/courseDeletionJobs.service').runCourseDeletionJobs({ fetchImpl });
    } else throw new Error('Unknown atomicity worker action');
    process.send({ event: 'result', result });
  } catch (error) { process.send({ event: 'error', error: { message: error.message, code: error.code } }); }
  finally { await mongoose.disconnect(); process.disconnect(); }
});
