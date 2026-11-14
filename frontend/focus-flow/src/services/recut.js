import { apiFetch } from '../api.js';

// recut 教師流程的 API client（backend/docs/recut-integration-handoff.md）。
// 每個寫入都帶後端給的 versionId／expectedRevision，不在瀏覽器自行推算。

const enc = encodeURIComponent;
const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});
const scriptPath = (scriptId) => `/short-scripts/${enc(scriptId)}`;

export async function listCourses() {
  const response = await apiFetch('/courses');
  return response.data?.courses || [];
}

export async function listCandidates(courseId) {
  const response = await apiFetch(`/courses/${enc(courseId)}/short-scripts/candidates`);
  return response.data || [];
}

export async function listScripts(courseId) {
  const response = await apiFetch(`/courses/${enc(courseId)}/short-scripts`);
  return response.data || [];
}

// 建立時直接指定 recut；後端的 createScript 接受 productionMode。
export async function createRecutScript(courseId, topicKey) {
  const response = await apiFetch(`/courses/${enc(courseId)}/short-scripts/auto`,
    json('POST', { topicKey, productionMode: 'recut' }));
  return response.data;
}

export async function getScript(scriptId) {
  return (await apiFetch(scriptPath(scriptId))).data;
}

export async function setRecutMode(scriptId) {
  return (await apiFetch(`${scriptPath(scriptId)}/production-mode`, json('PATCH', { productionMode: 'recut' }))).data;
}

export async function startGeneration(scriptId) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/generate`, json('POST'))).data;
}

export async function getRecutState(scriptId) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut`)).data;
}

export async function getTask(scriptId, taskId) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/tasks/${enc(taskId)}`)).data;
}

export async function cancelTask(scriptId, taskId) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/tasks/${enc(taskId)}/cancel`, json('POST'))).data;
}

export async function getReview(scriptId) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/review`)).data;
}

const versionBody = (review) => ({ versionId: review.versionId, expectedRevision: review.revision });

export async function editSelection(scriptId, review, changes) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/selection`,
    json('PATCH', { ...versionBody(review), changes }))).data;
}

export async function restoreSelection(scriptId, review) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/selection/restore`, json('POST', versionBody(review)))).data;
}

export async function applySelection(scriptId, review) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/selection/apply`, json('POST', versionBody(review)))).data;
}

export async function applySuggestions(scriptId, review, suggestionIds, confirmedSelectionChangeIds = []) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/suggestions/apply`, json('POST', {
    ...versionBody(review), suggestionIds, confirmedSelectionChangeIds,
  }))).data;
}

export async function approveScript(scriptId, review) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/approve-script`, json('POST', versionBody(review)))).data;
}

export async function queueRender(scriptId, review) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/render`, json('POST', versionBody(review)))).data;
}

const assetBody = (review) => ({
  ...versionBody(review),
  assetId: review.recut?.currentAssetId,
  generationVersion: review.recut?.currentAssetGenerationVersion,
});

export async function approveAsset(scriptId, review) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/approve-asset`, json('POST', assetBody(review)))).data;
}

export async function rejectAsset(scriptId, review, { scope, reasons }) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/reject-asset`,
    json('POST', { ...assetBody(review), scope, reasons }))).data;
}

// 審閱計時只是試跑紀錄；失敗不影響教師操作，由呼叫端吞掉錯誤。
export async function startReviewTimer(scriptId, review, phase) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/review-time`,
    json('POST', { ...versionBody(review), action: 'start', phase }))).data;
}

export async function stopReviewTimer(scriptId, { versionId, timingId, phase }) {
  return (await apiFetch(`${scriptPath(scriptId)}/recut/review-time`,
    json('POST', { versionId, timingId, action: 'stop', phase }))).data;
}

export async function getShortAsset(assetId) {
  return (await apiFetch(`/shorts/${enc(assetId)}`)).data;
}

// ── 同意 ─────────────────────────────────────────────────────────

export async function getConsentTerms() {
  return (await apiFetch('/recut-consent/terms')).data;
}

export async function getConsent(courseId) {
  return (await apiFetch(`/courses/${enc(courseId)}/recut-consent`)).data;
}

export async function recordConsent(courseId, { kind, choice, termsVersion, requestId }) {
  return (await apiFetch(`/courses/${enc(courseId)}/recut-consent`,
    json('POST', { kind, choice, termsVersion, requestId }))).data;
}

export async function listWithdrawalAssets(courseId, kind) {
  return (await apiFetch(`/courses/${enc(courseId)}/recut-consent/withdrawal-assets?kind=${enc(kind)}`)).data;
}

export async function withdrawConsent(courseId, { kind, termsVersion, requestId, selectedAssetIds, selectAll }) {
  const body = { kind, termsVersion, requestId };
  if (selectAll) body.selectAll = true;
  else body.selectedAssetIds = selectedAssetIds || [];
  return (await apiFetch(`/courses/${enc(courseId)}/recut-consent/withdrawals`, json('POST', body))).data;
}

export async function retryWithdrawal(courseId, withdrawalId) {
  return (await apiFetch(`/courses/${enc(courseId)}/recut-consent/withdrawals/${enc(withdrawalId)}/retry`, json('POST'))).data;
}
