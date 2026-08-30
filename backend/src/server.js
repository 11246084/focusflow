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
const {
  recoverPendingYouTubeUploads,
  verifyYouTubeCredentials,
} = require('./services/youtubeUpload.service');
const {
  refreshHierarchicalDataReadiness,
} = require('./services/hierarchicalDataReadiness.service');
const {
  startVideoBatchReconciliationScheduler,
  stopVideoBatchReconciliationScheduler,
} = require('./services/videoBatchReconciliation.service');
const { migrateVideoFields } = require('./services/videoMigration.service');
const { recoverQueuedVideoProcessing } = require('./services/video.service');
const { validateStudentPilotRuntime } = require('./services/studentPilotRuntime.service');

async function startServer() {
  validateStudentPilotRuntime();
  fs.mkdirSync(env.uploadDir, { recursive: true });
  await connectDatabase();
  await migrateVideoFields();

  if (env.hierarchicalRetrievalEnabled) {
    // Read-only and fail-closed: an unsuccessful check keeps rollout ineligible while Leaf fallback stays available.
    await refreshHierarchicalDataReadiness();
  }

  if (env.demoSeedEnabled) {
    await seedDemoData({ silent: true });
  }

  const server = app.listen(env.port, () => {
    console.log(`Focus Flow backend listening on port ${env.port}`);
  });
  recoverQueuedVideoProcessing().catch((error) => {
    console.error('Failed to recover queued video processing.', error);
  });
  startShortsSyncScheduler();
  startVideoBatchReconciliationScheduler();
  // 非阻塞：讓 /health.runtime.youtubeUpload 從開機就有憑證狀態，不必等第一次上傳。
  verifyYouTubeCredentials()
    .then((verified) => (verified ? recoverPendingYouTubeUploads() : null))
    .catch(() => null);

  const shutdown = async () => {
    stopShortsSyncScheduler();
    stopVideoBatchReconciliationScheduler();
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
