// Browser-only integration entry. Production build still uses index.html.
import { createRoot } from 'react-dom/client';
import { setUser } from '../src/api.js';
import AdminVideos from '../src/pages/AdminVideos.jsx';
import AdminOverview from '../src/pages/AdminOverview.jsx';
import AdminYouTubeLifecycle from '../src/pages/AdminYouTubeLifecycle.jsx';
import TeacherCourses from '../src/pages/TeacherCourses.jsx';
import '../src/index.css';
const view = new URLSearchParams(window.location.search).get('view');
setUser({ id: '6f2000000000000000000001', name: '測試使用者', role: view === 'teacher' ? 'teacher' : 'admin' });
const views = { teacher: <TeacherCourses />, videos: <AdminVideos />, overview: <AdminOverview />, lifecycle: <AdminYouTubeLifecycle /> };
createRoot(document.getElementById('root')).render(views[view] || <p>請選擇本機測試頁面。</p>);
