// TODO: 後端 API 完成前，先 mock，不要真的送出。等後端 review 端點就緒後，
// 移除下方 console.log/mock，改用註解中的 apiFetch 呼叫。
// import { apiFetch } from '../api';

export async function submitVideoReview(payload) {
  console.log('[mock] submitVideoReview', payload);
  return Promise.resolve({ success: true });

  // 之後接後端時改成：
  // return apiFetch(`/videos/${payload.videoId}/review`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(payload),
  // });
}
