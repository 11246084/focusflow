import { useState } from 'react';
import './index.css';
import AdminLoginPage from './components/AdminLoginPage';
import DashboardApp    from './components/DashboardApp';
import { clearToken, clearUser } from './api';

export default function AdminApp() {
  const [page, setPage] = useState('admin-login');
  const [sub, setSub]   = useState('home');
  const [error, setError] = useState('');

  const handleLogin = (user) => {
    if (user.role !== 'admin') {
      clearToken();
      clearUser();
      setError('此入口僅供管理員使用');
      return;
    }
    setError('');
    setSub('home');
    setPage('admin-app');
  };

  const handleLogout = () => {
    clearToken();
    clearUser();
    setError('');
    setPage('admin-login');
  };

  if (page === 'admin-app') {
    return <DashboardApp role="admin" sub={sub} onNav={setSub} onLogout={handleLogout} />;
  }

  return <AdminLoginPage onLogin={handleLogin} error={error} />;
}
