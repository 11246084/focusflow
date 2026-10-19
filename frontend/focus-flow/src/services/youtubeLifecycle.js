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

// 啟用清理是唯一需要先看預告的切換（#27①）。
export function needsCleanupPreview(key, nextEnabled) {
  return key === 'cleanup' && nextEnabled === true;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${value} B`;
}

export function buildCleanupEnableSummary(preview = {}) {
  const count = Number(preview.count) || 0;
  if (count === 0) return '目前沒有符合條件的原片，啟用後不會立即刪除任何檔案。';
  return `啟用後會立即刪除 ${count} 支（共 ${formatBytes(preview.totalBytes)}）原片，刪除後無法自動取回。`;
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

// 切換開關前要給管理員確認的內容。啟用清理會先向後端取「啟用後立即刪除」清單（#27①），
// 取不到清單就不讓啟用，避免在不知道影響範圍時刪檔。
export async function prepareSwitchChange(sw, { fetchPreview = getCleanupPreview } = {}) {
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
  if (needsCleanupPreview(view.key, enabled)) {
    const preview = await fetchPreview('enable');
    plan.preview = { ...preview, items: preview?.items || [] };
    plan.summary = buildCleanupEnableSummary(preview);
    plan.danger = true;
  }
  return plan;
}

// 待處理清單每一筆要顯示哪些操作（#17）。
// searchable：false 代表憑證不能讀頻道，隱藏查詢、改手動輸入；null 代表還不知道。
export function getQuarantineControls({ searchable = null, lookup = null } = {}) {
  const channelReadable = lookup?.searchable ?? searchable;
  const lookedUp = Boolean(lookup && !lookup.loading && !lookup.error && lookup.searchable !== undefined);
  return {
    showLookup: channelReadable !== false,
    showManualInput: channelReadable === false || (lookedUp && (lookup.matches || []).length === 0),
    matches: lookup?.matches || [],
  };
}

export function describeApplyConfirm(item, match) {
  const label = KIND_LABELS[item.kind] || '項目';
  return {
    title: '確認套用 YouTube 影片',
    summary: `系統會先向 YouTube 確認影片 ${match.youtubeVideoId} 存在且屬於自家頻道，`
      + `再把「${item.title || '未命名'}」標成已上傳並改用這支 YouTube 影片播放。填錯會讓學生看到別的影片。`,
    detail: match.title ? `YouTube 標題：${match.title}` : `這支${label}的 YouTube 影片 ID：${match.youtubeVideoId}`,
  };
}

export function describeResetConfirm(item) {
  return {
    title: '重設為可重試',
    summary: `只在確定 YouTube 上沒有「${item.title || '未命名'}」時使用。重設後重試次數歸零，`
      + '恢復排程會重新上傳；如果其實已經上傳過，頻道會出現兩支相同的影片。',
  };
}

export function formatHistoryValue(value) {
  if (value === null || value === undefined) return '未設定';
  return value ? '開啟' : '關閉';
}

export function formatRecoveryResult(result = {}) {
  const recovered = Number(result.recovered) || 0;
  const quarantined = Number(result.quarantined) || 0;
  const skipped = Number(result.skipped) || 0;
  return `已執行恢復：重新排入 ${recovered} 支、隔離 ${quarantined} 支、略過 ${skipped} 支。`;
}

// 管理員手動輸入時接受影片 ID 或常見 YouTube 網址；格式不符回傳空字串。
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(input) {
  const text = String(input || '').trim();
  if (YOUTUBE_ID_PATTERN.test(text)) return text;
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let candidate = '';
  if (host === 'youtu.be') {
    candidate = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'studio.youtube.com') {
    candidate = url.searchParams.get('v')
      || url.pathname.match(/^\/(?:shorts|embed|live|video)\/([^/]+)/)?.[1]
      || '';
  }
  return YOUTUBE_ID_PATTERN.test(candidate) ? candidate : '';
}

export function quarantineItemKey(item) {
  return `${item.kind}:${item.id}`;
}
