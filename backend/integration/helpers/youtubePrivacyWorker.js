// Explicit integration-only child. All HTTP is a local fake; Mongo is validated
// by the parent and again here before any connection.
const { env } = require('./youtubeReviewFixture');
const mongoose = require('mongoose');
const { assertLoopbackMongoUri } = require('./isolatedYouTubeMongo');
const Video = require('../../src/models/video.model');
const Setting = require('../../src/models/runtimeSetting.model');
const remote = require('../../src/services/youtubeRemoteState.service');

async function run() {
  const [uri, databaseName, serializedIds] = process.argv.slice(2);
  assertLoopbackMongoUri(uri);
  if (!/^focusflow_youtube_test_[a-f0-9]{16}$/.test(databaseName)) throw new Error('Unowned integration database.');
  Object.assign(env, { youtubePrivacyGuardEnabled: true, youtubeUploadAccessToken: 'fake-token' });
  await mongoose.connect(uri, { dbName: databaseName, directConnection: true, autoIndex: false, autoCreate: false });
  const response = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'PUT') {
      process.send?.({ type: 'privacy_update' });
      return response({});
    }
    if (String(url).includes('/channels')) return response({ items: [{ id: 'own' }] });
    const ids = new URL(url).searchParams.get('id').split(',');
    return response({ items: ids.map((id) => ({ id, snippet: { channelId: 'own' },
      status: { privacyStatus: 'public', uploadStatus: 'processed', embeddable: true } })) });
  };
  try {
    for (const id of JSON.parse(serializedIds)) {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await remote.checkItemRemoteState({ kind: 'video', id, fetchImpl });
        const item = await Video.findById(id).lean();
        const guard = await Setting.findOne({ key: 'privacy_guard' }).lean();
        if (item.youtubeUpload.privacyIncidents?.some((entry) => entry.action === 'auto_private') || guard.value.guard.updates?.length >= 10) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  } finally { await mongoose.disconnect(); }
}

run().then(() => process.exit(0), (error) => { process.stderr.write(String(error.stack)); process.exit(1); });
