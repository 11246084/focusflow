const path = require('path');
const { existsSync } = require('fs');
const mongoose = require('mongoose');
const env = require('../config/env');
const {
  buildQaRuntimeSnapshot,
  buildLineRuntimeSnapshot,
} = require('./runtimeDiagnostics.service');
const { buildYouTubeUploadSnapshot } = require('./youtubeUpload.service');
const { YOUTUBE_CLEANUP_SCOPES } = require('./youtubeLifecycle.service');
const { getCleanupPreview } = require('./youtubeAdmin.service');
const { getYouTubeLifecycleSettings } = require('./youtubeLifecycleSettings.service');
const { countQuarantinedItems } = require('./youtubeQuarantine.service');
const { getVideoProcessingQueueSnapshot } = require('./videoProcessingQueue.service');

// 管理員總覽「系統服務」區塊的資料來源。狀態只根據本程序可觀察到的事實判斷
// （DB 連線狀態、runtime 設定 snapshot、STT venv 是否存在、處理佇列），
// 不會主動呼叫 Gemini / LINE / YouTube 等外部 API，因此「正常」代表設定完整、
// 最近一次呼叫沒有錯誤，不代表外部服務當下一定可連線。

const MONGOOSE_STATE_LABELS = {
  0: '未連線',
  1: '已連線',
  2: '連線中',
  3: '中斷連線中',
};

const READINESS_TO_STATUS = {
  ready: 'ok',
  degraded: 'degraded',
  hard_fail: 'down',
  not_enabled: 'not_enabled',
};

function toStatus(readiness) {
  return READINESS_TO_STATUS[readiness] || 'unknown';
}

function firstMessage(items) {
  return Array.isArray(items) && items.length ? items[0].message : null;
}

function buildDatabaseStatus(readyState) {
  let status = 'down';
  if (readyState === 1) status = 'ok';
  else if (readyState === 2) status = 'degraded';

  return {
    key: 'database',
    name: 'MongoDB 資料庫',
    status,
    detail: MONGOOSE_STATE_LABELS[readyState] || '未知狀態',
  };
}

function buildQaStatus(qa) {
  return {
    key: 'qa',
    name: 'AI 問答',
    status: toStatus(qa.readiness),
    detail: firstMessage(qa.hardFailures)
      || firstMessage(qa.warnings)
      || `回答 ${qa.answerProvider}・檢索 ${qa.vectorSearchMode}`,
  };
}

function buildLineStatus(line) {
  const deliveryLabels = {
    live: '可接收並回覆訊息',
    backend_only: '缺 Access Token，無法回覆',
    disabled: '缺 Channel Secret，未啟用',
  };

  return {
    key: 'line',
    name: 'LINE Bot',
    status: toStatus(line.readiness),
    detail: deliveryLabels[line.deliveryMode] || line.deliveryMode,
  };
}

function buildSttStatus({ venvPythonExists, queue }) {
  const queueText = `處理中 ${queue.active}・排隊 ${queue.queued}`;

  return {
    key: 'stt',
    name: '語音轉文字 Pipeline',
    status: venvPythonExists ? 'ok' : 'degraded',
    detail: venvPythonExists
      ? queueText
      : `找不到 STT venv，將改用系統 Python・${queueText}`,
  };
}

function buildYouTubeStatus(youtube, lifecycle) {
  const base = { key: 'youtube', name: 'YouTube 自動上傳' };
  if (lifecycle?.error) return { ...base, status: 'unknown', detail: '無法讀取執行期設定' };
  const upload = lifecycle?.switches?.find((item) => item.key === 'upload');
  if (upload && !upload.effective) {
    const reasons = { env_disabled: '環境設定未允許', runtime_disabled: '執行期設定已關閉', default_off: '尚未啟用' };
    return { ...base, status: 'not_enabled', detail: reasons[upload.reason] || '功能未啟用' };
  }
  const status = toStatus(youtube.readiness);

  return {
    ...base,
    status,
    detail: status === 'not_enabled'
      ? '功能未啟用'
      : firstMessage(youtube.hardFailures) || firstMessage(youtube.warnings) || '憑證已驗證',
  };
}

function formatGb(bytes) {
  return `${(Number(bytes || 0) / (1024 ** 3)).toFixed(2)} GB`;
}

