import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from './Icons';
import { apiFetch, getUser } from '../api';

function formatNotificationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mergeNotifications(current, incoming) {
  const merged = new Map(current.map((notification) => [notification.id, notification]));
  incoming.forEach((notification) => {
    const existing = merged.get(notification.id);
    // Keep a locally confirmed read state when cursor pages overlap older server data.
    merged.set(
      notification.id,
      existing?.read && !notification.read
        ? { ...notification, read: true, readAt: existing.readAt }
        : notification,
    );
  });
  return [...merged.values()];
}

function DropdownPanel({ anchorRect, width, panelRef, children, centerOnMobile = false }) {
  if (!anchorRect) return null;
  const isMobile = window.innerWidth <= 768;
  const safeWidth = Math.min(width, window.innerWidth - 24);
<<<<<<< HEAD
  // Mobile: notification panel centers horizontally instead of anchoring
  // under the bell icon (anchor-based positioning skewed off-center on
  // narrow viewports). The user menu stays anchored under the avatar.
  const left = isMobile && centerOnMobile
    ? (window.innerWidth - safeWidth) / 2
    : Math.max(12, Math.min(anchorRect.right - safeWidth, window.innerWidth - safeWidth - 12));
  const style = {
    position: 'fixed',
    top: anchorRect.bottom + 10,
    left,
=======
  const panelTop = anchorRect.bottom + 10;
  const style = {
    position: 'fixed',
    top: panelTop,
    left: Math.max(12, Math.min(anchorRect.right - safeWidth, window.innerWidth - safeWidth - 12)),
>>>>>>> cee236992c9208a3e3a88c083a07d58c6cd61f65
    width: safeWidth,
    maxHeight: Math.max(96, window.innerHeight - panelTop - 12),
    zIndex: 700,
    background: '#ffffff',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 20,
    boxShadow: '0 24px 60px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.04)',
    overflowX: 'hidden',
    overflowY: 'auto',
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

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [pendingReadIds, setPendingReadIds] = useState(() => new Set());
  const [markAllPending, setMarkAllPending] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifRect, setNotifRect] = useState(null);
  const [menuRect, setMenuRect] = useState(null);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastContent, setBroadcastContent] = useState('');
  const [broadcastUrgent, setBroadcastUrgent] = useState(false);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastFeedback, setBroadcastFeedback] = useState('');

  const bellRef = useRef(null);
  const notifPanelRef = useRef(null);
  const avatarRef = useRef(null);
  const menuPanelRef = useRef(null);
  // Refs close same-tick concurrency gaps before the matching React state is rendered.
  const listRequestIdRef = useRef(0);
  const listAbortRef = useRef(null);
  const loadMorePendingRef = useRef(false);
  const pendingReadIdsRef = useRef(new Set());
  const markAllPendingRef = useRef(false);

  const loadNotifications = useCallback(async ({ cursor = null, append = false } = {}) => {
    // A list response must not race an in-flight read mutation and restore stale unread state.
    if (
      (append && loadMorePendingRef.current)
      || markAllPendingRef.current
      || pendingReadIdsRef.current.size > 0
    ) {
      return;
    }

    // Abort plus a generation check ensures only the newest cursor request can update the list.
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;

    if (append) {
      loadMorePendingRef.current = true;
      setLoadingMore(true);
    } else {
      loadMorePendingRef.current = false;
      setLoadingMore(false);
      setNotificationLoading(true);
    }
    setNotificationError('');

    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const res = await apiFetch(`/notifications${query}`, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== listRequestIdRef.current) return;

      const incoming = Array.isArray(res.data?.notifications) ? res.data.notifications : [];
      setNotifications((current) => (append ? mergeNotifications(current, incoming) : incoming));
      setUnreadCount(Number(res.data?.unreadCount) || 0);
      setNextCursor(res.data?.nextCursor || null);
    } catch (error) {
      if (controller.signal.aborted || requestId !== listRequestIdRef.current) return;
      setNotificationError(error.message || '通知讀取失敗，請稍後再試。');
    } finally {
      if (requestId === listRequestIdRef.current) {
        if (append) {
          loadMorePendingRef.current = false;
          setLoadingMore(false);
        } else {
          setNotificationLoading(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    return () => {
      listRequestIdRef.current += 1;
      listAbortRef.current?.abort();
      listAbortRef.current = null;
      loadMorePendingRef.current = false;
    };
  }, [loadNotifications]);

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
    if (!notifOpen) {
      void loadNotifications();
    }
    setNotifOpen((v) => !v);
  }

  function toggleMenu() {
    setNotifOpen(false);
    setMenuRect(avatarRef.current?.getBoundingClientRect() || null);
    setMenuOpen((v) => !v);
  }

  function invalidateListRequest() {
    // Read mutations invalidate active GETs so late list responses cannot overwrite their result.
    listRequestIdRef.current += 1;
    listAbortRef.current?.abort();
    listAbortRef.current = null;
    loadMorePendingRef.current = false;
    setNotificationLoading(false);
    setLoadingMore(false);
  }

  function loadMoreNotifications() {
    if (!nextCursor || loadMorePendingRef.current) return;
    void loadNotifications({ cursor: nextCursor, append: true });
  }

  async function markOneRead(id) {
    const current = notifications.find((notification) => notification.id === id);
    if (
      !current
      || current.read
      || pendingReadIdsRef.current.has(id)
      || markAllPendingRef.current
    ) {
      return;
    }

    pendingReadIdsRef.current.add(id);
    setPendingReadIds((ids) => {
      const next = new Set(ids);
      next.add(id);
      return next;
    });
    invalidateListRequest();
    setNotificationError('');

    try {
      const res = await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications((items) => items.map((notification) => (
        notification.id === id ? res.data.notification : notification
      )));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (error) {
      setNotificationError(error.message || '通知狀態更新失敗。');
    } finally {
      pendingReadIdsRef.current.delete(id);
      setPendingReadIds((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    }
  }

  async function markAllRead() {
    if (
      unreadCount === 0
      || markAllPendingRef.current
      || pendingReadIdsRef.current.size > 0
    ) {
      return;
    }

    markAllPendingRef.current = true;
    setMarkAllPending(true);
    invalidateListRequest();
    setNotificationError('');

    try {
      await apiFetch('/notifications/read-all', { method: 'POST' });
      setNotifications((items) => items.map((notification) => ({ ...notification, read: true })));
      setUnreadCount(0);
    } catch (error) {
      setNotificationError(error.message || '通知狀態更新失敗。');
    } finally {
      markAllPendingRef.current = false;
      setMarkAllPending(false);
    }
  }

  async function sendBroadcast(event) {
    event.preventDefault();
    setBroadcastFeedback('');

    const titleValue = broadcastTitle.trim();
    const contentValue = broadcastContent.trim();
    if (!titleValue || !contentValue) {
      setBroadcastFeedback('請填寫公告標題與內容。');
      return;
    }

    setBroadcastSending(true);
    try {
      // The backend fans this announcement out only to active students and returns the recipient count.
      const res = await apiFetch('/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleValue,
          content: contentValue,
          urgent: broadcastUrgent,
        }),
      });
      setBroadcastTitle('');
      setBroadcastContent('');
      setBroadcastUrgent(false);
      setBroadcastFeedback(`公告已送出給 ${res.data.recipientCount} 位學生。`);
    } catch (error) {
      setBroadcastFeedback(error.message || '公告發送失敗，請稍後再試。');
    } finally {
      setBroadcastSending(false);
    }
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
        <DropdownPanel anchorRect={notifRect} width={340} panelRef={notifPanelRef} centerOnMobile>
          <div style={{ padding: '16px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#18181b' }}>通知</span>
              <button
                onClick={() => void markAllRead()}
                disabled={unreadCount === 0 || markAllPending || pendingReadIds.size > 0}
                style={{ background: 'none', border: 'none', color: unreadCount === 0 || pendingReadIds.size > 0 ? 'rgba(0,0,0,0.3)' : '#F14F21', fontSize: 11.5, cursor: unreadCount === 0 || markAllPending || pendingReadIds.size > 0 ? 'default' : 'pointer', fontFamily: "'Noto Sans TC',sans-serif" }}
              >
                {markAllPending ? '更新中…' : '全部標為已讀'}
              </button>
            </div>

            {user.role === 'admin' && (
              <form onSubmit={sendBroadcast} style={{ padding: '12px 18px', borderBottom: '1px solid rgba(0,0,0,0.08)', display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#18181b' }}>發送系統公告</div>
                <input
                  value={broadcastTitle}
                  onChange={(event) => setBroadcastTitle(event.target.value)}
                  maxLength={120}
                  placeholder="公告標題"
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid rgba(0,0,0,0.14)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#18181b', background: '#fff' }}
                />
                <textarea
                  value={broadcastContent}
                  onChange={(event) => setBroadcastContent(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="公告內容"
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', border: '1px solid rgba(0,0,0,0.14)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#18181b', background: '#fff', fontFamily: "'Noto Sans TC',sans-serif" }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'rgba(0,0,0,0.65)' }}>
                    <input
                      type="checkbox"
                      checked={broadcastUrgent}
                      onChange={(event) => setBroadcastUrgent(event.target.checked)}
                    />
                    緊急公告
                  </label>
                  <button
                    type="submit"
                    disabled={broadcastSending}
                    style={{ border: 'none', borderRadius: 8, padding: '7px 12px', background: '#F14F21', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: broadcastSending ? 'wait' : 'pointer' }}
                  >
                    {broadcastSending ? '發送中…' : '發送'}
                  </button>
                </div>
                {broadcastFeedback && (
                  <div style={{ fontSize: 11, lineHeight: 1.5, color: 'rgba(0,0,0,0.65)' }}>{broadcastFeedback}</div>
                )}
              </form>
            )}

            {notificationError && (
              <div style={{ padding: '9px 18px', fontSize: 11.5, color: '#b91c1c', background: '#fef2f2' }}>{notificationError}</div>
            )}

            <div className="scrl" style={{ maxHeight: user.role === 'admin' ? 250 : 360, overflowY: 'auto' }}>
              {notificationLoading ? (
                <div style={{ padding: '24px 18px', fontSize: 12.5, color: 'rgba(0,0,0,0.4)', textAlign: 'center' }}>通知讀取中…</div>
              ) : notifications.length === 0 ? (
                <div style={{ padding: '24px 18px', fontSize: 12.5, color: 'rgba(0,0,0,0.4)', textAlign: 'center' }}>目前沒有通知</div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => void markOneRead(n.id)}
                    className="dd-row"
                    style={{
                      padding: '12px 18px',
                      borderBottom: '1px solid rgba(0,0,0,0.06)',
                      borderLeft: n.urgent ? '3px solid #dc2626' : '3px solid transparent',
                      background: n.urgent ? 'rgba(220,38,38,0.06)' : (n.read ? 'transparent' : 'rgba(241,79,33,0.05)'),
                      cursor: n.read || pendingReadIds.has(n.id) ? 'default' : 'pointer',
                      opacity: pendingReadIds.has(n.id) ? 0.65 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: n.urgent ? '#dc2626' : '#18181b' }}>{n.title}</span>
                      {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F14F21', flexShrink: 0, marginTop: 4 }} />}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', marginTop: 4, lineHeight: 1.5 }}>{n.content}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontSize: 10.5, color: 'rgba(0,0,0,0.4)' }}>{formatNotificationTime(n.createdAt)}</span>
                      {n.urgent && <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 50, fontSize: 11, fontWeight: 700, background: '#fee2e2', color: '#dc2626' }}>緊急</span>}
                    </div>
                  </div>
                ))
              )}
              {!notificationLoading && nextCursor && (
                <div style={{ padding: '10px 18px', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={loadMoreNotifications}
                    disabled={loadingMore}
                    style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: '7px 14px', background: '#fff', color: loadingMore ? 'rgba(0,0,0,0.35)' : '#F14F21', fontSize: 11.5, fontWeight: 700, cursor: loadingMore ? 'wait' : 'pointer' }}
                  >
                    {loadingMore ? '載入中…' : '載入更多'}
                  </button>
                </div>
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
