const env = require('../config/env');
const RuntimeSetting = require('../models/runtimeSetting.model');
const AppError = require('../utils/appError');

// YouTube 上傳、恢復、清理的兩層開關（decisions.md #9～#16）：
// 環境變數決定這個環境「允不允許」，資料庫的執行期設定在允許範圍內切換。
// 每次使用前直接讀資料庫、不快取（#11），修改後下一次檢查即生效。

const RUNTIME_SETTING_HISTORY_LIMIT = 50;

const YOUTUBE_LIFECYCLE_SWITCHES = Object.freeze({
  UPLOAD: 'upload',
  RECOVERY: 'recovery',
  CLEANUP: 'cleanup',
});

const YOUTUBE_LIFECYCLE_SWITCH_REASONS = Object.freeze({
  ENV_DISABLED: 'env_disabled',
  RUNTIME_DISABLED: 'runtime_disabled',
  DEFAULT_OFF: 'default_off',
});

// 資料庫還沒有設定時：上傳與恢復跟隨環境變數，清理視為關閉（#16）。
const SWITCH_DEFINITIONS = Object.freeze({
  [YOUTUBE_LIFECYCLE_SWITCHES.UPLOAD]: {
    settingKey: 'youtubeLifecycle.upload',
    envName: 'YOUTUBE_UPLOAD_ENABLED',
    readEnv: () => Boolean(env.youtubeUploadEnabled),
    enabledWhenUnset: true,
  },
  [YOUTUBE_LIFECYCLE_SWITCHES.RECOVERY]: {
    settingKey: 'youtubeLifecycle.recovery',
    envName: 'YOUTUBE_UPLOAD_RECOVERY_ENABLED',
    readEnv: () => Boolean(env.youtubeUploadRecoveryEnabled),
    enabledWhenUnset: true,
  },
  [YOUTUBE_LIFECYCLE_SWITCHES.CLEANUP]: {
    settingKey: 'youtubeLifecycle.cleanup',
    envName: 'YOUTUBE_UPLOAD_CLEANUP_ENABLED',
    readEnv: () => Boolean(env.youtubeUploadCleanupEnabled),
    enabledWhenUnset: false,
  },
});

const SWITCH_KEYS = Object.keys(SWITCH_DEFINITIONS);

function getSwitchDefinition(key) {
  const definition = SWITCH_DEFINITIONS[key];
  if (!definition) {
    throw new AppError(
      `key must be one of: ${SWITCH_KEYS.join(', ')}.`,
      400,
      'VALIDATION_ERROR',
    );
  }
  return definition;
}

function normalizeRuntimeValue(value) {
  return typeof value === 'boolean' ? value : null;
}

function resolveYouTubeLifecycleSwitch(key, runtimeValue) {
  const definition = getSwitchDefinition(key);
  const envAllowed = definition.readEnv();
  const runtimeEnabled = normalizeRuntimeValue(runtimeValue);

  let effective;
  let reason = null;
  if (!envAllowed) {
    effective = false;
    reason = YOUTUBE_LIFECYCLE_SWITCH_REASONS.ENV_DISABLED;
  } else if (runtimeEnabled === false) {
    effective = false;
    reason = YOUTUBE_LIFECYCLE_SWITCH_REASONS.RUNTIME_DISABLED;
  } else if (runtimeEnabled === null && !definition.enabledWhenUnset) {
    effective = false;
    reason = YOUTUBE_LIFECYCLE_SWITCH_REASONS.DEFAULT_OFF;
  } else {
    effective = true;
  }

  return {
    key,
    envName: definition.envName,
    envAllowed,
    runtimeEnabled,
    effective,
    reason,
  };
}

function toSwitchState(key, document) {
  return {
    ...resolveYouTubeLifecycleSwitch(key, document?.value),
    updatedAt: document?.updatedAt || null,
    updatedBy: document?.updatedBy ? String(document.updatedBy) : null,
  };
}

