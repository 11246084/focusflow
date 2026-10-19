const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const Video = require('../models/video.model');
const {
  VIDEO_PROCESSING_STATUSES,
  YOUTUBE_UPLOAD_STATUSES,
} = require('../constants/enums');
const AppError = require('../utils/appError');
const {
  cleanupUploadedLocalVideo,
  getYouTubeUploadRecoverySchedulerState,
  isPathInside,
  resolveLocalUploadPath,
} = require('./youtubeUpload.service');
const {
  YOUTUBE_LIFECYCLE_SWITCHES,
  getYouTubeLifecycleSettings,
  isYouTubeLifecycleSwitchEnabled,
} = require('./youtubeLifecycleSettings.service');

// 原片清理排程（decisions.md #22、#24、#26、#27）。「誰符合刪除條件」只有
// listYouTubeCleanupCandidates 一份判斷，排程刪除與兩種預告都呼叫它。

const DAY_MS = 24 * 60 * 60 * 1000;
const BYTES_PER_GB = 1024 ** 3;
const UPCOMING_WINDOW_DAYS = 7;

const YOUTUBE_CLEANUP_SCOPES = Object.freeze({
  // 假設現在啟用清理，下一輪會刪哪些；排程本身也用這個範圍。
  ENABLE: 'enable',
  // 7 天內到期（含已到期）的清單，給系統狀態固定顯示。
  UPCOMING: 'upcoming',
});

const YOUTUBE_CLEANUP_REASONS = Object.freeze({
  MAX_AGE: 'max_age',
  LOW_SPACE: 'low_space',
});

const cleanupScheduler = {
  timer: null,
  intervalMs: null,
  running: false,
  startedAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastCleanedCount: 0,
  lastFreedBytes: 0,
};

function getCleanupPolicy() {
  const minFreeGb = Number(env.youtubeUploadCleanupMinFreeGb) || 0;
  return {
    maxAgeDays: Number(env.youtubeUploadCleanupMaxAgeDays) || 0,
    minAgeDays: Number(env.youtubeUploadCleanupMinAgeDays) || 0,
    minFreeGb,
    minFreeBytes: Math.round(minFreeGb * BYTES_PER_GB),
  };
}

function defaultStatfs(targetPath) {
  return fs.promises.statfs(targetPath);
}

// UPLOAD_DIR 所在磁碟的可用空間（一般使用者可用的 bavail，不含 root 保留區）。
async function getUploadDirFreeBytes({ statfsImpl = defaultStatfs } = {}) {
  const stats = await statfsImpl(env.uploadDir);
  return Number(stats.bavail) * Number(stats.bsize);
}

async function readFreeBytes(getFreeBytes) {
  try {
    const freeBytes = await (getFreeBytes || getUploadDirFreeBytes)();
    if (!Number.isFinite(freeBytes) || freeBytes < 0) {
      return { freeBytes: null, error: 'Free space provider returned an invalid value.' };
    }
    return { freeBytes, error: null };
  } catch (error) {
    return { freeBytes: null, error: String(error?.message || error).slice(0, 300) };
  }
}

function toValidTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

// 保留期從上傳完成或補回原片中較晚的時間起算（#24）。
function resolveRetentionStartTime(youtubeUpload = {}) {
  const times = [youtubeUpload?.uploadedAt, youtubeUpload?.localSourceRestoredAt]
    .map(toValidTime)
    .filter((time) => time !== null);
  return times.length ? Math.max(...times) : null;
}

function readFileSize(localPath) {
  try {
    return fs.statSync(localPath).size;
  } catch {
    // 檔案已不在：清理只會切播放欄位，不釋放空間。
    return 0;
  }
}

