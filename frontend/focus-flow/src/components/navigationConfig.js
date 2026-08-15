export const navItems = {
  student: [{ id: 'home', ic: 'home', label: 'Dashboard' }, { id: 'courses', ic: 'book', label: 'My Courses' }, { id: 'linebot', ic: 'chat', label: 'Line Bot' }, { id: 'shorts', ic: 'play', label: '教學短片' }],
  teacher: [{ id: 'home', ic: 'home', label: 'Dashboard' }, { id: 'courses', ic: 'film', label: 'Course Videos' }, { id: 'upload', ic: 'up', label: 'Upload' }],
  admin:   [{ id: 'home', ic: 'home', label: 'Overview' }, { id: 'users', ic: 'users', label: 'Users' }, { id: 'courses', ic: 'book', label: 'Courses' }, { id: 'videos', ic: 'film', label: 'Videos' }, { id: 'stats', ic: 'bar', label: 'Statistics' }],
};

export const roleLabels = { student: '學生 · Student', teacher: '教師 · Teacher', admin: '管理員 · Admin' };
export const roleDot    = { student: '#a5b4fc', teacher: '#4ade80', admin: '#F14F21' };

export const topbarMap = {
  // The student home fallback is identity-neutral; DashboardApp replaces it
  // with the authenticated display name when available.
  student: { home: ['Dashboard', '歡迎回來'], courses: ['My Courses', '追蹤學習進度'], linebot: ['Line Bot', '即時問答 · 秒回片段'], shorts: ['教學短片', '瀏覽 FocusFlow 頻道影片'], profile: ['個人資料', '管理帳號資訊'] },
  teacher: { home: ['Dashboard', '管理課程與影片'], courses: ['Course Videos', '已上傳影片清單'], upload: ['Upload Video', '影片上傳後自動建立 AI 索引'], profile: ['個人資料', '管理帳號資訊'] },
  admin:   { home: ['System Overview', '監控整體系統運作'], users: ['User Management', '學生 / 教師帳號'], courses: ['Course Management', '課程新增 / 編輯 / 刪除'], videos: ['Video Library', '全系統影片管理'], stats: ['Statistics', 'usage_logs 統計'], profile: ['個人資料', '管理帳號資訊'] },
};