// 待處理（被隔離的上傳）與 7 天內將到期刪除的原片（decisions.md #13、#27）。
// 有待處理項目時標 degraded，提醒管理員到「YouTube 上傳管理」處理。
function buildYouTubeLifecycleStatus(lifecycle, youtube) {
  const base = { key: 'youtube_lifecycle', name: 'YouTube 待處理與清理預告' };
  if (lifecycle.error) {
    return { ...base, status: 'unknown', detail: '無法讀取待處理與到期清單' };
  }
  const { quarantineCount, upcomingCleanupCount, upcomingCleanupBytes } = lifecycle;
  const allDisabled = lifecycle.switches
    ? lifecycle.switches.every((item) => !item.effective) : toStatus(youtube.readiness) === 'not_enabled';
  if (allDisabled && !quarantineCount && !upcomingCleanupCount) {
    return { ...base, status: 'not_enabled', detail: '功能未啟用' };
  }
  return {
    ...base,
    status: quarantineCount > 0 ? 'degraded' : 'ok',
    detail: `待處理 ${quarantineCount} 支・7 天內將刪除原片 ${upcomingCleanupCount} 支（${formatGb(upcomingCleanupBytes)}）`,
  };
}

async function collectYouTubeLifecycleCounts() {
  try {
    const [quarantineCount, upcoming, settings] = await Promise.all([
      countQuarantinedItems(),
      getCleanupPreview({ scope: YOUTUBE_CLEANUP_SCOPES.UPCOMING }),
      getYouTubeLifecycleSettings(),
    ]);
    return {
      quarantineCount,
      upcomingCleanupCount: upcoming.count,
      upcomingCleanupBytes: upcoming.totalBytes,
      upcomingCleanupItems: upcoming.items,
      switches: settings.switches,
      error: null,
    };
  } catch {
    return {
      quarantineCount: null,
      upcomingCleanupCount: null,
      upcomingCleanupBytes: null,
      upcomingCleanupItems: null,
      switches: null,
      error: '無法讀取 YouTube 設定與清理預告，請稍後重試。',
    };
  }
}

function resolveSttVenvPython() {
  const sttDir = path.resolve(env.projectRoot, '../STT_Whisper');
  return process.platform === 'win32'
    ? path.join(sttDir, '.venv', 'Scripts', 'python.exe')
    : path.join(sttDir, '.venv', 'bin', 'python');
}

function buildSystemStatus({
  dbReadyState,
  qa,
  line,
  youtube,
  youtubeLifecycle = null,
  venvPythonExists,
  queue,
  checkedAt = new Date(),
}) {
  const services = [
    buildDatabaseStatus(dbReadyState),
    buildQaStatus(qa),
    buildLineStatus(line),
    buildSttStatus({ venvPythonExists, queue }),
    buildYouTubeStatus(youtube, youtubeLifecycle),
  ];
  if (youtubeLifecycle) services.push(buildYouTubeLifecycleStatus(youtubeLifecycle, youtube));

  return {
    checkedAt: checkedAt.toISOString(),
    services,
    ...(youtubeLifecycle ? {
      youtubeLifecycle: {
        quarantineCount: youtubeLifecycle.quarantineCount,
        upcomingCleanupCount: youtubeLifecycle.upcomingCleanupCount,
        upcomingCleanupBytes: youtubeLifecycle.upcomingCleanupBytes,
        upcomingCleanupItems: youtubeLifecycle.upcomingCleanupItems ?? (youtubeLifecycle.error ? null : []),
        switches: youtubeLifecycle.switches ?? null,
        error: youtubeLifecycle.error || null,
      },
    } : {}),
  };
}

async function getSystemStatus() {
  const youtubeLifecycle = await collectYouTubeLifecycleCounts();
  return buildSystemStatus({
    dbReadyState: mongoose.connection.readyState,
    qa: buildQaRuntimeSnapshot(),
    line: buildLineRuntimeSnapshot(),
    youtube: buildYouTubeUploadSnapshot(),
    youtubeLifecycle,
    venvPythonExists: existsSync(resolveSttVenvPython()),
    queue: getVideoProcessingQueueSnapshot(),
  });
}

module.exports = {
  buildSystemStatus,
  getSystemStatus,
};
