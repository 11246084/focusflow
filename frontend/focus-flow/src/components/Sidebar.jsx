import { useEffect, useRef, useState } from 'react';
import { Ic } from './Icons';
import { navItems, roleLabels, roleDot } from './navigationConfig';
import IssueReportLauncher from './IssueReportLauncher';
import { getUser } from '../api';
import { getDisplayName } from '../utils/userDisplay';
import { createAvatarUrlController, getAvatarVersion } from '../utils/avatarImage';
import brandMark from '../assets/mark-white.svg';

export default function Sidebar({ role, active, onNav, onLogout, user: userProp }) {
  const user = userProp || getUser() || {};
  const avatarVersion = getAvatarVersion(user);
  const [avatar, setAvatar] = useState({ version: null, url: null });
  const avatarUrl = avatar.version === avatarVersion ? avatar.url : null;
  const avatarControllerRef = useRef(null);
  if (avatarControllerRef.current === null) {
    avatarControllerRef.current = createAvatarUrlController();
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const avatars = avatarControllerRef.current;
    void avatars.load({ hasAvatar: Boolean(avatarVersion), signal: controller.signal }).then(url => {
      if (active) setAvatar({ version: avatarVersion, url });
    });
    return () => { active = false; controller.abort(); avatars.cancel(); };
  }, [avatarVersion]);
  const [preferredCollapsed, setPreferredCollapsed] = useState(() => {
    try { return localStorage.getItem('ff_sidebar_collapsed') === 'true'; } catch { return false; }
  });
  const [compactViewport, setCompactViewport] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  const [compactOverride, setCompactOverride] = useState(null);
  const collapsed = compactViewport ? compactOverride ?? true : preferredCollapsed;
  const sidebarRef = useRef(null);
  useEffect(() => {
    if (collapsed) return;
    const closeOverlay = (event) => {
      if (!window.matchMedia('(max-width: 768px)').matches) return;
      if (event.type === 'keydown') {
        if (event.key !== 'Escape') return;
        sidebarRef.current?.querySelector('.sidebar-toggle')?.focus();
      } else if (sidebarRef.current?.contains(event.target)) return;
      setCompactOverride(true);
    };
    document.addEventListener('pointerdown', closeOverlay);
    document.addEventListener('keydown', closeOverlay);
    return () => { document.removeEventListener('pointerdown', closeOverlay); document.removeEventListener('keydown', closeOverlay); };
  }, [collapsed]);
  function collapseOverlay() {
    if (window.matchMedia('(max-width: 768px)').matches) setCompactOverride(true);
  }
  function navigate(page) {
    onNav(page);
    collapseOverlay();
  }
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1100px)');
    const handleChange = (event) => {
      setCompactViewport(event.matches);
      setCompactOverride(null);
    };
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);
  function toggleSidebar() {
    const next = !collapsed;
    // Narrow-screen overrides last until the viewport crosses the breakpoint.
    // Automatic collapse must not overwrite the user's wide-screen preference.
    if (compactViewport) { setCompactOverride(next); return; }
    setPreferredCollapsed(next);
    try { localStorage.setItem('ff_sidebar_collapsed', String(next)); } catch { /* Storage can be disabled. */ }
  }
  const items = navItems[role] || [];
  const homeLabel = items.find((it) => it.id === 'home')?.label || '總覽';
  const displayName = getDisplayName(user);
  return (
    <div ref={sidebarRef} className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>

      {/* Logo */}
      <div className="sidebar-logo">
        <button type="button" className="sidebar-brand" onClick={() => navigate('home')} aria-label={`Focus Flow：回到${homeLabel}`} title={`回到${homeLabel}`}>
          <img className="sidebar-brand-mark" src={brandMark} alt="" aria-hidden="true" />
          <span className="sidebar-wordmark" aria-hidden="true"><strong>focus</strong> <em>flow</em></span>
        </button>
        <button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-label={collapsed ? '展開側邊欄' : '收合側邊欄'} title={collapsed ? '展開側邊欄' : '收合側邊欄'} aria-expanded={!collapsed}>
          <img className="sidebar-toggle-logo" src={brandMark} alt="" aria-hidden="true" />
          <svg className="sidebar-toggle-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /><path d={collapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} /></svg>
        </button>
      </div>

      {/* Nav items */}
      <nav className="sidebar-nav" aria-label="主選單" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {items.map(it => (
          <button
            key={it.id}
            type="button"
            className={`nav-item${active === it.id ? ' active' : ''}`}
            aria-current={active === it.id ? 'page' : undefined}
            aria-label={it.label}
            title={it.label}
            onClick={() => navigate(it.id)}
          >
            <span className="ni"><Ic n={it.ic} s={16} /></span>
            <span className="sidebar-item-label">{it.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer: feedback / issue report + role + sign out */}
      <div className="sidebar-footer">
        {(role === 'student' || role === 'teacher') && <IssueReportLauncher onActivate={collapseOverlay} />}
        <div
          className="sidebar-role-card"
          role="button"
          tabIndex={0}
          title="個人資料"
          aria-label={`個人資料：${displayName}`}
          onClick={() => navigate('profile')}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate('profile'); } }}
          style={{ cursor: 'pointer', outline: active === 'profile' ? '1px solid rgba(241,79,33,0.6)' : undefined }}
        >
          <span className="sidebar-avatar" aria-hidden="true">
            {avatarUrl ? <img src={avatarUrl} alt="" onError={() => { if (avatarControllerRef.current.release(avatarUrl)) setAvatar({ version: avatarVersion, url: null }); }} /> : [...displayName][0] || '人'}
          </span>
          <div className="sidebar-role-label">
            <div className="sidebar-role-dot" style={{ background: roleDot[role] }} />
            <span className="sidebar-role-text">{roleLabels[role]}</span>
          </div>
          <div className="sidebar-username">{displayName}</div>
        </div>

        <button type="button" className="nav-item" aria-label="登出" title="登出" onClick={onLogout}>
          <span className="ni"><Ic n="out" s={15} /></span>
          <span className="sidebar-item-label">登出</span>
        </button>
      </div>

    </div>
  );
}
