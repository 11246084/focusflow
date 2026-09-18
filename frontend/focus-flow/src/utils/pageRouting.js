import { useCallback, useEffect, useState } from 'react';
import { isValidSubPage, pagePaths } from '../components/navigationConfig.js';

// 沒有引入 react-router：頁面狀態仍由 page / sub 管理，這裡只負責與網址同步，
// 讓重新整理停在原頁、瀏覽器「上一頁」可以返回前一個畫面。
// nginx 的 try_files 與 Vite dev server 都會把未知路徑交給 index.html。

const subByPath = Object.fromEntries(Object.entries(pagePaths).map(([sub, path]) => [path, sub]));

function normalizePath(pathname) {
  const trimmed = String(pathname || '/').replace(/\/+$/, '');
  return trimmed || '/';
}

// basePath：一般入口為 ''，管理員入口為 '/admin'。
export function readRoute(basePath = '', pathname = window.location.pathname) {
  const path = normalizePath(pathname);
  const relative = basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;

  if (relative === '/login') return { page: 'login', sub: null };
  if (relative === '/register') return { page: 'register', sub: null };

  const appPrefix = basePath ? '/' : '/app/';
  if (relative.startsWith(appPrefix) && relative.length > appPrefix.length) {
    const segment = relative.slice(appPrefix.length).split('/')[0];
    return { page: 'app', sub: subByPath[segment] || null };
  }
  if (basePath) return { page: 'app', sub: null };
  if (relative === '/app') return { page: 'app', sub: null };
  return { page: 'landing', sub: null };
}

export function buildPath(basePath, page, sub) {
  if (page === 'login') return `${basePath}/login`;
  if (page === 'register') return `${basePath}/register`;
  if (page === 'app') {
    const segment = pagePaths[sub] || pagePaths.home;
    return basePath ? `${basePath}/${segment}` : `/app/${segment}`;
  }
  return basePath || '/';
}

export function resolveSubForRole(role, sub) {
  return sub && isValidSubPage(role, sub) ? sub : 'home';
}

// 回傳目前網址對應的頁面，以及切換頁面時同步網址的 navigate。
export function useUrlRoute(basePath = '') {
  const [route, setRoute] = useState(() => readRoute(basePath));

  useEffect(() => {
    const handlePopState = () => setRoute(readRoute(basePath));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [basePath]);

  const navigate = useCallback((page, sub = null, { replace = false } = {}) => {
    const nextPath = buildPath(basePath, page, sub);
    const currentPath = normalizePath(window.location.pathname);
    if (nextPath !== currentPath) {
      // 換頁時捨棄舊頁的查詢參數（例如上傳頁的追蹤批次）。
      const method = replace ? 'replaceState' : 'pushState';
      window.history[method]({}, '', nextPath);
    }
    setRoute({ page, sub });
  }, [basePath]);

  return [route, navigate];
}
