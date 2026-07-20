import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from './Icons';
import { getUser } from '../api';

// Mock data — 之後改成打 GET /api/v1/notifications（或等後端補這支 API 後串接）
const MOCK_NOTIFICATIONS = [
  { id: 'n1', title: '系統維護通知', content: '系統將於 2026-07-22 02:00–04:00 進行例行維護，期間服務將暫停存取。', time: '10 分鐘前', read: false, urgent: true },
  { id: 'n2', title: '影片處理完成', content: '「第三講：邏輯迴歸」已完成 STT 與向量索引，學生現在可以開始提問。', time: '1 小時前', read: false, urgent: false },
  { id: 'n3', title: '新學生加入課程', content: '有 3 位學生加入了「機器學習導論」課程。', time: '3 小時前', read: false, urgent: false },
  { id: 'n4', title: 'LINE Bot 連線異常已排除', content: '先前回報的 LINE Bot 訊息延遲問題已修復。', time: '昨天', read: true, urgent: false },
  { id: 'n5', title: '帳號安全提醒', content: '偵測到新裝置登入您的帳號，如非本人操作請盡速變更密碼。', time: '2 天前', read: true, urgent: true },
];

function DropdownPanel({ anchorRect, width, panelRef, children }) {
  if (!anchorRect) return null;
  const safeWidth = Math.min(width, window.innerWidth - 24);
  const style = {
    position: 'fixed',
    top: anchorRect.bottom + 10,
    left: Math.max(12, Math.min(anchorRect.right - safeWidth, window.innerWidth - safeWidth - 12)),
    width: safeWidth,
    zIndex: 700,
    background: '#ffffff',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 20,
    boxShadow: '0 24px 60px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.04)',
    overflow: 'hidden',
  };
  return createPortal(
    <div ref={panelRef} className="fu" style={style}>
      {children}
    </div>,
    document.body,
  );
}

export default function Topbar({ title, sub, onNav, onLogout }) {
  const user = getUser() || {};
  const displayName = user.name || '訪客';
  const roleLabel = { student: '學生', teacher: '教師', admin: '管理員' }[user.role] || '';

  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifRect, setNotifRect] = useState(null);
  const [menuRect, setMenuRect] = useState(null);

  const bellRef = useRef(null);
  const notifPanelRef = useRef(null);
  const avatarRef = useRef(null);
  const menuPanelRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleOutsideClick(e) {
      if (notifOpen && !bellRef.current?.contains(e.target) && !notifPanelRef.current?.contains(e.target)) {
        setNotifOpen(false);
      }
      if (menuOpen && !avatarRef.current?.contains(e.target) && !menuPanelRef.current?.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [notifOpen, menuOpen]);

  function toggleNotif() {
    setMenuOpen(false);
    setNotifRect(bellRef.current?.getBoundingClientRect() || null);
    setNotifOpen((v) => !v);
  }

  function toggleMenu() {
    setNotifOpen(false);
    setMenuRect(avatarRef.current?.getBoundingClientRect() || null);
    setMenuOpen((v) => !v);
  }

  function markOneRead(id) {
    setNotifications((ns) => ns.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  function markAllRead() {
    setNotifications((ns) => ns.map((n) => ({ ...n, read: true })));
  }

  return (
    <div className="topbar">
      <div>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '.02em' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div ref={bellRef} className="btn-icon" style={{ position: 'relative' }} onClick={toggleNotif}>
          <Ic n="bell" s={15} />
          {unreadCount > 0 && (
            <div style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 3px', borderRadius: 8, background: '#F14F21', border: '1.5px solid #381230', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#fff', fontFamily: "'Space Grotesk',sans-serif" }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </div>
          )}
        </div>

        <div
          ref={avatarRef}
          onClick={toggleMenu}
          style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#F14F21,#a01a50)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: '#fff', cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif" }}
        >
          {displayName.charAt(0)}
        </div>
      </div>

      {notifOpen && (
        <DropdownPanel anchorRect={notifRect} width={340} panelRef={notifPanelRef}>
          <div style={{ padding: '16px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#18181b' }}>通知</span>
              <button
                onClick={markAllRead}
                disabled={unreadCount === 0}
                style={{ background: 'none', border: 'none', color: unreadCount === 0 ? 'rgba(0,0,0,0.3)' : '#F14F21', fontSize: 11.5, cursor: unreadCount === 0 ? 'default' : 'pointer', fontFamily: "'Noto Sans TC',sans-serif" }}
              >
                全部標為已讀
              </button>
            </div>

            <div className="scrl" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ padding: '24px 18px', fontSize: 12.5, color: 'rgba(0,0,0,0.4)', textAlign: 'center' }}>目前沒有通知</div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => markOneRead(n.id)}
                    className="dd-row"
                    style={{
                      padding: '12px 18px',
                      borderBottom: '1px solid rgba(0,0,0,0.06)',
                      borderLeft: n.urgent ? '3px solid #dc2626' : '3px solid transparent',
                      background: n.urgent ? 'rgba(220,38,38,0.06)' : (n.read ? 'transparent' : 'rgba(241,79,33,0.05)'),
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: n.urgent ? '#dc2626' : '#18181b' }}>{n.title}</span>
                      {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F14F21', flexShrink: 0, marginTop: 4 }} />}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', marginTop: 4, lineHeight: 1.5 }}>{n.content}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontSize: 10.5, color: 'rgba(0,0,0,0.4)' }}>{n.time}</span>
                      {n.urgent && <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 50, fontSize: 11, fontWeight: 700, background: '#fee2e2', color: '#dc2626' }}>緊急</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
        </DropdownPanel>
      )}

      {menuOpen && (
        <DropdownPanel anchorRect={menuRect} width={200} panelRef={menuPanelRef}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#18181b' }}>{displayName}</div>
            {user.email && <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{user.email}</div>}
            {roleLabel && <div style={{ fontSize: 10.5, color: '#F14F21', marginTop: 4, fontWeight: 700 }}>{roleLabel}</div>}
          </div>
          <div style={{ padding: 6 }}>
            <div
              className="dd-item"
              onClick={() => { setMenuOpen(false); onNav && onNav('profile'); }}
            >
              <span className="ni"><Ic n="users" s={15} /></span>
              個人資料
            </div>
            <div
              className="dd-item"
              onClick={() => { setMenuOpen(false); onLogout && onLogout(); }}
            >
              <span className="ni"><Ic n="out" s={15} /></span>
              登出
            </div>
          </div>
        </DropdownPanel>
      )}
    </div>
  );
}
