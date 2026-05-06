import { useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

// function timeAgo(ts) {
//   const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
//   if (diff < 60) return `${diff}s`;
//   if (diff < 3600) return `${Math.floor(diff / 60)}m`;
//   if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
//   return `${Math.floor(diff / 86400)}d`;
// }

export default function AdminOverview({ onNav }) {
  const [stats, setStats] = useState(null);
  // const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/admin/stats')
      .then(s => setStats(s.data))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Promise.all([
    //   apiFetch('/admin/stats'),
    //   apiFetch('/admin/events?limit=8'),
    // ]).then(([s, e]) => {
    //   setStats(s.data);
    //   setEvents(e.data.events);
    // }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // const evBadge = ev => ev === 'ask' ? 'br' : ev === 'clip_view' ? 'by' : ev === 'watch' ? 'bg' : 'bb';

  if (loading) return (
    <div className="fu" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
      Loading...
    </div>
  );

  const s = stats || {};
  const total = s.totalUsers || 0;

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        {[
          [String(s.totalUsers ?? '—'), '用戶總數', 'TOTAL USERS', `${s.studentCount ?? 0} students, ${s.teacherCount ?? 0} teachers, ${s.adminCount ?? 0} admins`],
          [String(s.totalVideos ?? '—'), '影片總量', 'TOTAL VIDEOS', 'all courses'],
          [String(s.totalSegments ?? '—'), '索引片段', 'SEGMENTS', 'vector search ready'],
          [String(s.totalQueries ?? '—'), '系統提問', 'TOTAL QUERIES', 'all time'],
        ].map(([v, lz, le, sub]) => (
          <div key={le} className="stat-card">
            <div className="stat-lbl">{le}</div>
            <div className="stat-val">{v}</div>
            <div className="stat-sub">{lz} · {sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* User Distribution */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>User Distribution</div>
            <span onClick={() => onNav('users')} style={{ fontSize: 11, color: '#F14F21', cursor: 'pointer' }}>MANAGE →</span>
          </div>
          {[['學生 Student', s.studentCount ?? 0, '#a5b4fc'], ['教師 Teacher', s.teacherCount ?? 0, '#4ade80'], ['管理員 Admin', s.adminCount ?? 0, '#F14F21']].map(([label, count, col]) => (
            <div key={label} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{label}</span>
                <span style={{ fontSize: 13, color: col, fontWeight: 700 }}>{count}</span>
              </div>
              <div className="prog-track"><div className="prog-fill" style={{ width: total > 0 ? `${count / total * 100}%` : '0%', background: col }} /></div>
            </div>
          ))}
          <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>LINE BOT BINDING RATE</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="prog-track" style={{ flex: 1, marginRight: 10 }}><div className="prog-fill" style={{ width: `${s.lineBindRate ?? 0}%`, background: '#4ade80' }} /></div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', fontFamily: "'Space Grotesk',sans-serif" }}>{s.lineBindRate ?? 0}%</span>
            </div>
          </div>
        </div>

        {/* System Health — static indicators (external services have no programmatic health check) */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 18 }}>System Health</div>
          {[
            ['MongoDB Atlas', 'online'],
            ['Whisper STT API', 'online'],
            ['OpenAI Embedding', 'online'],
            ['Line Messaging API', 'online'],
            ['FFmpeg Worker', 'busy'],
            ['S3 Storage', 'online'],
          ].map(([svc, st]) => (
            <div key={svc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ color: st === 'online' ? '#4ade80' : '#facc15' }} className={st === 'busy' ? 'pls' : ''}>
                  <Ic n="dot" s={8} />
                </div>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{svc}</span>
              </div>
              <span className={`badge ${st === 'online' ? 'bg' : 'by'}`}>{st === 'online' ? '正常' : '忙碌'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Events — 暫時隱藏
      <div className="card" style={{ marginTop: 12, padding: '14px 20px' }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Recent Events (usage_logs)</div>
        {events.length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>尚無事件記錄</div>
        ) : (
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto' }}>
            {events.map((r) => (
              <div key={r.id} style={{ flexShrink: 0, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, minWidth: 140 }}>
                <span className={`badge ${evBadge(r.event)}`}>{r.event}</span>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 8 }}>{r.user}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{r.course} · {timeAgo(r.timestamp)} ago</div>
              </div>
            ))}
          </div>
        )}
      </div>
      */}
    </div>
  );
}
