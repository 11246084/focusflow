import { useState } from 'react';
import { createPortal } from 'react-dom';
import useModalDialog from '../hooks/useModalDialog';
import { getVideoSourceState, reprocessVideo } from '../services/youtubeLifecycle';

export default function ReprocessVideoModal({ video, onClose, onQueued }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useModalDialog(() => { if (!busy) onClose(); });
  const source = getVideoSourceState(video);
  async function submit(event) {
    event.preventDefault();
    if (busy || source.reprocessDisabled) return;
    setBusy(true); setError('');
    try { const result = await reprocessVideo(video.id || video._id); onQueued(result); }
    catch (failure) { setError(failure.message || '無法重新處理，請稍後再試。'); setBusy(false); }
  }
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { if (!busy) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="reprocess-title" onClick={event => event.stopPropagation()}
        style={{ background: '#1a0d1e', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 18, padding: 26, width: 'min(440px,92vw)' }}>
        <h2 id="reprocess-title" style={{ color: '#fff', fontSize: 16, margin: '0 0 12px' }}>重新處理影片</h2>
        <p style={{ color: '#fb923c', overflowWrap: 'anywhere' }}>{video.title || '未命名影片'}</p>
        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 1.7 }}>重新執行語音轉文字與 AI 索引，影片 ID 不變，也不會重新上傳 YouTube。若已有 YouTube 版本，學生照常觀看。</p>
        {source.reprocessDisabled && <p role="status" style={{ color: '#fb923c', fontSize: 13 }}>{source.reprocessHint}</p>}
        {error && <p role="alert" style={{ color: '#fb923c', fontSize: 13 }}>{error}</p>}
        <form onSubmit={submit} style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn-secondary" type="button" disabled={busy} onClick={onClose}>取消</button>
          <button className="btn-primary" type="submit" disabled={busy || source.reprocessDisabled}>{busy ? '排入中...' : '確認重新處理'}</button>
        </form>
      </section>
    </div>, document.body,
  );
}
