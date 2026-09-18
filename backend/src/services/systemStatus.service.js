const path = require('path');
const { existsSync } = require('fs');
const mongoose = require('mongoose');
const env = require('../config/env');
const {
  buildQaRuntimeSnapshot,
  buildLineRuntimeSnapshot,
} = require('./runtimeDiagnostics.service');
const { buildYouTubeUploadSnapshot } = require('./youtubeUpload.service');
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

function buildYouTubeStatus(youtube) {
  const status = toStatus(youtube.readiness);

  return {
    key: 'youtube',
    name: 'YouTube 自動上傳',
    status,
    detail: status === 'not_enabled'
      ? '功能未啟用'
      : firstMessage(youtube.hardFailures) || firstMessage(youtube.warnings) || '憑證已驗證',
  };
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
  venvPythonExists,
  queue,
  checkedAt = new Date(),
}) {
  return {
    checkedAt: checkedAt.toISOString(),
    services: [
      buildDatabaseStatus(dbReadyState),
      buildQaStatus(qa),
      buildLineStatus(line),
      buildSttStatus({ venvPythonExists, queue }),
      buildYouTubeStatus(youtube),
    ],
  };
}

function getSystemStatus() {
  return buildSystemStatus({
    dbReadyState: mongoose.connection.readyState,
    qa: buildQaRuntimeSnapshot(),
    line: buildLineRuntimeSnapshot(),
    youtube: buildYouTubeUploadSnapshot(),
    venvPythonExists: existsSync(resolveSttVenvPython()),
    queue: getVideoProcessingQueueSnapshot(),
  });
}

module.exports = {
  buildSystemStatus,
  getSystemStatus,
};
