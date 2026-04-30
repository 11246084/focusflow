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
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(null);

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
        all.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
        setVideos(all.filter(v => v.processing?.status === 'completed'));
      } catch (e) {
        setError(e.message || '載入失敗');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleDelete = async (video) => {
    setDeleting(video.id || video._id);
    try {
      await apiFetch(`/videos/${video.id || video._id}`, { method: 'DELETE' });
      setVideos(prev => prev.filter(v => (v.id || v._id) !== (video.id || video._id)));
    } catch {
      // silent fail
    } finally {
      setDeleting(null);
      setConfirm(null);
    }
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  const box = { background: '#1a0d1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, padding: 28, width: 380, boxShadow: '0 24px 64px rgba(0,0,0,0.6)' };

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {confirm && (
        <div style={overlay} onClick={() => setConfirm(null)}>
          <div style={box} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 10 }}>確認刪除影片</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
              以下影片及其所有 AI 索引片段將從資料庫永久刪除：
            </div>
            <div style={{ fontSize: 13, color: '#fb923c', fontWeight: 600, marginBottom: 22, wordBreak: 'break-all' }}>
              {confirm.title || confirm.file_name || '未命名'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirm(null)} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', padding: '9px 18px', fontSize: 12, cursor: 'pointer' }}>取消</button>
              <button
                onClick={() => handleDelete(confirm)}
                disabled={!!deleting}
                style={{ background: '#dc2626', border: 'none', borderRadius: 10, color: '#fff', padding: '9px 20px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                {deleting ? '刪除中...' : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 18 }}>Course Videos</div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>載入中…</div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#ff6b6b', fontSize: 13 }}>{error}</div>
        ) : videos.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>尚無完成的影片</div>
        ) : (
          <table className="ff-tbl">
            <thead>
              <tr><th>FILENAME</th><th>COURSE</th><th>STATUS</th><th>DATE</th><th></th></tr>
            </thead>
            <tbody>
              {videos.map((v) => {
                const status = v.processing?.status;
                const badge = STATUS_MAP[status] || { text: status || '—', cls: 'bb' };
                const date = v.processing?.queuedAt || v.createdAt;
                const vid = v.id || v._id;
                return (
                  <tr key={vid}>
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
                    <td>
                      <button
                        onClick={() => setConfirm(v)}
                        disabled={deleting === vid}
                        style={{ background: 'none', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 8, color: '#f87171', padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
                      >
                        刪除
                      </button>
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
