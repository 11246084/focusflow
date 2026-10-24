import { useCallback, useEffect, useRef, useState } from 'react';
import './index.css';
import AdminLoginPage from './components/AdminLoginPage';
import DashboardApp    from './components/DashboardApp';
import { getAuthEpoch, logoutSession, isPendingFlowActive } from './api';
import {
  AUTH_SESSION_STATUS,
  requireAdminSession,
  restoreAuthSession,
  observeAuthSession,
} from './authSession';
import { readRoute, resolveSubForRole, useUrlRoute } from './utils/pageRouting';

export default function AdminApp() {
  const [page, setPage] = useState('admin-login');
  const [route, navigate] = useUrlRoute('/admin');
  const sub = resolveSubForRole('admin', route.sub);
  const setSub = useCallback((nextSub) => navigate('app', nextSub), [navigate]);
  const [error, setError] = useState('');
  const [authInitializing, setAuthInitializing] = useState(true);
  const [authRestoreError, setAuthRestoreError] = useState(null);
  const hadSession = useRef(false);

  const restoreSession = useCallback(async (isActive = () => true) => {
    const session = requireAdminSession(await restoreAuthSession());
    if (!isActive() || session.status === AUTH_SESSION_STATUS.STALE) return;
    setAuthRestoreError(null);

    if (session.status === AUTH_SESSION_STATUS.AUTHENTICATED) {
      hadSession.current = true;
      navigate('app', resolveSubForRole('admin', readRoute('/admin').sub), { replace: true });
      setPage('admin-app');
    } else if (session.status === AUTH_SESSION_STATUS.FORBIDDEN) {
      setError('此入口僅供管理員使用');
      setPage('admin-login');
    } else if (
      session.status === AUTH_SESSION_STATUS.ANONYMOUS
      || session.status === AUTH_SESSION_STATUS.INVALID
    ) {
      if (hadSession.current) setError('登入已過期，請重新登入');
      hadSession.current = false; setPage('admin-login');
    } else {
      setAuthRestoreError(session.error || new Error('無法驗證登入狀態。'));
    }

    setAuthInitializing(false);
  }, [navigate]);

  const retrySessionRestore = () => {
    setAuthInitializing(true);
    restoreSession();
  };

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => restoreSession(() => active));
    return () => { active = false; };
  }, [restoreSession]);

  useEffect(() => observeAuthSession((event) => {
    setAuthRestoreError(null); setPage('admin-login');
    if (event.type === 'expired' || event.type === 'signed-out') {
      hadSession.current = false; setAuthInitializing(false);
      setError(event.type === 'expired' ? '登入已過期，請重新登入' : '');
      navigate('login', null, { replace: true });
    } else { if (!isPendingFlowActive()) setAuthInitializing(true); void restoreSession(); }
  }), [navigate, restoreSession]);
  const handleLogin = (user) => {
    if (user.role !== 'admin') { setError('此入口僅供管理員使用'); return; }
    hadSession.current = true; setError(''); navigate('app', 'home'); setPage('admin-app');
  };
  const handleLogout = async () => {
    try { await logoutSession(); }
    catch (error) { if (error.code !== 'STALE_AUTH_RESPONSE') setError(`登出未完成：${error.message}`); }
  };

  if (authInitializing) {
    return <AuthInitializing />;
  }

  if (authRestoreError) {
    return <AuthRestoreUnavailable error={authRestoreError} onRetry={retrySessionRestore} />;
  }

  if (page === 'admin-app') {
    return <><div role="alert" className="auth-session-notice">{error}</div><DashboardApp key={getAuthEpoch()} role="admin" sub={sub} onNav={setSub} onLogout={handleLogout} /></>;
  }

  return <AdminLoginPage onLogin={handleLogin} error={error} />;
}

function AuthInitializing() {
  return (
    <div className="login-page">
      <div className="ff-bg" />
      <div className="login-right">
        <div className="login-form-card">驗證登入狀態中…</div>
      </div>
    </div>
  );
}

function AuthRestoreUnavailable({ error, onRetry }) {
  return (
    <div className="login-page">
      <div className="ff-bg" />
      <div className="login-right">
        <div className="login-form-card">
          <p>{error.message || '暫時無法驗證登入狀態。'}</p>
          <button className="btn-primary login-submit" onClick={onRetry}>重新驗證</button>
        </div>
      </div>
    </div>
  );
}
