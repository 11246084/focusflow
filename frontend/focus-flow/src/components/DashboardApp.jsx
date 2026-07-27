import Sidebar from './Sidebar';
import Topbar  from './Topbar';
import { topbarMap } from './navigationConfig';

import StudentDashboard  from '../pages/StudentDashboard';
import StudentCourses    from '../pages/StudentCourses';
import StudentLineBot    from '../pages/StudentLineBot';
import StudentShortsWall from '../pages/StudentShortsWall';
import TeacherDashboard from '../pages/TeacherDashboard';
import TeacherCourses   from '../pages/TeacherCourses';
import TeacherUpload    from '../pages/TeacherUpload';
import AdminOverview    from '../pages/AdminOverview';
import AdminUsers       from '../pages/AdminUsers';
import AdminCourses     from '../pages/AdminCourses';
import AdminVideos      from '../pages/AdminVideos';
import AdminStats       from '../pages/AdminStats';
import Profile           from '../pages/Profile';

function DashboardRouter({ role, sub, onNav }) {
  const map = {
    student: { home: <StudentDashboard onNav={onNav} />, courses: <StudentCourses />, linebot: <StudentLineBot />, shorts: <StudentShortsWall />, profile: <Profile role={role} /> },
    teacher: { home: <TeacherDashboard onNav={onNav} />, courses: <TeacherCourses />, upload: <TeacherUpload />, profile: <Profile role={role} /> },
    admin:   { home: <AdminOverview onNav={onNav} />, users: <AdminUsers />, courses: <AdminCourses />, videos: <AdminVideos />, stats: <AdminStats />, profile: <Profile role={role} /> },
  };
  return map[role]?.[sub] || null;
}

export default function DashboardApp({ role, sub, onNav, onLogout }) {
  const tb = topbarMap[role]?.[sub] || ['Dashboard', ''];
  return (
    <div className="dashboard-shell">
      <div className="ff-bg" />
      <div className="dashboard-inner">
        <Sidebar role={role} active={sub} onNav={onNav} onLogout={onLogout} />
        <div className="dashboard-main">
          <Topbar title={tb[0]} sub={tb[1]} onNav={onNav} onLogout={onLogout} />
          <div className="dashboard-content">
            <DashboardRouter role={role} sub={sub} onNav={onNav} />
          </div>
        </div>
      </div>
    </div>
  );
}
