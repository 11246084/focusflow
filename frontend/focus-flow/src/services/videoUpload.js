import { apiFetch } from '../api.js';

export async function uploadSingleCourseVideo({ courseId, file, title }) {
  const formData = new FormData();
  formData.append('video', file);
  if (title) formData.append('title', title);

  const data = await apiFetch(`/courses/${courseId}/videos`, { method: 'POST', body: formData });
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

  const data = await apiFetch(`/courses/${courseId}/video-batches`, { method: 'POST', body: formData });

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
  const results = batch.items.map((result, index) => {
    const duplicate = result.errorCode === 'DUPLICATE_VIDEO';
    return ({
    key: items[index]?.key || result.itemId,
    itemId: result.itemId,
    name: result.originalName || items[index]?.file?.name || `影片 ${index + 1}`,
    videoId: result.videoId || '',
    uploadStatus: duplicate ? 'duplicate' : result.uploadStatus === 'failed' ? 'failed' : 'processing',
    processingStatus: result.processingStatus || (duplicate ? 'duplicate' : result.status || 'queued'),
    errorCode: result.errorCode || '',
    error: result.errorMessage || '',
    });
  });
  results.forEach((result) => onItemChange(result.key, result));
  return { batchId: batch.batchId, items: results };
}