function toHistoryEntry(key, entry) {
  return {
    key,
    from: normalizeRuntimeValue(entry.from),
    to: normalizeRuntimeValue(entry.to),
    changedBy: entry.changedBy ? String(entry.changedBy) : null,
    changedByEmail: entry.changedByEmail || null,
    changedAt: entry.changedAt,
  };
}

async function getYouTubeLifecycleSwitch(key) {
  const definition = getSwitchDefinition(key);
  const document = await RuntimeSetting.findOne({ key: definition.settingKey }).lean();
  return toSwitchState(key, document);
}

// 給上傳、恢復、清理在每次動作前呼叫。讀不到資料庫時一律視為關閉：
// 最壞情況是這一輪不做，下一輪再判斷，不會在狀態不明時刪檔或上傳。
async function isYouTubeLifecycleSwitchEnabled(key) {
  try {
    const state = await getYouTubeLifecycleSwitch(key);
    return state.effective;
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`Failed to read YouTube lifecycle switch "${key}"; treating it as disabled.`, error);
    }
    return false;
  }
}

async function getYouTubeLifecycleSettings() {
  const definitions = SWITCH_KEYS.map((key) => [key, SWITCH_DEFINITIONS[key]]);
  const documents = await RuntimeSetting.find({
    key: { $in: definitions.map(([, definition]) => definition.settingKey) },
  }).lean();
  const byKey = new Map(documents.map((document) => [document.key, document]));

  const switches = definitions.map(([key, definition]) => toSwitchState(key, byKey.get(definition.settingKey)));
  const history = definitions
    .flatMap(([key, definition]) => (byKey.get(definition.settingKey)?.history || [])
      .map((entry) => toHistoryEntry(key, entry)))
    .sort((left, right) => new Date(right.changedAt).getTime() - new Date(left.changedAt).getTime())
    .slice(0, RUNTIME_SETTING_HISTORY_LIMIT);

  return { switches, history };
}

async function setYouTubeLifecycleSwitch({ key, enabled, user, now = new Date() } = {}) {
  const definition = getSwitchDefinition(key);
  if (typeof enabled !== 'boolean') {
    throw new AppError('enabled must be a boolean.', 400, 'VALIDATION_ERROR');
  }
  // 環境變數不允許時畫面不可切換（#13）；API 也擋下，避免寫入一個不會生效的值。
  if (!definition.readEnv()) {
    throw new AppError(
      `${definition.envName} is disabled; this switch cannot be changed at runtime.`,
      409,
      'YOUTUBE_LIFECYCLE_SWITCH_ENV_DISABLED',
    );
  }

  // 先讀再寫：from 值在兩位管理員同時切換時可能不精確，但只影響紀錄，
  // 不影響開關本身；單一 pm2 行程、低頻操作下可接受。
  const current = await RuntimeSetting.findOne({ key: definition.settingKey }).lean();
  const from = normalizeRuntimeValue(current?.value);
  const changedBy = user?.id || user?._id || null;
  const change = {
    from,
    to: enabled,
    changedBy,
    changedByEmail: user?.email || null,
    changedAt: now,
  };

  const document = await RuntimeSetting.findOneAndUpdate(
    { key: definition.settingKey },
    {
      $set: { value: enabled, updatedBy: changedBy },
      $push: { history: { $each: [change], $slice: -RUNTIME_SETTING_HISTORY_LIMIT } },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  return {
    switch: toSwitchState(key, document),
    change: toHistoryEntry(key, change),
  };
}

module.exports = {
  RUNTIME_SETTING_HISTORY_LIMIT,
  YOUTUBE_LIFECYCLE_SWITCHES,
  YOUTUBE_LIFECYCLE_SWITCH_REASONS,
  getYouTubeLifecycleSettings,
  getYouTubeLifecycleSwitch,
  isYouTubeLifecycleSwitchEnabled,
  resolveYouTubeLifecycleSwitch,
  setYouTubeLifecycleSwitch,
};
