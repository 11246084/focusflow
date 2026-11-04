// 短影片腳本頁與上傳短片頁共用的樣式常數。版面照專案既有頁面的寫法
// （TeacherCourses.jsx / TeacherVideoReview.jsx）：Space Grotesk 標題、.card 大卡片、
// 列與列之間用 1px 分隔線，強調色 #F14F21。.card / .card-sm 只給背景與圓角，padding 由各處 inline 指定。
export const HEADING = { fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' };
export const SECTION_LABEL = {
  color: 'rgba(255,255,255,0.45)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
};
export const MUTED = { color: 'rgba(255,255,255,0.55)', fontSize: 13 };
export const BODY = { color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 1.7 };
export const DIVIDER = '1px solid rgba(255,255,255,0.05)';
export const ACCENT = '#F14F21';
export const SMALL_BTN = { padding: '9px 16px', fontSize: 12.5 };
export const GHOST_BTN = {
  ...SMALL_BTN,
  background: 'rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.86)',
  border: '1px solid rgba(255,255,255,0.16)',
};

// apiFetch 的訊息已轉成中文通用說明（例如 nginx 回 502 的 HTML 時），
// 光看這句話無法分辨是權限、路由不存在還是後端掛了。把狀態碼與錯誤碼一起顯示。
export function describeError(error) {
  const parts = [error.status, error.code].filter(Boolean).join(' ');
  return parts ? `${error.message}（${parts}）` : error.message;
}
