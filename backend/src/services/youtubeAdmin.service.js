const env = require('../config/env');
const Course = require('../models/course.model');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const {
  getYouTubeLifecycleSettings,
  setYouTubeLifecycleSwitch,
} = require('./youtubeLifecycleSettings.service');
const {
  buildYouTubeCleanupPreview,
  buildYouTubeLifecycleSnapshot,
} = require('./youtubeLifecycle.service');
const { runYouTubeUploadRecoveryNow } = require('./youtubeUpload.service');

// 管理員「YouTube 上傳管理」頁的資料（decisions.md #13、#15、#27）。
// 判斷都在 A 塊的核心服務，這裡只把結果整理成前端約定的回應格式。

const BYTES_PER_GB = 1024 ** 3;

function toGb(bytes) {
  if (bytes === null || bytes === undefined) return null;
  return Math.round((bytes / BYTES_PER_GB) * 100) / 100;
}

async function loadUsersById(userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select('_id name email').lean();
  return new Map(users.map((user) => [String(user._id), user]));
}

async function loadCourseTitlesById(courseIds) {
  const ids = [...new Set(courseIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const courses = await Course.find({ _id: { $in: ids } }).select('_id title').lean();
  return new Map(courses.map((course) => [String(course._id), course.title || '']));
}

async function getLifecycleSettings() {
  const [settings, snapshot] = await Promise.all([
    getYouTubeLifecycleSettings(),
    buildYouTubeLifecycleSnapshot(),
  ]);
  const usersById = await loadUsersById(settings.history.map((entry) => entry.changedBy));

  return {
    switches: settings.switches.map(({ key, envAllowed, runtimeEnabled, effective, reason }) => ({
      key,
      envAllowed,
      runtimeEnabled,
      effective,
      reason,
    })),
    history: settings.history.map((entry) => {
      const user = entry.changedBy ? usersById.get(entry.changedBy) : null;
      return {
        key: entry.key,
        from: entry.from,
        to: entry.to,
        changedBy: {
          id: entry.changedBy,
          name: user?.name || null,
          // 紀錄當下的 email 優先：帳號之後改 email 也看得出當時是誰。
          email: entry.changedByEmail || user?.email || null,
        },
        changedAt: entry.changedAt,
      };
    }),
    runtime: {
      recoveryIntervalMs: env.youtubeUploadRecoveryIntervalMs,
      cleanupMinFreeGb: snapshot.cleanupPolicy.minFreeGb,
      cleanupMinAgeDays: snapshot.cleanupPolicy.minAgeDays,
      cleanupMaxAgeDays: snapshot.cleanupPolicy.maxAgeDays,
      freeSpaceGb: toGb(snapshot.disk.freeBytes),
      lastRecoveryAt: snapshot.schedulers.recovery.lastAttemptAt,
    },
  };
}

// 切換後回傳整份設定，畫面直接換掉，不必再查一次。
async function updateLifecycleSwitch({ key, enabled, user }) {
  await setYouTubeLifecycleSwitch({ key, enabled, user });
  return getLifecycleSettings();
}

// 預告清單（#27）：enable＝啟用後立即刪除，upcoming＝7 天內到期。判斷全在 A 的共用函式。
async function getCleanupPreview({ scope } = {}) {
  const preview = await buildYouTubeCleanupPreview({ scope });
  const courseTitles = await loadCourseTitlesById(preview.items.map((item) => item.courseId));
  return {
    scope: preview.scope,
    count: preview.count,
    totalBytes: preview.totalBytes,
    items: preview.items.map((item) => ({
      kind: item.kind,
      id: item.id,
      title: item.title,
      courseTitle: courseTitles.get(String(item.courseId)) || '',
      sizeBytes: item.sizeBytes,
      eligibleAt: item.eligibleAt,
      reason: item.reason,
    })),
  };
}

const RECOVERY_SKIP_MESSAGES = {
  recovery_disabled: 'YouTube upload recovery is disabled.',
  upload_not_configured: 'YouTube upload is not configured.',
  upload_disabled: 'YouTube upload is disabled.',
  already_running: 'A YouTube upload recovery run is already in progress.',
};

// 「立即執行恢復」（#15）。A 的 skipped 是「整輪略過」的布林值；畫面要的是筆數，
// 所以整輪略過改回 409 並帶原因，有執行時 skipped 是撈到但這一輪沒處理的筆數。
async function runRecoveryNow() {
  const result = await runYouTubeUploadRecoveryNow();
  if (result.skipped) {
    const error = new AppError(
      RECOVERY_SKIP_MESSAGES[result.reason] || 'YouTube upload recovery did not run.',
      409,
      'YOUTUBE_RECOVERY_NOT_RUN',
    );
    // 原因不含內部資訊，正式環境也回傳，畫面可依此說明為什麼沒有執行。
    error.publicDetails = { reason: result.reason || null };
    throw error;
  }
  return {
    recovered: result.recovered,
    quarantined: result.quarantined,
    skipped: Number(result.skippedItems || 0),
  };
}

module.exports = {
  getCleanupPreview,
  getLifecycleSettings,
  runRecoveryNow,
  updateLifecycleSwitch,
};
