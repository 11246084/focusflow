// 短影片腳本頁、上傳短片頁的狀態分頁：預設選哪一頁，以及記住教師最後選的分頁（同一頁、同一課程）。

const storageKey = (page, courseId) => `ffShortTab:${page}:${courseId}`;

export function recallTab(page, courseId) {
  if (!courseId) return null;
  try { return globalThis.localStorage?.getItem(storageKey(page, courseId)) || null; } catch { return null; }
}

export function rememberTab(page, courseId, tab) {
  if (!courseId) return;
  try { globalThis.localStorage?.setItem(storageKey(page, courseId), tab); } catch { /* Storage can be disabled. */ }
}

// keys：分頁順序；counts：{ key: 筆數 }。記住的分頁優先；否則需要你處理 → 等待中 → 第一個有資料的分頁。
export function pickInitialTab(keys, counts, remembered = null) {
  if (remembered && keys.includes(remembered)) return remembered;
  if (counts.action > 0) return 'action';
  if (counts.waiting > 0) return 'waiting';
  return keys.find((key) => counts[key] > 0) || keys[0];
}
