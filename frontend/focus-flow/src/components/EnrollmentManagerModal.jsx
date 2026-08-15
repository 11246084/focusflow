import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.68)', padding: 18,
  },
  box: {
    width: 'min(620px, 96vw)', maxHeight: '88vh', overflow: 'auto', padding: 26,
    borderRadius: 18, background: '#1a0d1e', border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
  },
  input: {
    flex: 1, minWidth: 0, boxSizing: 'border-box', borderRadius: 10, padding: '10px 12px',
    color: '#fff', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.16)',
    outline: 'none', fontSize: 13,
  },
};

function enrollmentKey(enrollment) {
  return enrollment.student?.id || enrollment.studentId || enrollment._id;
}

// The modal always reloads the server-owned roster after mutations; this keeps
// reactivation/revocation semantics out of optimistic frontend state.

export default function EnrollmentManagerModal({ course, onClose }) {
  const [enrollments, setEnrollments] = useState([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/courses/${course._id}/enrollments`);
      setEnrollments(response.data?.enrollments || []);
    } catch (err) {
      setError(err.message || '載入修課名單失敗。');
    } finally {
      setLoading(false);
    }
  }, [course._id]);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(event) {
    event.preventDefault();
    const studentEmail = email.trim().toLowerCase();
    if (!studentEmail) {
      setError('請輸入學生完整 Email。');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await apiFetch(`/courses/${course._id}/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentEmail }),
      });
      setEmail('');
      await load();
    } catch (err) {
      setError(err.message || '加入學生失敗。');
    } finally {
      setSaving(false);
    }
  }

  async function revoke(studentId) {
    setRevokingId(studentId);
    setError('');
    try {
      await apiFetch(`/courses/${course._id}/enrollments/${studentId}`, { method: 'DELETE' });
      setEnrollments((current) => current.filter((item) => enrollmentKey(item) !== studentId));
      setConfirmId('');
    } catch (err) {
      setError(err.message || '撤銷修課資格失敗。');
    } finally {
      setRevokingId('');
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose} role="presentation">
      <section style={styles.box} onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="enrollment-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
          <div>
            <h2 id="enrollment-title" style={{ margin: 0, color: '#fff', fontSize: 17 }}>修課學生管理</h2>
            <div style={{ marginTop: 5, color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{course.title}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉修課學生管理" style={{ border: 0, background: 'transparent', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        <p style={{ margin: '18px 0 12px', color: 'rgba(255,255,255,0.68)', fontSize: 12.5, lineHeight: 1.65 }}>
          學生只有在此名單且課程已發布時，才能瀏覽課程、影片、QA、Shorts、通知與 LINE 問答。請用完整 Email 精確加入，系統不會顯示全站學生名單。
        </p>

        <form onSubmit={assign} style={{ display: 'flex', gap: 9 }}>
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="student@example.com"
            aria-label="學生 Email"
            style={styles.input}
          />
          <button className="btn-primary" type="submit" disabled={saving} style={{ padding: '9px 16px', fontSize: 12, whiteSpace: 'nowrap' }}>
            {saving ? '加入中…' : '加入學生'}
          </button>
        </form>

        {error && <div role="alert" style={{ marginTop: 12, color: '#fca5a5', fontSize: 12 }}>{error}</div>}

        <div style={{ marginTop: 22, borderTop: '1px solid rgba(255,255,255,0.09)', paddingTop: 16 }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: '.08em', marginBottom: 10 }}>
            目前修課學生（{enrollments.length}）
          </div>
          {loading ? (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>載入中…</div>
          ) : enrollments.length === 0 ? (
            <div style={{ padding: 18, border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 10, color: 'rgba(255,255,255,0.46)', fontSize: 12, textAlign: 'center' }}>
              尚未加入任何學生
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {enrollments.map((enrollment) => {
                const studentId = enrollmentKey(enrollment);
                const confirming = confirmId === studentId;
                return (
                  <div key={studentId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.045)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{enrollment.student?.name || '未命名學生'}</div>
                      <div style={{ color: 'rgba(255,255,255,0.48)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{enrollment.student?.email}</div>
                    </div>
                    {confirming ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ color: '#fca5a5', fontSize: 11 }}>確認撤銷？</span>
                        <button type="button" onClick={() => setConfirmId('')} style={{ background: 'none', border: 0, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 11 }}>取消</button>
                        <button type="button" disabled={revokingId === studentId} onClick={() => revoke(studentId)} style={{ background: '#dc2626', border: 0, borderRadius: 7, color: '#fff', cursor: 'pointer', padding: '5px 9px', fontSize: 11 }}>
                          {revokingId === studentId ? '處理中…' : '撤銷'}
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(studentId)} style={{ background: 'none', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 8, color: '#fca5a5', cursor: 'pointer', padding: '5px 9px', fontSize: 11 }}>
                        撤銷資格
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
