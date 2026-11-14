import { Suspense, lazy, useCallback, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar  from './Topbar';
import { topbarMap } from './navigationConfig';
import { getUser, setUser } from '../api';
import { getStudentWelcomeSubtitle } from '../utils/userDisplay';

const StudentDashboard = lazy(() => import('../pages/StudentDashboard'));
const StudentCourses = lazy(() => import('../pages/StudentCourses'));
const StudentLineBot = lazy(() => import('../pages/StudentLineBot'));
// 頂欄要用短片牆的頻道連結，這一頁維持直接載入；其他頁面用到時才下載，首頁不用一次載完整站。
import StudentShortsWall, { ShortsChannelLink } from '../pages/StudentShortsWall';
const TeacherDashboard = lazy(() => import('../pages/TeacherDashboard'));
const TeacherCourses = lazy(() => import('../pages/TeacherCourses'));
const TeacherUpload = lazy(() => import('../pages/TeacherUpload'));
const TeacherVideoReview = lazy(() => import('../pages/TeacherVideoReview'));
const TeacherShortScripts = lazy(() => import('../pages/TeacherShortScripts'));
const TeacherShortUploads = lazy(() => import('../pages/TeacherShortUploads'));
const TeacherShortStudio = lazy(() => import('../pages/TeacherShortStudio'));
const TeacherShortManage = lazy(() => import('../pages/TeacherShortManage'));
const AdminOverview = lazy(() => import('../pages/AdminOverview'));
const AdminUsers = lazy(() => import('../pages/AdminUsers'));
const AdminCourses = lazy(() => import('../pages/AdminCourses'));
const AdminVideos = lazy(() => import('../pages/AdminVideos'));
const AdminFeedback = lazy(() => import('../pages/AdminFeedback'));
const AdminYouTubeLifecycle = lazy(() => import('../pages/AdminYouTubeLifecycle'));
const AdminStats = lazy(() => import('../pages/AdminStats'));
const Profile = lazy(() => import('../pages/Profile'));

function DashboardRouter({ role, sub, onNav, user, onProfileUpdated }) {
  const profile = <Profile role={role} user={user} onProfileUpdated={onProfileUpdated} />;
  const map = {
    student: { home: <StudentDashboard onNav={onNav} />, courses: <StudentCourses />, linebot: <StudentLineBot />, shorts: <StudentShortsWall />, profile },
    teacher: { home: <TeacherDashboard onNav={onNav} />, courses: <TeacherCourses />, upload: <TeacherUpload />, shortStudio: <TeacherShortStudio onNav={onNav} />, shortManage: <TeacherShortManage onNav={onNav} />, shortScripts: <TeacherShortScripts onNav={onNav} />, shortUploads: <TeacherShortUploads onNav={onNav} />, reviewShorts: <TeacherVideoReview />, profile },
    admin:   { home: <AdminOverview onNav={onNav} />, users: <AdminUsers />, courses: <AdminCourses />, videos: <AdminVideos />, youtubeLifecycle: <AdminYouTubeLifecycle />, feedback: <AdminFeedback />, stats: <AdminStats />, profile },
  };
  return map[role]?.[sub] || null;
}

export default function DashboardApp({ role, sub, onNav, onLogout }) {
  // This is the authenticated UI's shared user state. localStorage remains the
  // persistence layer used by session restore, while descendants react to state.
  const [currentUser, setCurrentUser] = useState(() => getUser() || {});
  const handleProfileUpdated = useCallback((updatedUser) => {
    if (!updatedUser) return;
    setCurrentUser(updatedUser);
    setUser(updatedUser);
  }, []);
  const tb = topbarMap[role]?.[sub] || ['總覽', ''];
  // Personalize only the student home subtitle; all other pages keep the
  // role/navigation copy declared in navigationConfig.
  const subtitle = role === 'student' && sub === 'home'
    ? getStudentWelcomeSubtitle(currentUser)
    : tb[1];
  return (
    <div className="dashboard-shell">
      <div className="ff-bg" />
      {/* 鍵盤捷徑：只在 Tab 到時出現，跳過側欄與頂欄，直接到這一頁的內容。 */}
      <a className="skip-link" href="#main-content" onClick={(event) => {
        // 不改網址（避免觸發頁面路由同步），只把焦點移到內容區。
        event.preventDefault();
        document.getElementById('main-content')?.focus();
      }}>跳到主要內容</a>
      <div className="dashboard-inner">
        <Sidebar role={role} active={sub} onNav={onNav} onLogout={onLogout} user={currentUser} />
        <div className="dashboard-main">
          <Topbar user={currentUser} title={tb[0]} sub={subtitle} actions={role === 'student' && sub === 'shorts' ? <ShortsChannelLink /> : null} onNav={onNav} onLogout={onLogout} />
          <main className="dashboard-content" id="main-content" tabIndex={-1}>
            <Suspense fallback={<p className="page-loading" role="status">載入中…</p>}>
              <DashboardRouter role={role} sub={sub} onNav={onNav} user={currentUser} onProfileUpdated={handleProfileUpdated} />
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}