// 一般影片的清理條件（#4）：處理完成、YouTube 上傳完成、路徑在 UPLOAD_DIR 內、
// 沒有其他影片共用同一檔案。不符合的不列入候選，預告與排程都看不到。
async function listVideoCleanupEntries() {
  const videos = await Video.find({
    'processing.status': VIDEO_PROCESSING_STATUSES.COMPLETED,
    'youtubeUpload.status': YOUTUBE_UPLOAD_STATUSES.UPLOADED,
    youtubeVideoId: { $exists: true, $nin: [null, ''] },
    filePath: { $exists: true, $nin: [null, ''] },
  })
    .select('_id title courseId filePath youtubeVideoId youtubeUpload')
    .lean();
  if (!videos.length) return [];

  const filePaths = [...new Set(videos.map((video) => video.filePath))];
  const references = await Video.find({ filePath: { $in: filePaths } }).select('_id filePath').lean();
  const referenceCounts = new Map();
  for (const reference of references) {
    referenceCounts.set(reference.filePath, (referenceCounts.get(reference.filePath) || 0) + 1);
  }

  const uploadRoot = path.resolve(env.uploadDir);
  const entries = [];
  for (const video of videos) {
    const localPath = resolveLocalUploadPath(video.filePath);
    if (!isPathInside(uploadRoot, localPath) || localPath === uploadRoot) continue;
    if ((referenceCounts.get(video.filePath) || 0) > 1) continue;
    const retentionStartTime = resolveRetentionStartTime(video.youtubeUpload);
    if (retentionStartTime === null) continue;

    entries.push({
      kind: 'video',
      id: String(video._id),
      title: video.title || '',
      courseId: video.courseId ? String(video.courseId?._id || video.courseId) : null,
      sizeBytes: readFileSize(localPath),
      retentionStartTime,
    });
  }
  return entries;
}

// 可清理的檔案來源，以 kind 區分。D 塊（短片成品）在這裡加一個 kind：
// listEntries 回傳 { kind, id, title, courseId, sizeBytes, retentionStartTime } 陣列，
// 只列出符合該來源安全條件的項目；cleanup(id) 負責刪除並在刪檔前再確認開關（#14），
// 回傳 { cleaned, reason }，reason 為 'disabled' 時排程停止本輪。
const CLEANUP_SOURCES = {
  video: {
    listEntries: listVideoCleanupEntries,
    cleanup: (id) => cleanupUploadedLocalVideo(id),
  },
};

function compareEntries(left, right) {
  if (left.retentionStartTime !== right.retentionStartTime) {
    return left.retentionStartTime - right.retentionStartTime;
  }
  return `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`);
}

// 純函式：給定候選、現在時間與可用空間，決定哪些要刪。
// horizonMs > 0 時把「最長保留期」往後看（7 天預告），空間規則只看現在。
function selectCleanupCandidates(entries, {
  now = new Date(),
  freeBytes = null,
  policy = getCleanupPolicy(),
  horizonMs = 0,
} = {}) {
  const nowMs = now.getTime();
  const maxAgeMs = policy.maxAgeDays * DAY_MS;
  const minAgeMs = policy.minAgeDays * DAY_MS;
  const sorted = [...entries].sort(compareEntries);
  const selected = [];
  const remaining = [];

  for (const entry of sorted) {
    const eligibleAtMs = entry.retentionStartTime + maxAgeMs;
    if (maxAgeMs > 0 && eligibleAtMs <= nowMs + horizonMs) {
      selected.push({ entry, eligibleAtMs, reason: YOUTUBE_CLEANUP_REASONS.MAX_AGE });
    } else {
      remaining.push(entry);
    }
  }

  if (policy.minFreeBytes > 0 && freeBytes !== null && freeBytes < policy.minFreeBytes) {
    // 同一輪先刪的超齡檔也算進釋放量；從最早的開始，回到門檻以上就停。
    let projectedFreeBytes = freeBytes + selected.reduce((sum, item) => sum + item.entry.sizeBytes, 0);
    for (const entry of remaining) {
      if (projectedFreeBytes >= policy.minFreeBytes) break;
      if (entry.retentionStartTime + minAgeMs > nowMs) continue;
      selected.push({ entry, eligibleAtMs: nowMs, reason: YOUTUBE_CLEANUP_REASONS.LOW_SPACE });
      projectedFreeBytes += entry.sizeBytes;
    }
  }

  return selected.map(({ entry, eligibleAtMs, reason }) => ({
    kind: entry.kind,
    id: entry.id,
    title: entry.title,
    courseId: entry.courseId,
    sizeBytes: entry.sizeBytes,
    retentionStartAt: new Date(entry.retentionStartTime),
    eligibleAt: new Date(eligibleAtMs),
    reason,
  }));
}

async function listAllCleanupEntries() {
  const groups = await Promise.all(
    Object.values(CLEANUP_SOURCES).map((source) => source.listEntries()),
  );
  return groups.flat();
}

function normalizeScope(scope) {
  const normalized = String(scope || YOUTUBE_CLEANUP_SCOPES.ENABLE).trim().toLowerCase();
  if (!Object.values(YOUTUBE_CLEANUP_SCOPES).includes(normalized)) {
    throw new AppError(
      `scope must be one of: ${Object.values(YOUTUBE_CLEANUP_SCOPES).join(', ')}.`,
      400,
      'VALIDATION_ERROR',
    );
  }
  return normalized;
}

