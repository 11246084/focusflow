import { useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

const ROLE_LABELS = { student: '學生', teacher: '教師', admin: '管理員' };
const ROLE_BADGE = { student: 'bb', teacher: 'bg', admin: 'br' };

function EditModal({ user, onClose, onSaved }) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const updated = await apiFetch(`/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, isActive }),
      });
      onSaved(updated.data);
    } catch (e) {
      setErr(e.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  const box = { background: '#1a0d1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, padding: 28, width: 380, boxShadow: '0 24px 64px rgba(0,0,0,0.6)' };
  const label = { fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '.08em', marginBottom: 6, display: 'block' };
  const inp = { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '9px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
  const sel = { ...inp, cursor: 'pointer' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>編輯用戶</div>
          <span onClick={onClose} style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 18, lineHeight: 1 }}>×</span>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>EMAIL（唯讀）</label>
          <div style={{ ...inp, color: 'rgba(255,255,255,0.35)' }}>{user.email}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>NAME</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>ROLE</label>
          <select style={sel} value={role} onChange={e => setRole(e.target.value)}>
            <option value="student">學生 student</option>
            <option value="teacher">教師 teacher</option>
            <option value="admin">管理員 admin</option>
          </select>
        </div>

        <div style={{ marginBottom: 22, display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ ...label, marginBottom: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} style={{ accentColor: '#4ade80', width: 15, height: 15 }} />
            <span>帳號啟用（isActive）</span>
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
    </div>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [tick, setTick] = useState(0);

  const load = () => setTick(t => t + 1);

  useEffect(() => {
    apiFetch('/admin/users')
      .then(r => setUsers(r.data.users))
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
      {editing && <EditModal user={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>User Management</div>
        <button className="btn-primary" onClick={load} style={{ padding: '9px 20px', fontSize: 12 }}><Ic n="sync" s={13} />重新整理</button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>載入中...</div>
        ) : (
          <table className="ff-tbl">
            <thead>
              <tr><th>USER</th><th>EMAIL</th><th>ROLE</th><th>COURSES</th><th>QUERIES</th><th>STATUS</th><th>JOINED</th><th></th></tr>
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
        )}
      </div>
    </div>
  );
}
