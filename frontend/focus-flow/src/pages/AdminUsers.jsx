import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

const ROLE_LABELS = { student: '學生', teacher: '教師', admin: '管理員' };
const ROLE_BADGE = { student: 'bb', teacher: 'bg', admin: 'br' };
const MAX_DAILY_ASK_LIMIT = 1000;

// dailyAskLimitOverride：null 跟隨全站預設、0 不限、正整數為自訂次數。
function askLimitModeOf(override) {
  if (override === null || override === undefined) return 'default';
  return override === 0 ? 'unlimited' : 'custom';
}

function describeAskLimit(override) {
  if (override === 0) return '提問不限';
  if (Number.isInteger(override)) return `每日 ${override} 次`;
  return null;
}

function EditModal({ user, dailyAskLimitDefault, onClose, onSaved }) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [askLimitMode, setAskLimitMode] = useState(askLimitModeOf(user.dailyAskLimitOverride));
  const [customLimit, setCustomLimit] = useState(
    user.dailyAskLimitOverride > 0 ? String(user.dailyAskLimitOverride) : '',
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const resolveOverride = () => {
    if (askLimitMode === 'default') return null;
    if (askLimitMode === 'unlimited') return 0;
    const value = Number(customLimit);
    if (!Number.isInteger(value) || value < 1 || value > MAX_DAILY_ASK_LIMIT) {
      throw new Error(`自訂次數需為 1 到 ${MAX_DAILY_ASK_LIMIT} 的整數`);
    }
    return value;
  };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const body = { name, role, isActive };
      if (role === 'student') body.dailyAskLimitOverride = resolveOverride();
      const updated = await apiFetch(`/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onSaved(updated.data);
    } catch (e) {
      setErr(e.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  const box = { background: '#1a0d1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, padding: 28, width: 'min(380px, 92vw)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' };
  const label = { fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '.08em', marginBottom: 6, display: 'block' };
  const inp = { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '9px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
  const sel = { ...inp, cursor: 'pointer' };

  // Portal to <body>: the page's .fu animation leaves a transform on the scroll container,
  // which would otherwise become the containing block for position:fixed and misplace the modal.
  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>編輯用戶</div>
          <span onClick={onClose} style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 18, lineHeight: 1 }}>×</span>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Email（不可修改）</label>
          <div style={{ ...inp, color: 'rgba(255,255,255,0.35)' }}>{user.email}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>姓名</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>身分</label>
          <select style={sel} value={role} onChange={e => setRole(e.target.value)}>
            <option value="student">學生</option>
            <option value="teacher">教師</option>
            <option value="admin">管理員</option>
          </select>
        </div>

        {role === 'student' && (
          <div style={{ marginBottom: 14 }}>
            <label style={label}>每日提問上限</label>
            <select style={sel} value={askLimitMode} onChange={e => setAskLimitMode(e.target.value)}>
              <option value="default">
                {dailyAskLimitDefault > 0 ? `全站預設（${dailyAskLimitDefault} 次）` : '全站預設（不限）'}
              </option>
              <option value="unlimited">不限次數</option>
              <option value="custom">自訂次數</option>
            </select>
            {askLimitMode === 'custom' && (
              <input
                style={{ ...inp, marginTop: 8 }}
                type="number"
                min={1}
                max={MAX_DAILY_ASK_LIMIT}
                step={1}
                placeholder="每日可提問次數"
                value={customLimit}
                onChange={e => setCustomLimit(e.target.value)}
              />
            )}
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
              網頁與 LINE 合併計算，台灣時間 00:00 重置。
            </div>
          </div>
        )}

        <div style={{ marginBottom: 22, display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ ...label, marginBottom: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} style={{ accentColor: '#4ade80', width: 15, height: 15 }} />
            <span>帳號啟用</span>
          </label>
        </div>

        {err && <div style={{ fontSize: 12, color: '#fb923c', marginBottom: 14 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', padding: '9px 18px', fontSize: 12, cursor: 'pointer' }}>取消</button>
          <button className="btn-primary" onClick={save} disabled={saving} style={{ padding: '9px 20px', fontSize: 12 }}>
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [dailyAskLimitDefault, setDailyAskLimitDefault] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [tick, setTick] = useState(0);

  const load = () => setTick(t => t + 1);

  useEffect(() => {
    apiFetch('/admin/users')
      .then(r => {
        setUsers(r.data.users);
        setDailyAskLimitDefault(r.data.dailyAskLimitDefault ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tick]);

  const onSaved = (updated) => {
    setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u));
    setEditing(null);
  };

  const avatarColor = role => role === 'teacher' ? { bg: 'rgba(74,222,128,0.2)', fg: '#4ade80' } : role === 'admin' ? { bg: 'rgba(241,79,33,0.2)', fg: '#F14F21' } : { bg: 'rgba(165,180,252,0.2)', fg: '#a5b4fc' };

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {editing && (
        <EditModal
          user={editing}
          dailyAskLimitDefault={dailyAskLimitDefault}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>使用者列表</div>
        <button className="btn-primary" onClick={load} style={{ padding: '9px 20px', fontSize: 12 }}><Ic n="sync" s={13} />重新整理</button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>載入中...</div>
        ) : (
          <div className="ff-tbl-wrap">
          <table className="ff-tbl">
            <thead>
              <tr><th>使用者</th><th>Email</th><th>身分</th><th>課程數</th><th>提問數</th><th>狀態</th><th>加入日期</th><th></th></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const av = avatarColor(u.role);
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: av.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: av.fg, fontFamily: "'Space Grotesk',sans-serif", flexShrink: 0 }}>
                          {u.name?.[0] || '?'}
                        </div>
                        {u.name}
                      </div>
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12 }}>{u.email}</td>
                    <td><span className={`badge ${ROLE_BADGE[u.role] || 'bb'}`}>{ROLE_LABELS[u.role] || u.role}</span></td>
                    <td>{u.courses || '—'}</td>
                    <td>{u.queries || '—'}</td>
                    <td>
                      <span className={`badge ${u.isActive ? 'bg' : 'br'}`}>{u.isActive ? '啟用' : '停用'}</span>
                      {u.role === 'student' && describeAskLimit(u.dailyAskLimitOverride) && (
                        <span className="badge bb" style={{ marginLeft: 6 }}>{describeAskLimit(u.dailyAskLimitOverride)}</span>
                      )}
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString('zh-TW') : '—'}
                    </td>
                    <td>
                      <button onClick={() => setEditing(u)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: 'rgba(255,255,255,0.55)', padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}>
                        編輯
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
