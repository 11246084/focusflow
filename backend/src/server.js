const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // 強制使用 Google DNS，解決部分網路環境 SRV 查詢被封鎖的問題

const fs = require('fs');
const mongoose = require('mongoose');
const app = require('./app');
const env = require('./config/env');
const { connectDatabase } = require('./config/database');
const { seedDemoData } = require('./services/demoSeed.service');

async function migrateVideoIdNulls() {
  // sparse unique index 只跳過「欄位不存在」的文件，不跳過 video_id: null。
  // 把舊的 null 值 unset，讓 app-owned 文件不佔用 index slot。
  const Video = require('./models/video.model');
  const result = await Video.updateMany(
    { video_id: null },
    { $unset: { video_id: '' } },
  );
  if (result.modifiedCount > 0) {
    console.log(`Migrated ${result.modifiedCount} video(s): unset video_id: null`);
  }
}

async function startServer() {
  fs.mkdirSync(env.uploadDir, { recursive: true });
  await connectDatabase();
  await migrateVideoIdNulls();

  if (env.demoSeedEnabled) {
    await seedDemoData({ silent: true });
  }

  const server = app.listen(env.port, () => {
    console.log(`Focus Flow backend listening on port ${env.port}`);
  });

  const shutdown = async () => {
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
