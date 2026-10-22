// 「延伸學習」區塊（教育開放資料：國家教育研究院愛學網）的前端輔助函式。
// 區塊是答案之外的補充，任何失敗都只是不顯示，不能影響問答本身。

// 只對本次對話最後一則已完成的 AI 回答查詢，避免恢復舊對話時對每則歷史回答各打一次 API。
export function findExtendedResourcesQuestion(messages, index) {
  if (index !== messages.length - 1) return '';
  const message = messages[index];
  if (!message || message.role === 'user' || message.status === 'failed') return '';
  const previous = messages[index - 1];
  if (!previous || previous.role !== 'user') return '';
  return String(previous.content || '').trim();
}

// 影片網址會直接變成可點連結，只接受 http(s)。
export function isSafeVideoUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function pickDisplayVideos(data) {
  const videos = Array.isArray(data?.videos) ? data.videos : [];
  return videos.filter((video) => video?.title && isSafeVideoUrl(video.videoUrl)).slice(0, 3);
}

export function formatVideoMeta(video) {
  return [video.learningField, video.learningStage].filter(Boolean).join('・');
}

// 後端 flag 關閉時回 404 NOT_FOUND；確認一次後本次載入內不再重複呼叫。
export function isFeatureDisabledError(error) {
  return error?.status === 404 && error?.code === 'NOT_FOUND';
}
