const { env, deferred, fakeYouTube } = require('./youtubeReviewFixture');
const mongoose = require('mongoose');
const { assertLoopbackMongoUri } = require('./isolatedYouTubeMongo');
const quarantine = require('../../src/services/youtubeQuarantine.service');
const shortService = require('../../src/services/shortAsset.service');
const shortRecovery = require('../../src/services/shortAssetRecovery.service');
const upload = require('../../src/services/youtubeUpload.service');
process.once('message', async (config) => {
  try {
    assertLoopbackMongoUri(config.uri);
    if (!/^focusflow_youtube_test_[a-f0-9]{16}$/.test(config.dbName)) throw new Error('Unowned test database');
    env.uploadDir = config.root;
    await mongoose.connect(config.uri, { dbName: config.dbName, autoIndex: false, autoCreate: false, directConnection: true });
    let result;
    if (config.action === 'apply') {
      const gate = deferred(); process.on('message', (m) => { if (m === 'continue') gate.resolve(); });
      result = await quarantine.applyQuarantinedItem({ kind: config.kind, id: config.id, youtubeVideoId: 'sharedYt001',
        fetchImpl: fakeYouTube({ waitVerify: async () => { process.send({ event: 'ready' }); await gate.promise; } }) });
    } else if (config.action === 'rollback') {
      result = await shortService.rollbackCourseDeletionArchive([{ assetId: config.id, status: 'draft', archivedAt: new Date(config.archivedAt) }]);
    } else if (config.action === 'regenerate') {
      result = await shortService.recordShortAssetRegeneration(config.id, { filePath: config.filePath, youtubeVideoId: null });
    } else if (config.action === 'recover') {
      result = config.kind === 'short_asset'
        ? await shortRecovery.recoverShortAssetUploads({ now: new Date(Date.now() + 10_000), fetchImpl: fakeYouTube() })
        : await upload.recoverPendingYouTubeUploads({ now: new Date(Date.now() + 10_000), fetchImpl: fakeYouTube() });
    } else throw new Error('Unknown worker action');
    process.send({ event: 'result', result });
  } catch (error) { process.send({ event: 'error', error: { message: error.message, code: error.code } }); }
  finally { await mongoose.disconnect(); process.disconnect(); }
});
