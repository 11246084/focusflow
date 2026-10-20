import { useState } from 'react';
import { createPortal } from 'react-dom';
import useModalDialog from '../hooks/useModalDialog';
import { restoreVideoSource } from '../services/youtubeLifecycle';

// 補回原片（決策 #23）：原片被清理後，上傳檔案存回同一支影片，影片 ID 與問答紀錄不變。
export default function RestoreSourceModal({ video, onClose, onRestored }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useModalDialog(() => { if (!busy) onClose(); });
  const videoId = video.id || video._id;
  const title = video.title || video.fileName || video.file_name || '未命名影片';

  async function handleSubmit(event) {
    event.preventDefault();
    if (!file) {
      setError('請選擇要補回的原始影片檔。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const restored = await restoreVideoSource(videoId, file);
      onRestored?.(restored);
    } catch (e) {
      setError(e.message || '補回原片失敗，請稍後再試。');
      setBusy(false);
    }
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => { if (!busy) onClose(); }}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-source-title"
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#1a0d1e', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 18, padding: 26, width: 'min(440px, 92vw)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
      >
        <div id="restore-source-title" style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 10 }}>補回原片</div>
        <div style={{ fontSize: 13, color: '#fb923c', fontWeight: 600, marginBottom: 8, overflowWrap: 'anywhere' }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.72)', lineHeight: 1.7, marginBottom: 14 }}>
          這支影片的原片已從伺服器清理。上傳原始影片檔後會存回同一支影片，之後就能重新處理；
          不會重新上傳 YouTube，學生照常觀看 YouTube 版本。請上傳與這支影片相同內容的檔案。
        </div>
        <form onSubmit={handleSubmit}>
          <input
            type="file"
            accept="video/*"
            aria-label="原始影片檔"
            disabled={busy}
            onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }}
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', width: '100%' }}
          />
          {error && <div role="alert" style={{ fontSize: 12, color: '#fb923c', marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
            <button type="button" onClick={onClose} disabled={busy} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10, color: 'rgba(255,255,255,0.82)', padding: '9px 18px', fontSize: 12, cursor: 'pointer' }}>取消</button>
            <button type="submit" disabled={busy || !file} style={{ background: '#F14F21', border: 'none', borderRadius: 10, color: '#fff', padding: '9px 20px', fontSize: 12, cursor: busy || !file ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: busy || !file ? 0.6 : 1 }}>
              {busy ? '上傳中...' : '上傳並補回'}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
