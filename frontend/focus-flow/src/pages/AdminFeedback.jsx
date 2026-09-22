import { useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch, getToken, BACKEND_ORIGIN } from '../api';

const CATEGORY_LABEL = {
  login_account: '登入／帳號',
  course_video: '課程或影片',
  ai_qa: 'AI 問答',
  line_bot: 'LINE Bot',
  shorts: '教學短片',
  ui_operation: '畫面操作',
  other: '其他',
};
// Admin 端用精簡的高／中／低即可判斷優先序；完整描述留在學生/教師填寫的表單裡幫助選擇。
const SEVERITY_LABEL = {
  blocking: '高',
  partial: '中',
  minor: '低',
};
const SEVERITY_BADGE = { blocking: 'br', partial: 'by', minor: 'bg' };
const SEVERITY_FULL_LABEL = {
  blocking: '完全無法繼續使用',
  partial: '部分功能有問題，但仍可繼續使用',
  minor: '不影響使用，屬於小問題或建議',
};
const STATUS_LABEL = { open: '待處理', in_progress: '處理中', resolved: '已解決', closed: '已結案' };
const STATUS_COLOR = { open: '#f87171', in_progress: '#facc15', resolved: '#4ade80', closed: '#a5b4fc' };
const ROLE_LABEL = { student: '學生', teacher: '教師', admin: '管理員' };
const filterSelectStyle = { width: 'auto', padding: '9px 34px 9px 14px', fontSize: 12 };

function AttachmentsModal({ feedbackId, attachments, onClose }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    Promise.all(attachments.map(async (attachment) => {
      const res = await fetch(
        `${BACKEND_ORIGIN}/api/v1/feedback/${feedbackId}/attachments/${attachment.attachmentId}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) return null;
      const blob = await res.blob();
      return { url: URL.createObjectURL(blob), name: attachment.originalName || '附件' };
    })).then((results) => {
      if (!cancelled) setImages(results.filter(Boolean));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      images.forEach((image) => URL.revokeObjectURL(image.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackId]);

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 };
  const box = { background: '#1a0d1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, padding: 24, width: 'min(680px, 100%)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>附件截圖</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>載入中...</div>
        ) : images.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>無法載入附件</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {images.map((image, index) => (
              <a key={index} href={image.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
                <img src={image.url} alt={image.name} style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', display: 'block' }} />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminFeedback() {
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [updating, setUpdating] = useState(null);
  const [viewingAttachments, setViewingAttachments] = useState(null);

  const load = () => setTick((t) => t + 1);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (severityFilter) params.set('severity', severityFilter);
    const query = params.toString();
    setLoading(true);
    apiFetch(`/admin/feedback${query ? `?${query}` : ''}`)
      .then((r) => setFeedback(r.data.feedback))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tick, statusFilter, categoryFilter, severityFilter]);

  const handleStatusChange = async (item, status) => {
    setUpdating(item.id);
    try {
      const res = await apiFetch(`/admin/feedback/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setFeedback((prev) => prev.map((row) => (row.id === item.id ? { ...row, status: res.data.status } : row)));
    } catch {
      // silent fail — dropdown reverts on next load
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {viewingAttachments && (
        <AttachmentsModal
          feedbackId={viewingAttachments.id}
          attachments={viewingAttachments.attachments}
          onClose={() => setViewingAttachments(null)}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>問題回報列表</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="ff-input" style={filterSelectStyle}>
            <option value="">全部類型</option>
            {Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="ff-input" style={filterSelectStyle}>
            <option value="">全部影響程度</option>
            {Object.entries(SEVERITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="ff-input" style={filterSelectStyle}>
            <option value="">全部狀態</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button className="btn-primary" onClick={load} style={{ padding: '9px 20px', fontSize: 12 }}><Ic n="sync" s={13} />重新整理</button>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>載入中...</div>
        ) : feedback.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>尚無回報紀錄</div>
        ) : (
          <div className="ff-tbl-wrap">
            <table className="ff-tbl">
              <thead>
                <tr><th>提交者</th><th>類型</th><th>影響程度</th><th>內容</th><th>附件</th><th>狀態</th><th>時間</th></tr>
              </thead>
              <tbody>
                {feedback.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontSize: 13, color: '#fff' }}>{item.submitter?.name || '—'}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                        {ROLE_LABEL[item.submitter?.role] || item.submitter?.role} · {item.submitter?.email}
                      </div>
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{CATEGORY_LABEL[item.category] || item.category}</td>
                    <td>
                      <span
                        className={`badge ${SEVERITY_BADGE[item.severity] || 'bb'}`}
                        title={SEVERITY_FULL_LABEL[item.severity] || ''}
                      >
                        {SEVERITY_LABEL[item.severity] || item.severity}
                      </span>
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, maxWidth: 320 }}>
                      <div style={{ maxWidth: 320, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.description}</div>
                      {item.courseVideoName && (
                        <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                          課程／影片：{item.courseVideoName}
                        </div>
                      )}
                      {item.pageContext && (
                        <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>頁面：{item.pageContext}</div>
                      )}
                    </td>
                    <td>
                      {item.attachments.length > 0 ? (
                        <button
                          onClick={() => setViewingAttachments(item)}
                          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: 'rgba(255,255,255,0.75)', padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
                        >
                          查看 ({item.attachments.length})
                        </button>
                      ) : (
                        <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td>
                      <select
                        value={item.status}
                        disabled={updating === item.id}
                        onChange={(e) => handleStatusChange(item, e.target.value)}
                        className="ff-input"
                        style={{
                          ...filterSelectStyle,
                          color: STATUS_COLOR[item.status] || '#fff',
                          borderLeft: `3px solid ${STATUS_COLOR[item.status] || 'rgba(255,255,255,0.12)'}`,
                        }}
                      >
                        {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {item.createdAt ? new Date(item.createdAt).toLocaleString('zh-TW') : '—'}
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
