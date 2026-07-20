export const Ic = ({ n, s = 18, c = 'currentColor' }) => {
  const d = {
    bolt: <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill={c} strokeLinejoin="round"/></svg>,
    home: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    book: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>,
    chat: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
    up: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>,
    film: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="2" y1="17" x2="7" y2="17"/></svg>,
    users: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
    bar: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    bell: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
    out: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    plus: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    eye: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    search: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    play: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
    check: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    link: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
    dot: <svg width={s} height={s} viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>,
    spark: <svg width={s} height={s} viewBox="0 0 32 32" fill="none"><path d="M16 3l1.8 11.2L29 16l-11.2 1.8L16 29l-1.8-11.2L3 16l11.2-1.8Z" fill="currentColor" opacity=".9"/><circle cx="26" cy="6" r="2.5" fill="currentColor" opacity=".5"/><circle cx="7" cy="26" r="1.8" fill="currentColor" opacity=".4"/></svg>,
    sync: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
  };
  return d[n] || null;
};

export const Logo = ({ sm }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: sm ? 8 : 10 }}>
    <div style={{ width: sm ? 28 : 36, height: sm ? 28 : 36, background: '#F14F21', borderRadius: sm ? 9 : 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Ic n="bolt" s={sm ? 15 : 20} c="#fff" />
    </div>
    <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: sm ? 12 : 14, color: '#fff', letterSpacing: '.12em' }}>FOCUS FLOW</span>
  </div>
);

export const navItems = {
  student: [{ id: 'home', ic: 'home', label: 'Dashboard' }, { id: 'courses', ic: 'book', label: 'My Courses' }, { id: 'linebot', ic: 'chat', label: 'Line Bot' }, { id: 'shorts', ic: 'play', label: '教學短片' }],
  teacher: [{ id: 'home', ic: 'home', label: 'Dashboard' }, { id: 'courses', ic: 'film', label: 'Course Videos' }, { id: 'upload', ic: 'up', label: 'Upload' }],
  admin:   [{ id: 'home', ic: 'home', label: 'Overview' }, { id: 'users', ic: 'users', label: 'Users' }, { id: 'courses', ic: 'book', label: 'Courses' }, { id: 'videos', ic: 'film', label: 'Videos' }, { id: 'stats', ic: 'bar', label: 'Statistics' }],
};

export const roleLabels = { student: '學生 · Student', teacher: '教師 · Teacher', admin: '管理員 · Admin' };
export const roleDot    = { student: '#a5b4fc', teacher: '#4ade80', admin: '#F14F21' };

export const topbarMap = {
  student: { home: ['Dashboard', '歡迎回來，王同學'], courses: ['My Courses', '追蹤學習進度'], linebot: ['Line Bot', '即時問答 · 秒回片段'], shorts: ['教學短片', '瀏覽 FocusFlow 頻道影片'] },
  teacher: { home: ['Dashboard', '管理課程與影片'], courses: ['Course Videos', '已上傳影片清單'], upload: ['Upload Video', '影片上傳後自動建立 AI 索引'] },
  student: { home: ['Dashboard', '歡迎回來，王同學'], courses: ['My Courses', '追蹤學習進度'], linebot: ['Line Bot', '即時問答 · 秒回片段'], shorts: ['教學短片', '瀏覽 FocusFlow 頻道影片'], profile: ['個人資料', '管理帳號資訊'] },
  teacher: { home: ['Dashboard', '管理課程與影片'], courses: ['Course Videos', '已上傳影片清單'], upload: ['Upload Video', '影片上傳後自動建立 AI 索引'], profile: ['個人資料', '管理帳號資訊'] },
  admin:   { home: ['System Overview', '監控整體系統運作'], users: ['User Management', '學生 / 教師帳號'], courses: ['Course Management', '課程新增 / 編輯 / 刪除'], videos: ['Video Library', '全系統影片管理'], stats: ['Statistics', 'usage_logs 統計'], profile: ['個人資料', '管理帳號資訊'] },
};
