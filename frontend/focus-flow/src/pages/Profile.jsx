import { useEffect, useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch, getUser } from '../api';

const ROLE_LABELS = { student: '學生 · Student', teacher: '教師 · Teacher', admin: '管理員 · Admin' };

function AvatarUploader({ name, previewUrl, onPick }) {
  const fileInputRef = useRef(null);
  return (
    <div style={{ position: 'relative', width: 84, height: 84, flexShrink: 0}}>
      <div
        onClick={() => fileInputRef.current?.click()}
        style={{
          width: 84, height: 84, borderRadius: '50%', cursor: 'pointer', overflow: 'hidden',
          background: previewUrl ? undefined : 'linear-gradient(135deg,#F14F21,#a01a50)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 30, color: '#fff',
          border: '2px solid rgba(255,255,255,0.14)',
        }}
        title="點擊更換頭像"
      >
        {previewUrl ? (
          <img src={previewUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover',cursor: 'pointer'}} />
        ) : (
          name.charAt(0)
        )}
      </div>
      <div
        onClick={() => fileInputRef.current?.click()}
        style={{
          position: 'absolute', bottom: -2, right: -2, width: 32, height: 32, borderRadius: '50%',
          background: '#F14F21', border: '2px solid #260c1e', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#fff', cursor: 'pointer',
        }}
      >
        <Ic n="up" s={13} />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files[0];
          if (file) onPick(file);
        }}
      />
    </div>
  );
}

function StudentExtra({ stats, loading }) {
  const cards = [
    [stats?.coursesCount ?? '-', '已選修課程'],
    [stats?.totalQueries ?? '-', '累計提問次數'],
    [stats?.weeklyQueries ?? '-', '本週提問次數'],
    [`${stats?.answerRate ?? 0}%`, '回答命中率'],
  ];
  return (
    <div className="ff-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
      {cards.map(([value, label]) => (
        <div key={label} className="stat-card">
          <div className="stat-val" style={{ fontSize: 26 }}>{loading ? '-' : value}</div>
          <div className="stat-sub" style={{ marginTop: 4 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function TeacherExtra({ stats, loading }) {
  const cards = [
    [stats?.coursesCount ?? '-', '建立課程數'],
    [stats?.videosCount ?? '-', '上傳影片數'],
    [stats?.segmentsCount ?? '-', '索引片段數'],
    [stats?.queriesCount ?? '-', '課程累計提問'],
  ];
  return (
    <div className="ff-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
      {cards.map(([value, label]) => (
        <div key={label} className="stat-card">
          <div className="stat-val" style={{ fontSize: 26 }}>{loading ? '-' : value}</div>
          <div className="stat-sub" style={{ marginTop: 4 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

export default function Profile({ role }) {
  const user = getUser() || {};
  const displayName = user.name || '訪客';
  const [previewUrl, setPreviewUrl] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(role === 'student' || role === 'teacher');

  useEffect(() => {
    if (role !== 'student' && role !== 'teacher') return;
    apiFetch(`/stats/${role}`)
      .then((res) => setStats(res.data))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [role]);

  function handlePickAvatar(file) {
    // 前端預覽用 — 之後改成上傳到後端頭像 API 再改用回傳的 URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  }

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div className="card" style={{ padding: 26, maxWidth: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 22, marginBottom: 20 }}>
        <AvatarUploader name={displayName} previewUrl={previewUrl} onPick={handlePickAvatar} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, color: '#fff' }}>{displayName}</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{user.email || '未提供 Email'}</div>
          <span className="badge bo" style={{ marginTop: 10 }}>{ROLE_LABELS[role] || role}</span>
        </div>
      </div>

      <div className="card" style={{ padding: 26, maxWidth: '100%', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 16 }}>帳號資訊</div>
        <div className="ff-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="ff-label">姓名</label>
            <div className="ff-input" style={{ background: 'rgba(255,255,255,0.03)', cursor: 'default' }}>{displayName}</div>
          </div>
          <div>
            <label className="ff-label">Email</label>
            <div className="ff-input" style={{ background: 'rgba(255,255,255,0.03)', cursor: 'default' }}>{user.email || '—'}</div>
          </div>
        </div>
      </div>

      {(role === 'student' || role === 'teacher') && (
        <div style={{ maxWidth: '100%' }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 12 }}>
            {role === 'student' ? '學習概況' : '教學概況'}
          </div>
          {role === 'student' ? <StudentExtra stats={stats} loading={statsLoading} /> : <TeacherExtra stats={stats} loading={statsLoading} />}
        </div>
      )}
    </div>
  );
}
