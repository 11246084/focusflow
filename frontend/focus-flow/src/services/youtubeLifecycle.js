import { apiFetch, buildApiError, getToken } from '../api.js';

// YouTube 上傳恢復與原片清理（docs/04_Features/YouTube_Lifecycle/decisions.md）的前端 API。
// 所有呼叫集中在這裡，後端格式調整時只需改這個檔案。

const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

export const SWITCH_KEYS = ['upload', 'recovery', 'cleanup'];

export const SWITCH_META = {
  upload: {
    label: '自動上傳',
    description: '影片處理完成後自動上傳到系統 YouTube 頻道（不公開）。',
    envVar: 'YOUTUBE_UPLOAD_ENABLED',
    defaultEnabled: true,
  },
  recovery: {
    label: '失敗恢復',
    description: '定期重傳可安全重試的失敗，並隔離卡在上傳中的影片。',
    envVar: 'YOUTUBE_UPLOAD_RECOVERY_ENABLED',
    defaultEnabled: true,
  },
  cleanup: {
    label: '原片清理',
    description: '依可用空間與保留期刪除已上傳完成的原片，刪除後無法自動取回。',
    envVar: 'YOUTUBE_UPLOAD_CLEANUP_ENABLED',
    defaultEnabled: false,
  },
};

export const KIND_LABELS = { video: '影片', short_asset: '短片' };
const KIND_PATHS = { video: 'videos', short_asset: 'short-assets' };

export const CLEANUP_REASON_LABELS = {
  max_age: '超過最長保留期',
  low_space: '可用空間不足',
};

function kindPath(kind) {
  const segment = KIND_PATHS[kind];
  if (!segment) throw new Error(`未知的項目類型：${kind}`);
  return segment;
}

function jsonRequest(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

// ---- 兩層開關 ----

export async function getLifecycleSettings() {
  const res = await apiFetch('/admin/youtube-lifecycle/settings');
  return res.data;
}

export async function updateLifecycleSwitch(key, enabled) {
  const res = await apiFetch('/admin/youtube-lifecycle/settings', jsonRequest('PATCH', { key, enabled: Boolean(enabled) }));
  return res.data;
}

export async function getCleanupPreview(scope) {
  const res = await apiFetch(`/admin/youtube-lifecycle/cleanup-preview?scope=${encodeURIComponent(scope)}`);
  return res.data;
}

export async function runRecoveryNow() {
  const res = await apiFetch('/admin/youtube-lifecycle/recovery/run', jsonRequest('POST'));
  return res.data;
}

// ---- 隔離收尾 ----

// 後端若在清單上附 searchable，畫面一開始就能決定要不要顯示「查詢 YouTube」；
// 沒有附時視為未知，等第一次查詢的結果再決定。
export async function listQuarantine() {
  const res = await apiFetch('/admin/youtube-quarantine');
  return {
    items: res.data?.items || [],
    searchable: typeof res.data?.searchable === 'boolean' ? res.data.searchable : null,
  };
}

export async function lookupQuarantineItem(kind, id) {
  const res = await apiFetch(
    `/admin/youtube-quarantine/${kindPath(kind)}/${encodeURIComponent(id)}/lookup`,
    jsonRequest('POST'),
  );
  return res.data;
}

export async function applyQuarantineItem(kind, id, youtubeVideoId) {
  const res = await apiFetch(
    `/admin/youtube-quarantine/${kindPath(kind)}/${encodeURIComponent(id)}/apply`,
    jsonRequest('POST', { youtubeVideoId }),
  );
  return res.data;
}

export async function resetQuarantineItem(kind, id) {
  const res = await apiFetch(
    `/admin/youtube-quarantine/${kindPath(kind)}/${encodeURIComponent(id)}/reset`,
    jsonRequest('POST'),
  );
  return res.data;
}

// ---- 補回原片 ----

// 欄位名沿用單支影片上傳的 `video`，後端可共用同一套 multer 與容器檢查。
export async function restoreVideoSource(videoId, file) {
  const formData = new FormData();
  formData.append('video', file);
  const response = await fetch(`${API_BASE}/videos/${encodeURIComponent(videoId)}/source/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw buildApiError({ status: response.status, data });
  return data.data?.video || data.data || {};
}

// ---- 畫面判斷（純函式，供測試） ----

// 回傳開關在畫面上的狀態：是否生效、能否切換、說明文字，以及按下後要送出的值。
export function describeSwitch(sw = {}) {
  const meta = SWITCH_META[sw.key] || { label: sw.key, description: '', envVar: '', defaultEnabled: false };
  const effective = Boolean(sw.effective);
  const toggleable = sw.envAllowed === true;
  let note;
  if (!toggleable) {
    note = `環境未允許：VM 的 ${meta.envVar} 未開啟，需由有主機權限的人修改並重啟後才能切換。`;
  } else if (sw.runtimeEnabled === null || sw.runtimeEnabled === undefined) {
    note = meta.defaultEnabled
      ? '尚未在此設定，依預設為開啟。'
      : '尚未在此設定，依預設為關閉，需明確啟用一次。';
  } else if (sw.runtimeEnabled) {
    note = '已由管理員啟用。';
  } else {
    note = '已由管理員停用。';
  }
  return {
    key: sw.key,
    label: meta.label,
    description: meta.description,
    effective,
    toggleable,
    unset: sw.runtimeEnabled === null || sw.runtimeEnabled === undefined,
    note,
    nextEnabled: !effective,
  };
}

export function describeSwitchChange(key, enabled) {
  const label = SWITCH_META[key]?.label || key;
  return enabled ? `啟用「${label}」` : `停用「${label}」`;
}

const SWITCH_CHANGE_NOTES = {
  'upload:true': '之後處理完成的影片會自動上傳到 YouTube。',
  'upload:false': '之後處理完成的影片不會上傳到 YouTube；正在上傳的影片會傳完。',
  'recovery:true': '排程下一輪起會重傳可安全重試的失敗，並隔離卡住的影片。',
  'recovery:false': '排程與「立即執行恢復」都會停止；已排入的重試不會再執行。',
  'cleanup:false': '排程停止刪除原片；這一輪已刪除的檔案無法取回。',
};

// 切換開關前要給管理員確認的內容。
export async function prepareSwitchChange(sw) {
  const view = describeSwitch(sw);
  if (!view.toggleable) throw new Error(view.note);
  const enabled = view.nextEnabled;
  const plan = {
    key: view.key,
    enabled,
    title: describeSwitchChange(view.key, enabled),
    summary: SWITCH_CHANGE_NOTES[`${view.key}:${enabled}`] || '',
    preview: null,
    danger: !enabled || view.key === 'cleanup',
  };
  return plan;
}

export function formatHistoryValue(value) {
  if (value === null || value === undefined) return '未設定';
  return value ? '開啟' : '關閉';
}
