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
  startYouTubeUploadRecoveryScheduler,
  stopYouTubeUploadRecoveryScheduler,
  verifyYouTubeCredentials,
} = require('./services/youtubeUpload.service');
const {
  startYouTubeCleanupScheduler,
  stopYouTubeCleanupScheduler,
} = require('./services/youtubeLifecycle.service');
const { startYouTubeRemoteStateScheduler, stopYouTubeRemoteStateScheduler } = require('./services/youtubeRemoteState.service');
const {
  refreshHierarchicalDataReadiness,
} = require('./services/hierarchicalDataReadiness.service');
const {
  startVideoBatchReconciliationScheduler,
  stopVideoBatchReconciliationScheduler,
} = require('./services/videoBatchReconciliation.service');
const { migrateVideoFields } = require('./services/videoMigration.service');
const { recoverQueuedVideoProcessing } = require('./services/video.service');
const { recutQueue } = require('./services/recutQueue.service');
const { validateStudentPilotRuntime } = require('./services/studentPilotRuntime.service');
const { cleanupIncoming, warnLowSpace } = require('./services/uploadStorage.service');
const { startCourseDeletionJobScheduler, stopCourseDeletionJobScheduler } = require('./services/courseDeletionJobs.service');

async function startServer({ recutRuntimeAdapters } = {}) {
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

  // Hosts supply concrete adapters. Missing configuration stays explicit (503),
  // and never silently selects a provider or fake implementation.
  const recutApplication = env.shortScriptAutomationEnabled
    ? require('./services/recutApplication.service').configureRecutApplication({ runtimeAdapters: recutRuntimeAdapters }) : null;
  const consentLifecycle = require('./services/recutConsentLifecycle.service').configureRecutConsentLifecycle();
  const recoverConsent = async () => {
    await require('./services/recutConsent.service').recoverPendingWithdrawals();
    await consentLifecycle.recoverAssetPrivacy();
  };
  recoverConsent().catch((error) => console.error('[recut] consent recovery failed', error.code));
  const consentRecoveryTimer = setInterval(() => recoverConsent().catch((error) => console.error('[recut] consent recovery failed', error.code)), 60000);
  consentRecoveryTimer.unref();

  const server = app.listen(env.port, () => {
    console.log(`Focus Flow backend listening on port ${env.port}`);
  });
  server.requestTimeout = 60 * 60 * 1000;
  recoverQueuedVideoProcessing().catch((error) => {
    console.error('Failed to recover queued video processing.', error);
  });
  startShortsSyncScheduler();
  if (recutApplication && !recutApplication.missing.length) recutApplication.recover().catch((error) => {
    console.error('Failed to recover queued recut tasks.', error);
  });
  const renderRecoveryTimer = env.shortScriptAutomationEnabled ? setInterval(() => require('./services/recutWorker.service').recoverRenderJobs().catch((error) => console.error('[recut] render recovery failed', error.code)), 60000) : null;
  renderRecoveryTimer?.unref();
  if (env.shortScriptAutomationEnabled) require('./services/recutWorker.service').recoverRenderJobs().catch((error) => console.error('[recut] render startup recovery failed', error.code));
  startVideoBatchReconciliationScheduler();
  startYouTubeRemoteStateScheduler();
  // 非阻塞：讓 /health.runtime.youtubeUpload 從開機就有憑證狀態，不必等第一次上傳。
  // 恢復排程在憑證檢查後啟動；每輪是否執行由兩層開關決定。
  verifyYouTubeCredentials()
    .catch(() => null)
    .then(() => startYouTubeUploadRecoveryScheduler());
  startYouTubeCleanupScheduler();
  startCourseDeletionJobScheduler();
  const cleanupTimer = setInterval(() => cleanupIncoming().catch((error) => console.error('Incoming cleanup failed.', error.message)), 60 * 60 * 1000);
  cleanupTimer.unref();
  const warningTimer = setInterval(() => warnLowSpace().catch((error) => console.error('Upload storage warning failed.', error.message)), 24 * 60 * 60 * 1000);
  warningTimer.unref();
  warnLowSpace().catch((error) => console.error('Upload storage warning failed.', error.message));

  const shutdown = async () => {
    clearInterval(consentRecoveryTimer);
    recutQueue.stop();
    clearInterval(renderRecoveryTimer);
    stopShortsSyncScheduler();
    stopVideoBatchReconciliationScheduler();
    stopYouTubeUploadRecoveryScheduler();
    stopYouTubeRemoteStateScheduler();
    stopYouTubeCleanupScheduler();
    stopCourseDeletionJobScheduler();
    clearInterval(cleanupTimer);
    clearInterval(warningTimer);
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) startServer().catch((error) => {
  console.error('Failed to start backend.', error);
  process.exit(1);
});
module.exports = { startServer };