// 「誰符合刪除條件」的共用入口（#27）。不看清理開關：enable 範圍就是
// 「假設現在啟用」的結果，排程在開關開著時刪的正是這一份。
async function listYouTubeCleanupCandidates({
  scope = YOUTUBE_CLEANUP_SCOPES.ENABLE,
  now = new Date(),
  getFreeBytes,
} = {}) {
  const normalizedScope = normalizeScope(scope);
  const [entries, space] = await Promise.all([listAllCleanupEntries(), readFreeBytes(getFreeBytes)]);
  return selectCleanupCandidates(entries, {
    now,
    freeBytes: space.freeBytes,
    horizonMs: normalizedScope === YOUTUBE_CLEANUP_SCOPES.UPCOMING ? UPCOMING_WINDOW_DAYS * DAY_MS : 0,
  });
}

// 給管理員預告畫面：清單加上總數與總大小，「啟用後會立即刪除 N 支（共 X GB）」。
async function buildYouTubeCleanupPreview({
  scope = YOUTUBE_CLEANUP_SCOPES.ENABLE,
  now = new Date(),
  getFreeBytes,
} = {}) {
  const normalizedScope = normalizeScope(scope);
  const [entries, space] = await Promise.all([listAllCleanupEntries(), readFreeBytes(getFreeBytes)]);
  const policy = getCleanupPolicy();
  const items = selectCleanupCandidates(entries, {
    now,
    freeBytes: space.freeBytes,
    policy,
    horizonMs: normalizedScope === YOUTUBE_CLEANUP_SCOPES.UPCOMING ? UPCOMING_WINDOW_DAYS * DAY_MS : 0,
  });
  return {
    scope: normalizedScope,
    generatedAt: now,
    windowDays: normalizedScope === YOUTUBE_CLEANUP_SCOPES.UPCOMING ? UPCOMING_WINDOW_DAYS : 0,
    count: items.length,
    totalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    freeBytes: space.freeBytes,
    freeBytesError: space.error,
    policy: {
      maxAgeDays: policy.maxAgeDays,
      minAgeDays: policy.minAgeDays,
      minFreeGb: policy.minFreeGb,
    },
    items,
  };
}

async function runYouTubeCleanup({ now = new Date(), getFreeBytes } = {}) {
  if (cleanupScheduler.running) {
    return { skipped: true, reason: 'already_running', cleaned: 0, freedBytes: 0, results: [] };
  }
  // 每輪開始前檢查開關（#14）；刪每支前 cleanup() 會再檢查一次。
  if (!(await isYouTubeLifecycleSwitchEnabled(YOUTUBE_LIFECYCLE_SWITCHES.CLEANUP))) {
    return { skipped: true, reason: 'cleanup_disabled', cleaned: 0, freedBytes: 0, results: [] };
  }

  cleanupScheduler.running = true;
  cleanupScheduler.startedAt = now.toISOString();
  cleanupScheduler.lastAttemptAt = now.toISOString();
  try {
    const candidates = await listYouTubeCleanupCandidates({
      scope: YOUTUBE_CLEANUP_SCOPES.ENABLE,
      now,
      getFreeBytes,
    });
    const results = [];
    let cleaned = 0;
    let freedBytes = 0;

    for (const candidate of candidates) {
      const source = CLEANUP_SOURCES[candidate.kind];
      const result = await source.cleanup(candidate.id);
      results.push({
        kind: candidate.kind,
        id: candidate.id,
        reason: candidate.reason,
        cleaned: Boolean(result?.cleaned),
        skipReason: result?.cleaned ? null : (result?.reason || null),
      });
      if (result?.cleaned) {
        cleaned += 1;
        freedBytes += candidate.sizeBytes;
      } else if (result?.reason === 'disabled') {
        // 管理員中途關閉：剩下的這一輪不再刪。
        break;
      }
    }

    cleanupScheduler.lastSuccessAt = new Date().toISOString();
    cleanupScheduler.lastError = null;
    cleanupScheduler.lastCleanedCount = cleaned;
    cleanupScheduler.lastFreedBytes = freedBytes;
    return { skipped: false, candidates: candidates.length, cleaned, freedBytes, results };
  } catch (error) {
    cleanupScheduler.lastError = String(error?.message || error).slice(0, 300);
    throw error;
  } finally {
    cleanupScheduler.running = false;
    cleanupScheduler.startedAt = null;
  }
}

