const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // 強制使用 Google DNS，解決部分網路環境 SRV 查詢被封鎖的問題

const fs = require('fs');
const mongoose = require('mongoose');
const app = require('./app');
const env = require('./config/env');
const { connectDatabase } = require('./config/database');
const { seedDemoData } = require('./services/demoSeed.service');
const {
  startShortsSyncScheduler,
  stopShortsSyncScheduler,
} = require('./services/shortsSync.service');

async function migrateVideoFields() {
  const Video = require('./models/video.model');
  // Rename legacy snake_case fields to camelCase for any documents not yet migrated.
  const renameResult = await Video.updateMany(
    { video_id: { $exists: true } },
    [{ $set: { videoId: '$video_id' } }, { $unset: 'video_id' }],
  );
  if (renameResult.modifiedCount > 0) {
    console.log(`Migrated ${renameResult.modifiedCount} video(s): video_id -> videoId`);
  }
  // Unset videoId: null so app-owned docs don't occupy the sparse unique index slot.
  await Video.updateMany({ videoId: null }, { $unset: { videoId: '' } });
}

async function startServer() {
  fs.mkdirSync(env.uploadDir, { recursive: true });
  await connectDatabase();
  await migrateVideoFields();

  if (env.demoSeedEnabled) {
    await seedDemoData({ silent: true });
  }

  const server = app.listen(env.port, () => {
    console.log(`Focus Flow backend listening on port ${env.port}`);
  });
  startShortsSyncScheduler();

  const shutdown = async () => {
    stopShortsSyncScheduler();
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((error) => {
  console.error('Failed to start backend.', error);
  process.exit(1);
});
