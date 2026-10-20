const env = require('../config/env');
const User = require('../models/user.model');
const {
  getYouTubeLifecycleSettings,
  setYouTubeLifecycleSwitch,
} = require('./youtubeLifecycleSettings.service');
const { buildYouTubeLifecycleSnapshot } = require('./youtubeLifecycle.service');

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

module.exports = {
  getLifecycleSettings,
  updateLifecycleSwitch,
};
