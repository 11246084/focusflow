import { useState, useEffect } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

const STATUS_MAP = {
  completed:  { text: '完成',  cls: 'bg' },
  processing: { text: '處理中', cls: 'by' },
  queued:     { text: '排隊中', cls: 'bb' },
  failed:     { text: '失敗',  cls: 'br' },
};

export default function TeacherCourses() {
  const [videos, setVideos]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    async function load() {
      try {
        const coursesRes = await apiFetch('/courses');
        const courses = coursesRes.data?.courses || [];
        const all = [];
        await Promise.all(
          courses.map(async (c) => {
            try {
              const vRes = await apiFetch(`/courses/${c._id}/videos`);
              const vids = vRes.data?.videos || [];
              vids.forEach(v => all.push({ ...v, courseName: c.title }));
            } catch { /* skip courses without access */ }
          })
        );
        // Sort by newest first (use processing.queuedAt or updatedAt)
        all.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
        setVideos(all);
      } catch (e) {
        setError(e.message || '載入失敗');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 18 }}>Course Videos</div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>載入中…</div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#ff6b6b', fontSize: 13 }}>{error}</div>
        ) : videos.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>尚未上傳任何影片</div>
        ) : (
          <table className="ff-tbl">
            <thead>
              <tr><th>FILENAME</th><th>COURSE</th><th>STATUS</th><th>DATE</th></tr>
            </thead>
            <tbody>
              {videos.map((v) => {
                const status = v.processing?.status;
                const badge = STATUS_MAP[status] || { text: status || '—', cls: 'bb' };
                const date = v.processing?.queuedAt || v.createdAt;
                return (
                  <tr key={v.id || v._id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ color: '#F14F21' }}><Ic n="film" s={14} /></div>
                        <span>{v.title || v.file_name || '未命名'}</span>
                      </div>
                    </td>
                    <td><span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{v.courseName}</span></td>
                    <td>
                      {status ? <span className={`badge ${badge.cls}`}>{badge.text}</span> : '—'}
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>
                      {date ? new Date(date).toLocaleDateString('zh-TW') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
