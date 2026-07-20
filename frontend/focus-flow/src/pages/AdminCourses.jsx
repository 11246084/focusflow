import { useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

const STATUS_LABEL = { draft: '草稿', published: '已發布', archived: '封存' };
const STATUS_BADGE = { draft: 'bb', published: 'bg', archived: 'by' };

const MODAL_STYLE = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  box: { background: '#1a0d1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, padding: 28, width: 'min(420px, 92vw)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' },
  label: { fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '.08em', marginBottom: 6, display: 'block' },
  inp: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '9px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
};

function CourseModal({ course, teachers, onClose, onSaved }) {
  const isEdit = !!course;
  const [title, setTitle] = useState(course?.title || '');
  const [description, setDescription] = useState(course?.description || '');
  const [status, setStatus] = useState(course?.status || 'draft');
  const [teacherId, setTeacherId] = useState(course?.teacherId?._id || course?.teacherId || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!title.trim()) { setErr('課程名稱為必填'); return; }
    if (!teacherId) { setErr('Please assign a teacher.'); return; }
    setSaving(true); setErr('');
    try {
      let res;
      if (isEdit) {
        res = await apiFetch(`/courses/${course._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description, status, teacherId }),
        });
        onSaved(res.data.course, 'edit');
      } else {
        res = await apiFetch('/courses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description, status, teacherId: teacherId || undefined }),
        });
        onSaved(res.data.course, 'create');
      }
    } catch (e) {
      setErr(e.message || '操作失敗');
    } finally {
      setSaving(false);
    }
  };

  const { overlay, box, label, inp } = MODAL_STYLE;

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>
            {isEdit ? '編輯課程' : '新增課程'}
          </div>
          <span onClick={onClose} style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 20, lineHeight: 1 }}>×</span>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>課程名稱 *</label>
          <input style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="請輸入課程名稱" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>課程描述</label>
          <textarea style={{ ...inp, resize: 'vertical', minHeight: 72 }} value={description} onChange={e => setDescription(e.target.value)} placeholder="選填" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>狀態</label>
          <select style={{ ...inp, cursor: 'pointer' }} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="draft">草稿 draft</option>
            <option value="published">已發布 published</option>
            {isEdit && <option value="archived">封存 archived</option>}
          </select>
        </div>

        {!isEdit && (
          <div style={{ marginBottom: 22 }}>
            <label style={label}>指定教師（選填，留空則由管理員擁有）</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={teacherId} onChange={e => setTeacherId(e.target.value)}>
              <option value="">— 不指定 —</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.email})</option>
              ))}
            </select>
          </div>
        )}

        {isEdit && (
          <div style={{ marginBottom: 22 }}>
            <label style={label}>TEACHER *</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={teacherId} onChange={e => setTeacherId(e.target.value)}>
              <option value="">Select teacher</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.email})</option>
              ))}
            </select>
          </div>
        )}

        {err && <div style={{ fontSize: 12, color: '#fb923c', marginBottom: 14 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', padding: '9px 18px', fontSize: 12, cursor: 'pointer' }}>取消</button>
          <button className="btn-primary" onClick={save} disabled={saving} style={{ padding: '9px 20px', fontSize: 12 }}>
            {saving ? '儲存中...' : (isEdit ? '儲存修改' : '建立課程')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({ course, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');

  const doDelete = async () => {
    setDeleting(true); setErr('');
    try {
      await apiFetch(`/courses/${course._id}`, { method: 'DELETE' });
      onDeleted(course._id);
    } catch (e) {
      setErr(e.message || '刪除失敗');
      setDeleting(false);
    }
  };

  const { overlay, box } = MODAL_STYLE;
  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 10 }}>確認刪除課程</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
          以下課程及其所有影片、AI 索引片段、選課記錄將永久刪除：
        </div>
        <div style={{ fontSize: 13, color: '#fb923c', fontWeight: 600, marginBottom: 22 }}>{course.title}</div>
        {err && <div style={{ fontSize: 12, color: '#fb923c', marginBottom: 14 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', padding: '9px 18px', fontSize: 12, cursor: 'pointer' }}>取消</button>
          <button onClick={doDelete} disabled={deleting} style={{ background: '#dc2626', border: 'none', borderRadius: 10, color: '#fff', padding: '9px 20px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            {deleting ? '刪除中...' : '確認刪除'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminCourses() {
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    Promise.all([
      apiFetch('/courses'),
      apiFetch('/admin/users'),
    ]).then(([cr, ur]) => {
      setCourses(cr.data.courses || []);
      setTeachers((ur.data.users || []).filter(u => u.role === 'teacher'));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [tick]);

  const onSaved = (course, mode) => {
    if (mode === 'create') setCourses(prev => [course, ...prev]);
    else setCourses(prev => prev.map(c => (c._id === course._id ? course : c)));
    setCreating(false);
    setEditing(null);
  };

  const onDeleted = (courseId) => {
    setCourses(prev => prev.filter(c => c._id !== courseId));
    setDeleting(null);
  };

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {creating && <CourseModal teachers={teachers} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <CourseModal course={editing} teachers={teachers} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && <DeleteModal course={deleting} onClose={() => setDeleting(null)} onDeleted={onDeleted} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>Course Management</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-primary" onClick={() => setTick(t => t + 1)} style={{ padding: '9px 16px', fontSize: 12, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <Ic n="sync" s={13} />重新整理
          </button>
          <button className="btn-primary" onClick={() => setCreating(true)} style={{ padding: '9px 20px', fontSize: 12 }}>
            <Ic n="plus" s={13} />新增課程
          </button>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>載入中...</div>
        ) : courses.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>尚無課程</div>
        ) : (
          <div className="ff-tbl-wrap">
          <table className="ff-tbl">
            <thead>
              <tr><th>TITLE</th><th>TEACHER</th><th>STATUS</th><th>VIDEOS</th><th>CREATED</th><th></th></tr>
            </thead>
            <tbody>
              {courses.map((c) => {
                const teacher = c.teacherId;
                const teacherName = typeof teacher === 'object' ? teacher?.name : '—';
                return (
                  <tr key={c._id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ color: '#a5b4fc', flexShrink: 0 }}><Ic n="book" s={14} /></div>
                        <span style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{c.title}</span>
                      </div>
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{teacherName}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[c.status] || 'bb'}`}>
                        {STATUS_LABEL[c.status] || c.status}
                      </span>
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.5)', fontFamily: "'Space Grotesk',sans-serif" }}>
                      {c.videoIds?.length ?? 0}
                    </td>
                    <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>
                      {c.createdAt ? new Date(c.createdAt).toLocaleDateString('zh-TW') : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setEditing(c)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: 'rgba(255,255,255,0.55)', padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}>
                          編輯
                        </button>
                        <button onClick={() => setDeleting(c)} style={{ background: 'none', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 8, color: '#f87171', padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}>
                          刪除
                        </button>
                      </div>
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
