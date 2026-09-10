import { apiFetch, getToken } from '../api.js';

const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

// 短影片腳本自動化的 API client（backend docs/2026-09_Short_Script_Automation）。
//
// 後端的 feature flag SHORT_SCRIPT_AUTOMATION_ENABLED 預設關閉，關閉時整組路由回 404。
// 呼叫端要能分辨「功能未啟用」與「資源不存在」，因此提供 isFeatureDisabledError。

export const FEEDBACK_TYPES = [
  { value: 'retrieval', label: '講錯了／漏了重點', hint: '系統會重新撈證據再生成' },
  { value: 'narrative', label: '開頭不吸引人／節奏問題', hint: '沿用同一份證據，只重寫敘事' },
];

// 功能未啟用與腳本不存在都是 404，但錯誤碼不同：未啟用是 NOT_FOUND，
// 腳本不存在是 SHORT_SCRIPT_NOT_FOUND。
export function isFeatureDisabledError(error) {
  return error?.status === 404 && error?.code === 'NOT_FOUND';
}

export async function listCourses() {
  const response = await apiFetch('/courses');
  return response.data?.courses || [];
}

export async function listCandidates(courseId) {
  const response = await apiFetch(`/courses/${encodeURIComponent(courseId)}/short-scripts/candidates`);
  return { candidates: response.data || [], meta: response.meta || {} };
}

export async function listScripts(courseId) {
  const response = await apiFetch(`/courses/${encodeURIComponent(courseId)}/short-scripts`);
  return response.data || [];
}

// topicKey 省略時後端照 DR-12 的排序自動選；帶了就只評估那一題。
export async function createScript(courseId, topicKey = null) {
  const response = await apiFetch(`/courses/${encodeURIComponent(courseId)}/short-scripts/auto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(topicKey ? { topicKey } : {}),
  });
  return response.data;
}

export async function getScript(scriptId) {
  const response = await apiFetch(`/short-scripts/${encodeURIComponent(scriptId)}`);
  return response.data;
}

export async function generateVersion(scriptId) {
  const response = await apiFetch(`/short-scripts/${encodeURIComponent(scriptId)}/generate`, {
    method: 'POST',
  });
  return response.data;
}

export async function reviewScript(scriptId, { decision, feedback, feedbackType }) {
  const body = { decision };
  if (feedback) body.feedback = feedback;
  if (feedbackType) body.feedbackType = feedbackType;

  const response = await apiFetch(`/short-scripts/${encodeURIComponent(scriptId)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.data;
}

// ── 成品（ShortAsset）─────────────────────────────────────────────
// 教師上傳只建立 draft，實際上架由成品審核通過觸發（規格書 R-08）。

export const ASSET_UPLOAD_LABELS = {
  uploading: '上架中',
  uploaded: '已上架 YouTube',
  failed: '上架失敗',
};

export const ASSET_REVIEW_LABELS = {
  pending: '待審核',
  approved: '審核通過',
  rejected: '已退回',
};

// 上傳走 multipart，不能用 apiFetch（它不處理 FormData，且會被 Content-Type 蓋掉 boundary）。
// 錯誤物件的形狀要與 apiFetch 一致（message / code / status），呼叫端的 describeError 才吃得到。
async function requestUpload(path, formData) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });

  // nginx 擋下超大檔案時回的是 HTML 不是 JSON，解析失敗只會得到空物件；
  // 這種情況要給教師看得懂的原因，而不是 'Request failed'。
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status === 413
      ? '影片檔案超過伺服器允許的上傳大小。'
      : 'Request failed';
    const error = new Error(data.message || fallback);
    error.code = data.error?.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function listAssets(courseId) {
  const response = await apiFetch(`/courses/${encodeURIComponent(courseId)}/short-assets`);
  return response.data || [];
}

// versionNo 必填：退回理由會寫回這一版腳本（DR-20），記錯版本等於把意見套到教師沒看過的腳本上。
export async function uploadAsset(scriptId, { file, title, description, versionNo }) {
  const formData = new FormData();
  formData.append('video', file);
  formData.append('title', title);
  if (description) formData.append('description', description);
  if (versionNo) formData.append('versionNo', String(versionNo));
  // 兩個確認旗標由教師在 UI 明示勾選；系統不代為取得也不檢查真偽（規格書 R-07 / 附錄 K.5）。
  formData.append('aiDisclosureConfirmed', 'true');
  formData.append('consentConfirmed', 'true');

  const response = await requestUpload(
    `/short-scripts/${encodeURIComponent(scriptId)}/asset`,
    formData,
  );
  return response.data;
}

export async function retryAssetUpload(assetId) {
  const response = await apiFetch(`/short-assets/${encodeURIComponent(assetId)}/upload/retry`, {
    method: 'POST',
  });
  return response.data;
}

export const STATUS_LABELS = {
  evidence_ready: '證據已凍結，待生成',
  generated: '已生成',
  changes_requested: '已退回，待重新生成',
  // approved 只有一種來源：這份腳本的影片已成功上架 YouTube，人工按不出來。
  approved: '已上架',
  dismissed: '已否決',
};

export function latestVersion(script) {
  const versions = script?.versions || [];
  return versions[versions.length - 1] || null;
}

// 把秒數轉成 m:ss，與後端引用的時間戳一致，方便教師對照原片。
export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
