import { getToken } from '../api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

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

// Integration point: when POST /api/batches/videos exists, replace this
// sequential adapter and return the backend-created batchId plus items.
export async function uploadCourseVideos({ courseId, items, onItemChange }) {
  const uploaded = [];
  for (const item of items) {
    onItemChange(item.key, { uploadStatus: 'uploading', error: '' });
    try {
      const video = await uploadSingleCourseVideo({
        courseId,
        file: item.file,
        title: item.title,
      });
      const videoId = video._id || video.id || '';
      if (!videoId) throw new Error('上傳成功，但後端沒有回傳 videoId。');
      const result = {
        key: item.key,
        name: item.file.name,
        videoId,
        processingStatus: video.processing?.status || 'queued',
      };
      uploaded.push(result);
      onItemChange(item.key, {
        uploadStatus: 'processing',
        videoId,
        processingStatus: result.processingStatus,
      });
    } catch (error) {
      onItemChange(item.key, {
        uploadStatus: 'failed',
        processingStatus: 'failed',
        error: error.message || '上傳失敗，請稍後再試。',
      });
    }
  }
  return uploaded;
}
