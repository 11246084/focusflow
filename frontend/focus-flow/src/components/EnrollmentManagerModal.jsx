import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const ROSTER_HEADERS = {
  name: ['name', '姓名'],
  email: ['email', 'e-mail', 'mail', '信箱', '電子郵件'],
  studentId: ['studentid', 'student_id', '學號'],
};

const SKIP_REASONS = {
  INVALID_NAME: '姓名空白',
  INVALID_EMAIL: 'Email 格式錯誤',
  STUDENT_ID_TOO_SHORT: '學號少於 8 碼',
  DUPLICATE_IN_FILE: '檔案內 Email 重複',
  NOT_STUDENT: '此 Email 是教師或管理員帳號',
  INACTIVE_ACCOUNT: '帳號已停用',
  DUPLICATE_ACCOUNT: '帳號同時被建立，請重新匯入',
};

// Minimal CSV parser (quoted fields, CRLF, Excel UTF-8 BOM); header row must
// contain 姓名 / Email / 學號 (or English equivalents) in any order.
function parseRosterCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const raw = String(text);
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') inQuotes = false;
      else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((cells) => cells.some((cell) => cell.trim()));
  if (nonEmpty.length < 2) throw new Error('CSV 沒有學生資料。');

  const header = nonEmpty[0].map((cell) => cell.trim().toLowerCase());
  const columns = {};
  for (const [key, aliases] of Object.entries(ROSTER_HEADERS)) {
    columns[key] = header.findIndex((cell) => aliases.includes(cell));
    if (columns[key] === -1) throw new Error('CSV 第一列需要「姓名」、「Email」、「學號」三個欄位。');
  }
  return nonEmpty.slice(1).map((cells) => ({
    name: String(cells[columns.name] || '').trim(),
    email: String(cells[columns.email] || '').trim(),
    studentId: String(cells[columns.studentId] || '').trim(),
  }));
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
  const [pendingImport, setPendingImport] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

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

  async function pickRoster(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setImportResult(null);
    try {
      const students = parseRosterCsv(await file.text());
      if (students.length > 200) throw new Error('單次最多匯入 200 位學生，請分批匯入。');
      setPendingImport({ fileName: file.name, students });
    } catch (err) {
      setError(err.message || '無法讀取 CSV。');
    }
  }

  async function confirmImport() {
    setImporting(true);
    setError('');
    try {
      const response = await apiFetch(`/courses/${course._id}/enrollments/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ students: pendingImport.students }),
      });
      setImportResult(response.data);
      setPendingImport(null);
      await load();
    } catch (err) {
      setError(err.message || '匯入名單失敗。');
    } finally {
      setImporting(false);
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

  // Portal to <body>: a transformed/animated ancestor would otherwise become the
  // containing block for position:fixed and clip the overlay to that card.
  return createPortal(
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

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={pickRoster} hidden />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 8, color: 'rgba(255,255,255,0.85)', cursor: 'pointer', padding: '7px 12px', fontSize: 12 }}
          >
            匯入 CSV 名單
          </button>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11.5 }}>
            欄位：姓名、Email、學號。沒有帳號的學生會自動建立，初始密碼為學號；已有帳號者只加入課程。
          </span>
        </div>

        {pendingImport && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <div style={{ color: '#fff', fontSize: 12.5 }}>
              {pendingImport.fileName}：共 {pendingImport.students.length} 位學生，確定匯入到「{course.title}」？
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setPendingImport(null)} disabled={importing} style={{ background: 'none', border: 0, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 12 }}>取消</button>
              <button className="btn-primary" type="button" onClick={confirmImport} disabled={importing} style={{ padding: '7px 14px', fontSize: 12 }}>
                {importing ? '匯入中…' : '確認匯入'}
              </button>
            </div>
          </div>
        )}

        {importResult && (
          <div role="status" style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
            新建帳號 {importResult.created} 位，加入課程 {importResult.enrolled} 位
            {importResult.skipped?.length > 0 && `，略過 ${importResult.skipped.length} 列：`}
            {importResult.skipped?.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#fca5a5' }}>
                {importResult.skipped.map((item) => (
                  <li key={item.row}>第 {item.row} 位 {item.email || '（無 Email）'}：{SKIP_REASONS[item.reason] || item.reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}

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
    </div>,
    document.body,
  );
}
