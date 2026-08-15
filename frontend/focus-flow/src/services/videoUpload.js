import { getToken } from '../api.js';

const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

export async function uploadSingleCourseVideo({ courseId, file, title }) {
  const formData = new FormData();
  formData.append('video', file);
  if (title) formData.append('title', title);

  const response = await fetch(`${API_BASE}/courses/${courseId}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || '上傳失敗');
  return data.data?.video || data.data || {};
}

export async function uploadCourseVideos({ courseId, items, onItemChange }) {
  // All files share one Backend batch contract. Item order is intentionally
  // preserved so the response can be reconciled with the user's selections.
  for (const item of items) {
    onItemChange(item.key, { uploadStatus: 'uploading', error: '' });
  }

  const formData = new FormData();
  formData.append('titles', JSON.stringify(items.map((item) => item.title || '')));
  items.forEach((item) => formData.append('videos', item.file));

  const response = await fetch(`${API_BASE}/courses/${courseId}/video-batches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || '批次上傳失敗');
    error.code = data.error?.code;
    throw error;
  }

  const batch = data.data?.batch;
  // Reject malformed success responses instead of displaying an untrackable
  // upload that cannot be resumed after refresh.
  if (
    !batch?.batchId
    || !Array.isArray(batch.items)
    || batch.items.length !== items.length
    || batch.items.some((item) => !item?.itemId)
    || new Set(batch.items.map((item) => item.itemId)).size !== batch.items.length
  ) {
    throw new Error('批次已建立，但後端回傳格式不完整。');
  }
  const results = batch.items.map((result, index) => ({
    key: items[index]?.key || result.itemId,
    itemId: result.itemId,
    name: result.originalName || items[index]?.file?.name || `影片 ${index + 1}`,
    videoId: result.videoId || '',
    uploadStatus: result.uploadStatus === 'failed' ? 'failed' : 'processing',
    processingStatus: result.processingStatus || result.status || 'queued',
    error: result.errorMessage || '',
  }));
  results.forEach((result) => onItemChange(result.key, result));
  return { batchId: batch.batchId, items: results };
}
