import { apiFetch } from '../api.js';

export const REVIEW_REASON_CODES = [
  'contentIncorrect',
  'audioIssue',
  'visualQuality',
  'subtitleIssue',
  'incomplete',
  'other',
];

export async function listShortAssets({ reviewStatus = 'pending', limit = 50 } = {}) {
  const query = new URLSearchParams({ reviewStatus, limit: String(limit) });
  const response = await apiFetch(`/shorts?${query.toString()}`);
  return response.data;
}

export async function getShortAsset(shortAssetId) {
  const response = await apiFetch(`/shorts/${encodeURIComponent(shortAssetId)}`);
  return response.data;
}

export function buildReviewRequest({ status, expectedGenerationVersion, reasons = [] }) {
  const body = { status, expectedGenerationVersion };
  if (status === 'rejected') body.reasons = reasons;
  return body;
}

export function validateRejectionReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return '請至少勾選一項不通過理由。';
  }
  if (reasons.some((reason) => !REVIEW_REASON_CODES.includes(reason.code))) {
    return '包含無效的不通過理由。';
  }
  if (reasons.some((reason) => String(reason.note || '').length > 500)) {
    return '每項說明最多 500 字。';
  }
  const other = reasons.find((reason) => reason.code === 'other');
  if (other && !String(other.note || '').trim()) {
    return '已勾選「其他」，請填寫必填說明。';
  }
  return '';
}

export async function submitVideoReview({
  shortAssetId,
  status,
  expectedGenerationVersion,
  reasons,
}) {
  const response = await apiFetch(`/shorts/${encodeURIComponent(shortAssetId)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildReviewRequest({ status, expectedGenerationVersion, reasons })),
  });
  return response.data;
}

export function shouldReloadAfterReviewError(error) {
  return error?.code === 'SHORT_ASSET_REVIEW_STALE'
    || error?.code === 'SHORT_ASSET_REVIEW_CONFLICT';
}

export async function submitReviewAndReadback(
  review,
  { submit = submitVideoReview, readback = getShortAsset } = {},
) {
  try {
    await submit(review);
    return await readback(review.shortAssetId);
  } catch (error) {
    if (shouldReloadAfterReviewError(error)) {
      try {
        error.latestAsset = await readback(review.shortAssetId);
      } catch {
        error.reloadFailed = true;
      }
    }
    throw error;
  }
}

export function getReviewErrorMessage(error) {
  switch (error?.code) {
    case 'SHORT_ASSET_REVIEW_STALE':
      return error.reloadFailed
        ? '素材版本已更新，但無法自動載入最新內容。請手動重新讀取後再審核。'
        : '素材版本已更新，已重新載入最新內容。請重新確認後再送出。';
    case 'SHORT_ASSET_REVIEW_CONFLICT':
      return error.reloadFailed
        ? '審核狀態已被其他操作改變，但無法自動載入目前結果。請手動重新讀取。'
        : '審核狀態已被其他操作改變，已重新載入目前結果，不會覆蓋既有審核。';
    case 'SHORT_ASSET_ACCESS_DENIED':
      return '你沒有權限審核這支短影片。';
    case 'SHORT_ASSET_NOT_FOUND':
      return '找不到這支短影片，可能已被移除。';
    case 'VALIDATION_ERROR':
      return error.message || '送出的審核資料格式不正確，請檢查後再試。';
    default:
      if (error?.status >= 500) return '伺服器暫時無法處理審核，請稍後手動重試。';
      if (!error?.status) return '無法連線到伺服器，請檢查網路後手動重試。';
      return error?.message || '審核操作失敗，請稍後再試。';
  }
}