// 開機跑一次，之後依 YOUTUBE_UPLOAD_CLEANUP_INTERVAL_MS 重複；0 代表只在開機跑。
// 環境變數不允許時不啟動。
function startYouTubeCleanupScheduler({
  intervalMs = env.youtubeUploadCleanupIntervalMs,
  getFreeBytes,
} = {}) {
  if (!env.youtubeUploadCleanupEnabled) return null;
  const runOnce = (label) => runYouTubeCleanup({ getFreeBytes }).catch((error) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`${label} YouTube local cleanup failed.`, error);
    }
    return null;
  });

  const initialRun = runOnce('Initial');
  if (intervalMs > 0 && !cleanupScheduler.timer) {
    cleanupScheduler.intervalMs = intervalMs;
    cleanupScheduler.timer = setInterval(() => runOnce('Scheduled'), intervalMs);
    cleanupScheduler.timer.unref?.();
  }
  return initialRun;
}

function stopYouTubeCleanupScheduler() {
  if (cleanupScheduler.timer) clearInterval(cleanupScheduler.timer);
  cleanupScheduler.timer = null;
  cleanupScheduler.intervalMs = null;
}

function getYouTubeCleanupSchedulerState() {
  return {
    envAllowed: Boolean(env.youtubeUploadCleanupEnabled),
    timerActive: Boolean(cleanupScheduler.timer),
    intervalMs: cleanupScheduler.timer ? cleanupScheduler.intervalMs : null,
    running: cleanupScheduler.running,
    runningSince: cleanupScheduler.startedAt,
    lastAttemptAt: cleanupScheduler.lastAttemptAt,
    lastSuccessAt: cleanupScheduler.lastSuccessAt,
    lastError: cleanupScheduler.lastError,
    lastCleanedCount: cleanupScheduler.lastCleanedCount,
    lastFreedBytes: cleanupScheduler.lastFreedBytes,
  };
}

// /health 的 runtime.youtubeUpload 補充欄位：兩層開關實際生效值、排程、可用空間。
// 任何一項讀取失敗只在該欄位標示錯誤，不讓 /health 失敗。
async function buildYouTubeLifecycleSnapshot({ getFreeBytes } = {}) {
  const policy = getCleanupPolicy();
  let switches = null;
  let switchesError = null;
  try {
    const settings = await getYouTubeLifecycleSettings();
    switches = Object.fromEntries(settings.switches.map((item) => [item.key, {
      envAllowed: item.envAllowed,
      runtimeEnabled: item.runtimeEnabled,
      effective: item.effective,
      reason: item.reason,
    }]));
  } catch (error) {
    switchesError = String(error?.message || error).slice(0, 300);
  }
  const space = await readFreeBytes(getFreeBytes);

  return {
    switches,
    switchesError,
    schedulers: {
      recovery: getYouTubeUploadRecoverySchedulerState(),
      cleanup: getYouTubeCleanupSchedulerState(),
    },
    disk: {
      freeBytes: space.freeBytes,
      minFreeBytes: policy.minFreeBytes,
      belowThreshold: space.freeBytes === null || policy.minFreeBytes <= 0
        ? null
        : space.freeBytes < policy.minFreeBytes,
      error: space.error,
    },
    cleanupPolicy: {
      maxAgeDays: policy.maxAgeDays,
      minAgeDays: policy.minAgeDays,
      minFreeGb: policy.minFreeGb,
    },
  };
}

function resetYouTubeLifecycleStateForTests() {
  stopYouTubeCleanupScheduler();
  cleanupScheduler.running = false;
  cleanupScheduler.startedAt = null;
  cleanupScheduler.lastAttemptAt = null;
  cleanupScheduler.lastSuccessAt = null;
  cleanupScheduler.lastError = null;
  cleanupScheduler.lastCleanedCount = 0;
  cleanupScheduler.lastFreedBytes = 0;
}

module.exports = {
  CLEANUP_SOURCES,
  UPCOMING_WINDOW_DAYS,
  YOUTUBE_CLEANUP_REASONS,
  YOUTUBE_CLEANUP_SCOPES,
  buildYouTubeCleanupPreview,
  buildYouTubeLifecycleSnapshot,
  getCleanupPolicy,
  getUploadDirFreeBytes,
  getYouTubeCleanupSchedulerState,
  listYouTubeCleanupCandidates,
  resetYouTubeLifecycleStateForTests,
  resolveRetentionStartTime,
  runYouTubeCleanup,
  selectCleanupCandidates,
  startYouTubeCleanupScheduler,
  stopYouTubeCleanupScheduler,
};
