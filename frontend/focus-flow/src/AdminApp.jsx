import { useCallback, useEffect, useState } from 'react';
import './index.css';
import AdminLoginPage from './components/AdminLoginPage';
import DashboardApp    from './components/DashboardApp';
import { clearToken, clearUser } from './api';
import {
  AUTH_SESSION_STATUS,
  requireAdminSession,
  restoreAuthSession,
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

  const restoreSession = useCallback(async (isActive = () => true) => {
    const session = requireAdminSession(await restoreAuthSession());
    if (!isActive()) return;
    setAuthRestoreError(null);

    if (session.status === AUTH_SESSION_STATUS.AUTHENTICATED) {
      navigate('app', resolveSubForRole('admin', readRoute('/admin').sub), { replace: true });
      setPage('admin-app');
    } else if (session.status === AUTH_SESSION_STATUS.FORBIDDEN) {
      setError('此入口僅供管理員使用');
      setPage('admin-login');
    } else if (
      session.status === AUTH_SESSION_STATUS.ANONYMOUS
      || session.status === AUTH_SESSION_STATUS.INVALID
    ) {
      setPage('admin-login');
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

  const handleLogin = (user) => {
    if (user.role !== 'admin') {
      clearToken();
      clearUser();
      setError('此入口僅供管理員使用');
      return;
    }
    setError('');
    navigate('app', 'home');
    setPage('admin-app');
  };

  const handleLogout = () => {
    clearToken();
    clearUser();
    setError('');
    navigate('login');
    setPage('admin-login');
  };

  if (authInitializing) {
    return <AuthInitializing />;
  }

  if (authRestoreError) {
    return <AuthRestoreUnavailable error={authRestoreError} onRetry={retrySessionRestore} />;
  }

  if (page === 'admin-app') {
    return <DashboardApp role="admin" sub={sub} onNav={setSub} onLogout={handleLogout} />;
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
