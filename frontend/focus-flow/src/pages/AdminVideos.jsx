import { useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';
import RestoreSourceModal from '../components/RestoreSourceModal';
import ReprocessVideoModal from '../components/ReprocessVideoModal';
import { getVideoSourceState } from '../services/youtubeLifecycle';

const STATUS_LABEL = { completed: '完成', processing: '處理中', queued: '排隊', failed: '失敗', pending: '待處理' };
const STATUS_BADGE = { completed: 'bg', processing: 'by', queued: 'bb', failed: 'br', pending: 'bb' };

export default function AdminVideos() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [deleting, setDeleting] = useState(null);
  const [confirm, setConfirm] = useState(null); // video object pending confirmation
  const [restoring, setRestoring] = useState(null);
  const [reprocessing, setReprocessing] = useState(null);
  const [notice, setNotice] = useState('');

  const load = () => setTick(t => t + 1);

  useEffect(() => {
    apiFetch('/admin/videos')
      .then(r => setVideos(r.data.videos))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tick]);

  const handleDelete = async (video) => {
    setDeleting(video.id);
    try {
      await apiFetch(`/admin/videos/${video.id}`, { method: 'DELETE' });
      setVideos(prev => prev.filter(v => v.id !== video.id));
    } catch {
      // silent fail — could show toast here
    } finally {
      setDeleting(null);
      setConfirm(null);
    }
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  const box = { background: '#1a0d1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, padding: 28, width: 'min(380px, 92vw)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' };

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {restoring && (
        <RestoreSourceModal
          video={restoring}
          onClose={() => setRestoring(null)}
          onRestored={() => {
            setNotice(`已補回「${restoring.title}」的原片，現在可以重新處理。`);
            setRestoring(null);
            load();
          }}
        />
      )}

      {reprocessing && <ReprocessVideoModal video={reprocessing} onClose={() => setReprocessing(null)} onQueued={() => {
        setReprocessing(null); setNotice('已重新排入處理佇列。'); load();
      }} />}

      {/* Delete confirmation dialog */}
      {confirm && (
        <div style={overlay} onClick={() => setConfirm(null)}>
          <div style={box} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 10 }}>確認刪除影片</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
              以下影片及其所有 AI 索引片段（text embedding）將從資料庫永久刪除：
            </div>
            <div style={{ fontSize: 13, color: '#fb923c', fontWeight: 600, marginBottom: 22, wordBreak: 'break-all' }}>{confirm.title}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirm(null)} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', padding: '9px 18px', fontSize: 12, cursor: 'pointer' }}>取消</button>
              <button onClick={() => handleDelete(confirm)} disabled={deleting === confirm.id} style={{ background: '#dc2626', border: 'none', borderRadius: 10, color: '#fff', padding: '9px 20px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                {deleting === confirm.id ? '刪除中...' : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>影片列表</div>
        <button className="btn-primary" onClick={load} style={{ padding: '9px 20px', fontSize: 12 }}><Ic n="sync" s={13} />重新整理</button>
      </div>

      {notice && <div role="status" style={{ fontSize: 12, color: '#86efac', marginBottom: 10 }}>{notice}</div>}

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>載入中...</div>
        ) : videos.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>尚無影片資料</div>
        ) : (
          <div className="ff-tbl-wrap">
          <table className="ff-tbl">
            <thead>
              <tr><th>影片名稱</th><th>課程</th><th>教師</th><th>狀態</th><th>片段數</th><th>建立日期</th><th></th></tr>
            </thead>
            <tbody>
              {videos.map((v) => (
                <tr key={v.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ color: '#F14F21', flexShrink: 0 }}><Ic n="film" s={14} /></div>
                      <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{v.title}</span>
                    </div>
                  </td>
                  <td style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{v.course}</td>
                  <td style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{v.teacher}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[v.status] || 'bb'}`}>
                      {STATUS_LABEL[v.status] || v.status}
                    </span>
                    {getVideoSourceState(v).sourceCleaned && (
                      <span className="badge bb" style={{ marginLeft: 4 }} title="原片已從伺服器清理，播放改走 YouTube">原片已清理</span>
                    )}
                  </td>
                  <td style={{ color: v.segments > 0 ? '#F14F21' : 'rgba(255,255,255,0.3)', fontWeight: v.segments > 0 ? 700 : 400, fontFamily: "'Space Grotesk',sans-serif" }}>
                    {v.segments > 0 ? v.segments : '—'}
                  </td>
                  <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>
                    {v.createdAt ? new Date(v.createdAt).toLocaleDateString('zh-TW') : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {getVideoSourceState(v).showReprocess && (
                      <button onClick={() => setReprocessing(v)} disabled={getVideoSourceState(v).reprocessDisabled}
                        title={getVideoSourceState(v).reprocessHint} className="btn-secondary" style={{ marginRight: 6, padding: '5px 10px', fontSize: 11 }}>重新處理</button>
                    )}
                    {getVideoSourceState(v).canRestore && (
                      <button
                        onClick={() => setRestoring(v)}
                        title="上傳原始影片檔，存回同一支影片後可重新處理"
                        style={{ background: 'none', border: '1px solid rgba(165,180,252,0.45)', borderRadius: 8, color: '#c7d2fe', padding: '5px 10px', fontSize: 11, cursor: 'pointer', marginRight: 6 }}
                      >
                        補回原片
                      </button>
                    )}
                    <button
                      onClick={() => setConfirm(v)}
                      disabled={deleting === v.id}
                      style={{ background: 'none', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 8, color: '#f87171', padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
