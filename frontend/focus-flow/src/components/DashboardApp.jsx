import { useCallback, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar  from './Topbar';
import IssueReportLauncher from './IssueReportLauncher';
import { topbarMap } from './navigationConfig';
import { getUser, setUser } from '../api';
import { getStudentWelcomeSubtitle } from '../utils/userDisplay';

import StudentDashboard  from '../pages/StudentDashboard';
import StudentCourses    from '../pages/StudentCourses';
import StudentLineBot    from '../pages/StudentLineBot';
import StudentShortsWall from '../pages/StudentShortsWall';
import TeacherDashboard    from '../pages/TeacherDashboard';
import TeacherCourses      from '../pages/TeacherCourses';
import TeacherUpload       from '../pages/TeacherUpload';
import TeacherVideoReview  from '../pages/TeacherVideoReview';
import TeacherShortScripts from '../pages/TeacherShortScripts';
import AdminOverview    from '../pages/AdminOverview';
import AdminUsers       from '../pages/AdminUsers';
import AdminCourses     from '../pages/AdminCourses';
import AdminVideos      from '../pages/AdminVideos';
import AdminStats       from '../pages/AdminStats';
import Profile           from '../pages/Profile';

function DashboardRouter({ role, sub, onNav, user, onProfileUpdated }) {
  const profile = <Profile role={role} user={user} onProfileUpdated={onProfileUpdated} />;
  const map = {
    student: { home: <StudentDashboard onNav={onNav} />, courses: <StudentCourses />, linebot: <StudentLineBot />, shorts: <StudentShortsWall />, profile },
    teacher: { home: <TeacherDashboard onNav={onNav} />, courses: <TeacherCourses />, upload: <TeacherUpload />, shortScripts: <TeacherShortScripts />, reviewShorts: <TeacherVideoReview />, profile },
    admin:   { home: <AdminOverview onNav={onNav} />, users: <AdminUsers />, courses: <AdminCourses />, videos: <AdminVideos />, stats: <AdminStats />, profile },
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
  const tb = topbarMap[role]?.[sub] || ['Dashboard', ''];
  // Personalize only the student home subtitle; all other pages keep the
  // role/navigation copy declared in navigationConfig.
  const subtitle = role === 'student' && sub === 'home'
    ? getStudentWelcomeSubtitle(currentUser)
    : tb[1];
  return (
    <div className="dashboard-shell">
      <div className="ff-bg" />
      <div className="dashboard-inner">
        <Sidebar role={role} active={sub} onNav={onNav} onLogout={onLogout} />
        <div className="dashboard-main">
          <Topbar user={currentUser} title={tb[0]} sub={subtitle} onNav={onNav} onLogout={onLogout} />
          <div className="dashboard-content">
            <DashboardRouter role={role} sub={sub} onNav={onNav} user={currentUser} onProfileUpdated={handleProfileUpdated} />
          </div>
        </div>
      </div>
      {role === 'student' && <IssueReportLauncher />}
    </div>
  );
}
