const mongoose = require('mongoose');
const Video = require('../models/video.model');
const ShortAsset = require('../models/shortAsset.model');
const { observedFields, NO_CLEANUP_INTENT } = require('../services/youtubeWorkOwnership.service');

async function releaseWaitingUploads({ write = false, now = new Date(), models = [['video', Video], ['short_asset', ShortAsset]] } = {}) {
  const items = [];
  for (const [kind, model] of models) {
    const waiting = await model.find({ 'youtubeUpload.status': 'waiting' }).select('_id youtubeUpload.attemptCount youtubeUpload.attemptId youtubeUpload.phase').lean();
    for (const item of waiting) {
      let changed = false;
      if (write) changed = Boolean(await model.findOneAndUpdate({ _id: item._id, ...NO_CLEANUP_INTENT,
        'youtubeUpload.status': 'waiting', $and: observedFields(item, ['youtubeUpload.attemptId', 'youtubeUpload.phase']) },
      { $set: { 'youtubeUpload.status': 'failed', 'youtubeUpload.retrySafe': true, 'youtubeUpload.nextRetryAt': now,
        'youtubeUpload.waitReason': null, 'youtubeUpload.phase': null, 'youtubeUpload.session': null } }));
      items.push({ kind, id: String(item._id), attemptCount: Number(item.youtubeUpload?.attemptCount || 0), changed });
    }
  }
  return { write, count: items.length, changed: items.filter((item) => item.changed).length, items };
}

async function main() {
  const env = require('../config/env');
  await mongoose.connect(env.mongodbUri, { autoIndex: false, autoCreate: false });
  try { console.log(JSON.stringify(await releaseWaitingUploads({ write: process.argv.includes('--write') }), null, 2)); }
  finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(() => { console.error('Unable to release waiting uploads.'); process.exitCode = 1; });
module.exports = { releaseWaitingUploads };
