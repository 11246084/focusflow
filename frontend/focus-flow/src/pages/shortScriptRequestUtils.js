// 腳本頁與上傳短片頁共用的小工具：非同步回應的「最新請求」檢查，以及上傳頁自動重新整理的判斷。
// 兩頁都沒有請求取消機制，慢的舊回應可能比新回應晚到；每次發請求前先 next() 取得代號，
// 回應回來時用 isCurrent(代號) 確認沒有更新的請求已經開始，否則丟棄結果、不寫入 state。

export function createLatestGuard() {
  let latest = 0;
  return {
    next() {
      latest += 1;
      return latest;
    },
    isCurrent(token) {
      return token === latest;
    },
  };
}

// 自動重新整理的間隔（毫秒）。
export const AUTO_REFRESH_INTERVAL_MS = 15000;

// 還在等系統、YouTube 或審核、狀態會自己變的顯示狀態（見 services/shortScriptStatus.js 的 DISPLAY_STATUS）。
// 需要教師動手的（待拍攝上傳、重傳、可重試的失敗）與已結束的不會自己變，不列入。
const AUTO_REFRESH_STATUS_KEYS = new Set([
  'upload_waiting',
  'uploading',
  'in_review',
  'approved_waiting_upload',
  'upload_needs_admin',
]);

// items 可以是清單列（{ status: { key } }）或帶 key 的狀態物件；任一筆還在等就回 true。
export function needsAutoRefresh(items) {
  if (!Array.isArray(items)) return false;
  return items.some((item) => AUTO_REFRESH_STATUS_KEYS.has(item?.status?.key ?? item?.key));
}
