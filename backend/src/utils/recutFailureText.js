// 給教師看的 recut 失敗說明：只寫一般人看得懂的一句話，不帶內部訊息。
// 原始錯誤（error.code / error.message）仍完整保存在 RecutTask.error 與日誌，供管理員查詢。
const KEEP_ORIGINAL = '已保留原本的版本，可以到短影片製作頁重新產生。';

const GENERIC = `這支短片這次沒有做成，${KEEP_ORIGINAL}`;

const TEXT_BY_CODE = {
  RECUT_CALL_LIMIT_EXCEEDED: '這支短片的 AI 使用次數已用完，已保留原本的版本，請聯絡管理員。',
  RECUT_SOURCE_UNAVAILABLE: `找不到這門課的原片檔案，${KEEP_ORIGINAL}請先確認原片仍在系統上。`,
  RECUT_SOURCE_UNDECODABLE: `這門課的原片檔案無法讀取，${KEEP_ORIGINAL}請先確認原片可以正常播放。`,
  RECUT_SOURCE_UPDATED: '原片的逐字稿剛更新過，已保留原本的版本，請重新產生講稿。',
  RECUT_SOURCE_TOO_SHORT: `原片的內容不足以做成短片，${KEEP_ORIGINAL}可以換一個主題。`,
  RECUT_WINDOW_NOT_FOUND: `原片裡找不到足夠的內容可以做成短片，${KEEP_ORIGINAL}可以換一個主題。`,
  SHORT_SCRIPT_NO_CANDIDATE: `這個主題目前沒有足夠的內容可以做成短片，${KEEP_ORIGINAL}可以換一個主題。`,
  SHORT_SCRIPT_EVIDENCE_EMPTY: `原片裡找不到能回答這個主題的段落，${KEEP_ORIGINAL}可以換一個主題。`,
  RECUT_REPAIR_STALLED: `AI 產生的內容一直沒有達到標準，${KEEP_ORIGINAL}可以調整講稿或換一個主題再試。`,
  RECUT_VALIDATION_FAILED: `AI 產生的內容一直沒有達到標準，${KEEP_ORIGINAL}可以調整講稿或換一個主題再試。`,
  RECUT_MODEL_FAILED: `AI 暫時無法完成，${KEEP_ORIGINAL}`,
  RECUT_MODEL_UNAVAILABLE: `AI 暫時無法使用，${KEEP_ORIGINAL}`,
  RECUT_TASK_INTERRUPTED: `系統重新啟動中斷了處理，${KEEP_ORIGINAL}`,
};

function recutTaskFailureText(error) {
  return TEXT_BY_CODE[error?.code] || GENERIC;
}

const RENDER_GENERIC = '短片沒有製作完成，可以回到短影片製作頁重新製作一次。';
const RENDER_TEXT_BY_CODE = {
  RECUT_TEXT_OVERFLOW: '圖卡文字太長放不下，請回到短影片製作頁縮短或換掉較長的句子後再製作。',
  RECUT_RENDER_AUDIO_LOWERED: '製作時聲音處理異常，已通知管理員檢查。',
  RECUT_RENDER_CHECK_FAILED: '影片沒有通過聲音或長度檢查，已通知管理員檢查。',
};

function recutRenderFailureText(error) {
  return RENDER_TEXT_BY_CODE[error?.code] || RENDER_GENERIC;
}

module.exports = { recutTaskFailureText, recutRenderFailureText, TASK_FAILURE_GENERIC: GENERIC, RENDER_FAILURE_GENERIC: RENDER_GENERIC };
