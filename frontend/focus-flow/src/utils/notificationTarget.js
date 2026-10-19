// 通知點擊後要前往的頁面。回傳 null 代表這則通知沒有可前往的頁面，只標成已讀。

export const YOUTUBE_NEEDS_REVIEW_SOURCE = 'youtube_upload_needs_review';
export const YOUTUBE_RESOLVED_SOURCE = 'youtube_upload_resolved';

export function canOpenNotificationVideo(notification = {}) {
  return Boolean(notification.videoId) && notification.videoAvailable !== false;
}

export function resolveNotificationTarget(notification = {}, role = '') {
  // 隔離通知只發給管理員，點擊後到 YouTube 上傳管理的待處理清單（#20）。
  if (notification.source === YOUTUBE_NEEDS_REVIEW_SOURCE) {
    return role === 'admin' ? { sub: 'youtubeLifecycle', section: 'quarantine' } : null;
  }
  if (notification.scriptId) {
    return { sub: 'shortScripts', scriptId: notification.scriptId, courseId: notification.courseIds?.[0] || '' };
  }
  // 管理員處理完成後通知教師：影片回課程頁；短片有 scriptId 時已在上面導到腳本頁。
  if (notification.source === YOUTUBE_RESOLVED_SOURCE) {
    return { sub: 'courses' };
  }
  if (canOpenNotificationVideo(notification)) {
    return { sub: 'courses' };
  }
  return null;
}

export function notificationTargetLabel(target) {
  if (!target) return '';
  if (target.sub === 'youtubeLifecycle') return '前往待處理 →';
  if (target.sub === 'shortScripts') return '前往腳本 →';
  return '前往課程 →';
}

// 跨頁要求捲到待處理清單：頁面未掛載時靠 sessionStorage，已掛載時靠事件。
const QUARANTINE_STORAGE_KEY = 'ff_open_youtube_quarantine';
export const OPEN_QUARANTINE_EVENT = 'ff:open-youtube-quarantine';

export function requestOpenQuarantine() {
  try {
    sessionStorage.setItem(QUARANTINE_STORAGE_KEY, '1');
  } catch {
    // Storage can be blocked; the event below still reaches a mounted page.
  }
  window.dispatchEvent(new CustomEvent(OPEN_QUARANTINE_EVENT));
}

export function consumePendingQuarantineOpen() {
  try {
    const pending = sessionStorage.getItem(QUARANTINE_STORAGE_KEY) === '1';
    sessionStorage.removeItem(QUARANTINE_STORAGE_KEY);
    return pending;
  } catch {
    return false;
  }
}
