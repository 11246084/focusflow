const Video = require('../models/video.model');

async function migrateVideoFields() {
  // Use the raw collection because Mongoose strictQuery can strip the legacy
  // snake_case key from a model query and accidentally turn it into {}.
  const renameResult = await Video.collection.updateMany(
    { video_id: { $exists: true } },
    [{ $set: { videoId: '$video_id' } }, { $unset: 'video_id' }],
  );
  if (renameResult.modifiedCount > 0) {
    console.log(`Migrated ${renameResult.modifiedCount} video(s): video_id -> videoId`);
  }

  // MongoDB { field: null } also matches a missing field. Restrict cleanup to
  // documents that explicitly contain BSON null so valid/missing keys are untouched.
  await Video.collection.updateMany(
    { videoId: { $type: 10 } },
    { $unset: { videoId: '' } },
  );
}

module.exports = { migrateVideoFields };
