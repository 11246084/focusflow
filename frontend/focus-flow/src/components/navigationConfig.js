export const navItems = {
  student: [{ id: 'home', ic: 'home', label: '總覽' }, { id: 'courses', ic: 'book', label: '我的課程' }, { id: 'linebot', ic: 'chat', label: 'LINE 提問' }, { id: 'shorts', ic: 'play', label: '教學短片' }],
  teacher: [{ id: 'home', ic: 'home', label: '總覽' }, { id: 'courses', ic: 'film', label: '課程管理' }, { id: 'upload', ic: 'up', label: '上傳影片' }, { id: 'shortScripts', ic: 'book', label: '短影片腳本' }, { id: 'reviewShorts', ic: 'play', label: '短影片審核' }],
  admin:   [{ id: 'home', ic: 'home', label: '系統總覽' }, { id: 'users', ic: 'users', label: '使用者' }, { id: 'courses', ic: 'book', label: '課程' }, { id: 'videos', ic: 'film', label: '影片' }, { id: 'feedback', ic: 'chat', label: '問題回報' }, { id: 'stats', ic: 'bar', label: '使用統計' }],
};

export const roleLabels = { student: '學生', teacher: '教師', admin: '管理員' };
export const roleDot    = { student: '#a5b4fc', teacher: '#4ade80', admin: '#F14F21' };

export const topbarMap = {
  // The student home fallback is identity-neutral; DashboardApp replaces it
  // with the authenticated display name when available.
  student: { home: ['總覽', '歡迎回來'], courses: ['我的課程', '觀看影片並向 AI 提問'], linebot: ['LINE 提問', '在 LINE 上提問課程內容'], shorts: ['教學短片', '瀏覽 FocusFlow 頻道影片'], profile: ['個人資料', '管理帳號資訊'] },
  teacher: { home: ['總覽', '管理課程與影片'], courses: ['課程管理', '課程、影片與修課學生'], upload: ['上傳影片', '影片上傳後自動建立 AI 索引'], shortScripts: ['短影片腳本', '自動選題、生成腳本並審核引用'], reviewShorts: ['短影片審核', '審核 AI 生成短影片是否通過'], profile: ['個人資料', '管理帳號資訊'] },
  admin:   { home: ['系統總覽', '監控整體系統運作'], users: ['使用者管理', '學生 / 教師帳號'], courses: ['課程管理', '課程新增 / 編輯 / 刪除'], videos: ['影片管理', '全系統影片管理'], feedback: ['問題回報', '學生與教師回報的問題與建議'], stats: ['使用統計', '使用紀錄統計'], profile: ['個人資料', '管理帳號資訊'] },
};

// URL 路徑與頁面代號的對應：讓重新整理停在原頁、瀏覽器上一頁可以返回。
export const pagePaths = {
  home: 'home',
  courses: 'courses',
  linebot: 'line',
  shorts: 'shorts',
  upload: 'upload',
  shortScripts: 'short-scripts',
  reviewShorts: 'short-reviews',
  users: 'users',
  videos: 'videos',
  feedback: 'feedback',
  stats: 'stats',
  profile: 'profile',
};

export function isValidSubPage(role, sub) {
  if (sub === 'profile') return true;
  return (navItems[role] || []).some((item) => item.id === sub);
}
