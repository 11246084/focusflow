import { apiFetch } from '../api.js';

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

export async function createScript(courseId) {
  const response = await apiFetch(`/courses/${encodeURIComponent(courseId)}/short-scripts/auto`, {
    method: 'POST',
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

export const STATUS_LABELS = {
  evidence_ready: '證據已凍結，待生成',
  generated: '已生成，待審核',
  changes_requested: '已退回，待重新生成',
  approved: '已核准',
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
