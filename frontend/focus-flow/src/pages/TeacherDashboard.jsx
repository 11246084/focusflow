import { useState, useEffect } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

const STATUS_MAP = {
  completed:  { text: '完成',  cls: 'bg' },
  processing: { text: '處理中', cls: 'by' },
  queued:     { text: '排隊中', cls: 'bb' },
  failed:     { text: '失敗',  cls: 'br' },
};

export default function TeacherDashboard({ onNav }) {
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/stats/teacher')
      .then((r) => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const cards = [
    [stats?.coursesCount ?? '—', '課程數量', 'COURSES',        'active'],
    [stats?.videosCount  ?? '—', '上傳影片', 'VIDEOS',         'uploaded'],
    [stats?.segmentsCount?? '—', '索引片段', 'SEGMENTS',       'vector indexed'],
    [stats?.queriesCount ?? '—', '學生提問', 'STUDENT QUERIES','this semester'],
  ];

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        {cards.map(([v, lz, le, sub]) => (
          <div key={le} className="stat-card">
            <div className="stat-lbl">{le}</div>
            <div className="stat-val">{loading ? '…' : v}</div>
            <div className="stat-sub">{lz} · {sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Recent Videos */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>Recent Videos</div>
            <span onClick={() => onNav('courses')} style={{ fontSize: 11, color: '#F14F21', cursor: 'pointer' }}>VIEW ALL →</span>
          </div>
          {loading ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '12px 0' }}>載入中…</div>
          ) : !stats?.recentVideos?.length ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '12px 0' }}>尚無影片</div>
          ) : (
            stats.recentVideos.map((v) => {
              const badge = STATUS_MAP[v.status] || { text: v.status || '—', cls: 'bb' };
              return (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 11, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
                  <div style={{ color: '#F14F21', flexShrink: 0 }}><Ic n="film" s={14} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.title}</div>
                    <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.33)', marginTop: 2 }}>{v.courseName}</div>
                  </div>
                  {v.status && <span className={`badge ${badge.cls}`}>{badge.text}</span>}
                </div>
              );
            })
          )}
        </div>

        {/* Top Queried Segments */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 18 }}>Top Queried Segments</div>
          {loading ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '12px 0' }}>載入中…</div>
          ) : !stats?.topSegments?.length ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '12px 0' }}>尚無提問紀錄</div>
          ) : (
            stats.topSegments.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.33)', marginTop: 2 }}>{item.courseName}</div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#F14F21', fontFamily: "'Space Grotesk',sans-serif", flexShrink: 0 }}>{item.count}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Upload CTA */}
      <div className="card" style={{ marginTop: 12, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }} onClick={() => onNav('upload')}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(241,79,33,0.15)', border: '1px solid rgba(241,79,33,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F14F21', flexShrink: 0 }}>
          <Ic n="up" s={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>Upload New Video</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>上傳後自動執行 Whisper STT + embedding 建立索引</div>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.4)' }}><Ic n="link" s={16} /></div>
      </div>
    </div>
  );
}
