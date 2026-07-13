import { useState, useEffect } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

const STATUS_MAP = {
  completed: { text: '完成', cls: 'bg' },
  processing: { text: '處理中', cls: 'by' },
  queued: { text: '佇列中', cls: 'bb' },
  failed: { text: '失敗', cls: 'br' },
};

function formatSegmentSource(item) {
  if (item.contentMissing) return '已刪除影片的提問';
  return item.videoTitle || (item.videoId ? `影片 ${String(item.videoId).slice(-6)}` : '未知影片');
}

export default function TeacherDashboard({ onNav }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/stats/teacher')
      .then((r) => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const cards = [
    [stats?.coursesCount ?? '-', '課程數量', 'COURSES', 'active'],
    [stats?.videosCount ?? '-', '上傳影片', 'VIDEOS', 'uploaded'],
    [stats?.segmentsCount ?? '-', 'AI 片段', 'SEGMENTS', 'vector indexed'],
    [stats?.queriesCount ?? '-', '學生提問', 'STUDENT QUERIES', 'this semester'],
  ];

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        {cards.map(([value, label, title, sub]) => (
          <div key={title} className="stat-card">
            <div className="stat-lbl">{title}</div>
            <div className="stat-val">{loading ? '-' : value}</div>
            <div className="stat-sub">{label} · {sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>Recent Videos</div>
            <span onClick={() => onNav('courses')} style={{ fontSize: 11, color: '#F14F21', cursor: 'pointer' }}>VIEW ALL</span>
          </div>

          {loading ? (
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, padding: '12px 0' }}>載入中...</div>
          ) : !stats?.recentVideos?.length ? (
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, padding: '12px 0' }}>尚無影片</div>
          ) : (
            stats.recentVideos.map((video) => {
              const badge = STATUS_MAP[video.status] || { text: video.status || '未知', cls: 'bb' };

              return (
                <div key={video.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 11, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
                  <div style={{ color: '#F14F21', flexShrink: 0 }}><Ic n="film" s={14} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.86)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{video.title}</div>
                    <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.52)', marginTop: 2 }}>{video.courseName}</div>
                  </div>
                  {video.status && <span className={`badge ${badge.cls}`}>{badge.text}</span>}
                </div>
              );
            })
          )}
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 18 }}>Top Queried Segments</div>

          {loading ? (
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, padding: '12px 0' }}>載入中...</div>
          ) : !stats?.topSegments?.length ? (
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, padding: '12px 0' }}>尚無提問紀錄</div>
          ) : (
            stats.topSegments.map((item, index) => (
              <div key={item.segmentId || index} style={{ marginBottom: 11, padding: '12px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'baseline', gap: 14 }}>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatSegmentSource(item)}
                    {item.contentMissing && <span className="badge bb" style={{ marginLeft: 8 }} title="提問對應的影片已被刪除，僅保留統計">內容已下架</span>}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: '#F14F21', fontFamily: "'Space Grotesk',sans-serif", whiteSpace: 'nowrap' }}>{item.count}次</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 14, marginTop: 4 }}>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.52)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.courseName}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.52)', whiteSpace: 'nowrap' }}>引用次數</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }} onClick={() => onNav('upload')}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(241,79,33,0.15)', border: '1px solid rgba(241,79,33,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F14F21', flexShrink: 0 }}>
          <Ic n="up" s={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>Upload New Video</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.58)', marginTop: 2 }}>上傳後自動執行 Whisper STT + embedding 建立索引</div>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.52)' }}><Ic n="link" s={16} /></div>
      </div>
    </div>
  );
}
