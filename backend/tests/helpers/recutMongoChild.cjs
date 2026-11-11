// Only launched by the opt-in loopback test. Never loads application configuration.
require('./noDotenv.cjs');
const mongoose = require('mongoose');
const { assertLoopbackMongoTarget } = require('../../src/services/recutRuntime.service');
const [uri, operation, scriptId, workerId] = process.argv.slice(2);
const target = assertLoopbackMongoTarget(uri);
if (target.host !== '127.0.0.1' || target.port !== 27029 || !target.database.startsWith('recut_delivery_test_')) throw new Error('Isolated Mongo target required.');
(async () => {
  try {
    await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 3000 });
    if (operation === 'lock') {
      const { withRecutTransition } = require('../../src/services/recutState.service');
      await withRecutTransition(scriptId, async () => { process.send({ locked: true }); await new Promise((resolve) => process.once('message', resolve)); });
      process.send({ ok: true });
    } else if (operation === 'claim') {
      const Worker = require('../../src/models/recutWorker.model');
      const { claimRenderJob } = require('../../src/services/recutWorker.service');
      const worker = await Worker.findById(workerId).lean();
      const job = await claimRenderJob({ worker, shortRenderVersion: 'isolated-render', assetVersions: {} });
      process.send({ ok: true, jobId: job?.jobId || null });
    }
  } catch (error) { process.send({ ok: false, code: error.code || 'TEST_FAILED', message: error.message }); }
  finally { await mongoose.disconnect(); process.disconnect(); }
})();
