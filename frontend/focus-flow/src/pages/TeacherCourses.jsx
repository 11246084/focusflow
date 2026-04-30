import { useState, useEffect } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

const COURSE_STATUS_LABEL = {
  draft: '草稿',
  published: '已發布',
  archived: '已封存',
};

const COURSE_STATUS_BADGE = {
  draft: 'bb',
  published: 'bg',
  archived: 'by',
};

const VIDEO_STATUS_MAP = {
  completed: { text: '完成', cls: 'bg' },
  processing: { text: '處理中', cls: 'by' },
  queued: { text: '佇列中', cls: 'bb' },
  failed: { text: '失敗', cls: 'br' },
};

const MODAL_STYLE = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  box: {
    background: '#1a0d1e',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 18,
    padding: 28,
    width: 420,
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  },
  label: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.68)',
    letterSpacing: '.08em',
    marginBottom: 6,
    display: 'block',
  },
  input: {
    width: '100%',
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 10,
    padding: '9px 12px',
    color: '#fff',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  },
};

function CreateCourseModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { overlay, box, label, input } = MODAL_STYLE;

  async function save() {
    if (!title.trim()) {
      setError('請輸入課程名稱。');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const res = await apiFetch('/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          status,
        }),
      });
      onCreated(res.data.course);
    } catch (e) {
      setError(e.message || '新增課程失敗。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>
            新增課程
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontSize: 20, lineHeight: 1 }}
          >
            x
          </button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>課程名稱 *</label>
          <input style={input} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：影像處理導論" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>課程描述</label>
          <textarea
            style={{ ...input, resize: 'vertical', minHeight: 72 }}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="簡短描述這門課的內容"
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={label}>狀態</label>
          <select style={{ ...input, cursor: 'pointer' }} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="draft">草稿 draft</option>
            <option value="published">已發布 published</option>
            <option value="archived">已封存 archived</option>
          </select>
        </div>

        {error && <div style={{ fontSize: 12, color: '#fb923c', marginBottom: 14 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10, color: 'rgba(255,255,255,0.82)', padding: '9px 18px', fontSize: 12, cursor: 'pointer' }}
          >
            取消
          </button>
          <button className="btn-primary" onClick={save} disabled={saving} style={{ padding: '9px 20px', fontSize: 12 }}>
            {saving ? '儲存中...' : '建立課程'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TeacherCourses() {
  const [courses, setCourses] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');

      try {
        const coursesRes = await apiFetch('/courses');
        const loadedCourses = coursesRes.data?.courses || [];
        const allVideos = [];

        await Promise.all(
          loadedCourses.map(async (course) => {
            try {
              const vRes = await apiFetch(`/courses/${course._id}/videos`);
              const courseVideos = vRes.data?.videos || [];
              courseVideos.forEach(video => allVideos.push({ ...video, courseName: course.title }));
            } catch {
              // Skip inaccessible or transiently unavailable video lists.
            }
          }),
        );

        allVideos.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
        setCourses(loadedCourses);
        setVideos(allVideos);
      } catch (e) {
        setError(e.message || '載入課程失敗。');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [refreshKey]);

  function onCreated(course) {
    setCourses(prev => [course, ...prev]);
    setCreating(false);
  }

  async function handleDelete(video) {
    const videoId = video.id || video._id;
    setDeleting(videoId);

    try {
      await apiFetch(`/videos/${videoId}`, { method: 'DELETE' });
      setVideos(prev => prev.filter(item => (item.id || item._id) !== videoId));
      setRefreshKey(key => key + 1);
    } catch {
      // Keep the modal simple for now; failed deletes leave the row in place.
    } finally {
      setDeleting(null);
      setConfirm(null);
    }
  }

  const overlay = MODAL_STYLE.overlay;
  const box = { ...MODAL_STYLE.box, width: 380 };

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {creating && <CreateCourseModal onClose={() => setCreating(false)} onCreated={onCreated} />}

      {confirm && (
        <div style={overlay} onClick={() => setConfirm(null)}>
          <div style={box} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 10 }}>確認刪除影片</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)', marginBottom: 6, lineHeight: 1.7 }}>
              刪除後會移除影片和相關 AI 片段資料，這個動作無法復原。
            </div>
            <div style={{ fontSize: 13, color: '#fb923c', fontWeight: 600, marginBottom: 22, wordBreak: 'break-all' }}>
              {confirm.title || confirm.fileName || confirm.file_name || '未命名影片'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirm(null)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10, color: 'rgba(255,255,255,0.82)', padding: '9px 18px', fontSize: 12, cursor: 'pointer' }}>取消</button>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 12 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>Course Management</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn-primary"
            onClick={() => setRefreshKey(key => key + 1)}
            style={{ padding: '9px 16px', fontSize: 12, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.86)', border: '1px solid rgba(255,255,255,0.16)' }}
          >
            <Ic n="sync" s={13} /> 重新整理
          </button>
          <button className="btn-primary" onClick={() => setCreating(true)} style={{ padding: '9px 20px', fontSize: 12 }}>
            <Ic n="plus" s={13} /> 新增課程
          </button>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 18 }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.72)', fontSize: 13 }}>載入中...</div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#ff6b6b', fontSize: 13 }}>{error}</div>
        ) : courses.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.72)', fontSize: 13 }}>尚未建立課程</div>
        ) : (
          <table className="ff-tbl">
            <thead>
              <tr><th>TITLE</th><th>STATUS</th><th>VIDEOS</th><th>CREATED</th></tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course._id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ color: '#a5b4fc', flexShrink: 0 }}><Ic n="book" s={14} /></div>
                      <div>
                        <div style={{ color: '#fff', fontWeight: 700 }}>{course.title}</div>
                        {course.description && (
                          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 3, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {course.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${COURSE_STATUS_BADGE[course.status] || 'bb'}`}>
                      {COURSE_STATUS_LABEL[course.status] || course.status || '未知'}
                    </span>
                  </td>
                  <td style={{ fontFamily: "'Space Grotesk',sans-serif", color: 'rgba(255,255,255,0.9)' }}>
                    {course.videoIds?.length ?? 0}
                  </td>
                  <td style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12 }}>
                    {course.createdAt ? new Date(course.createdAt).toLocaleDateString('zh-TW') : '未記錄'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Uploaded Videos</div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.72)', fontSize: 13 }}>載入中...</div>
        ) : videos.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.72)', fontSize: 13 }}>尚無上傳影片</div>
        ) : (
          <table className="ff-tbl">
            <thead>
              <tr><th>FILENAME</th><th>COURSE</th><th>STATUS</th><th>DATE</th><th></th></tr>
            </thead>
            <tbody>
              {videos.map((video) => {
                const status = video.processing?.status;
                const badge = VIDEO_STATUS_MAP[status] || { text: status || '未知', cls: 'bb' };
                const date = video.processing?.queuedAt || video.createdAt;
                const videoId = video.id || video._id;

                return (
                  <tr key={videoId}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ color: '#F14F21' }}><Ic n="film" s={14} /></div>
                        <span style={{ color: '#fff', fontWeight: 700 }}>{video.title || video.fileName || video.file_name || '未命名影片'}</span>
                      </div>
                    </td>
                    <td><span style={{ fontSize: 12, color: 'rgba(255,255,255,0.78)' }}>{video.courseName}</span></td>
                    <td>{status ? <span className={`badge ${badge.cls}`}>{badge.text}</span> : '未知'}</td>
                    <td style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12 }}>
                      {date ? new Date(date).toLocaleDateString('zh-TW') : '未記錄'}
                    </td>
                    <td>
                      <button
                        onClick={() => setConfirm(video)}
                        disabled={deleting === videoId}
                        style={{ background: 'none', border: '1px solid rgba(220,38,38,0.5)', borderRadius: 8, color: '#fca5a5', padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
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
