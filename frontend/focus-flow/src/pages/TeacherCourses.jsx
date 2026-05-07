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

function Chevron({ open }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform .18s ease' }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function TeacherCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [confirmCourse, setConfirmCourse] = useState(null);
  const [deletingCourse, setDeletingCourse] = useState(null);
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [openIds, setOpenIds] = useState(() => new Set());

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');

      try {
        const coursesRes = await apiFetch('/courses');
        const loadedCourses = coursesRes.data?.courses || [];

        const enriched = await Promise.all(
          loadedCourses.map(async (course) => {
            try {
              const vRes = await apiFetch(`/courses/${course._id}/videos`);
              const courseVideos = vRes.data?.videos || [];
              courseVideos.sort((a, b) =>
                new Date(b.updatedAt || b.createdAt || 0) -
                new Date(a.updatedAt || a.createdAt || 0)
              );
              return { ...course, videos: courseVideos };
            } catch {
              return { ...course, videos: [] };
            }
          }),
        );

        setCourses(enriched);
      } catch (e) {
        setError(e.message || '載入課程失敗。');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [refreshKey]);

  function onCreated(course) {
    const withVideos = { ...course, videos: course.videos || [] };
    setCourses(prev => [withVideos, ...prev]);
    setCreating(false);
  }

  function toggle(id) {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDelete(video) {
    const videoId = video.id || video._id;
    setDeleting(videoId);

    try {
      await apiFetch(`/videos/${videoId}`, { method: 'DELETE' });
      setCourses(prev =>
        prev.map(c => ({
          ...c,
          videos: (c.videos || []).filter(v => (v.id || v._id) !== videoId),
        })),
      );
      setRefreshKey(key => key + 1);
    } catch {
      // Keep modal simple; failed deletes leave the row in place.
    } finally {
      setDeleting(null);
      setConfirm(null);
    }
  }

  async function handleDeleteCourse(course) {
    const courseId = course._id;
    setDeletingCourse(courseId);

    try {
      await apiFetch(`/courses/${courseId}`, { method: 'DELETE' });
      setCourses(prev => prev.filter(item => item._id !== courseId));
      setOpenIds(prev => {
        const next = new Set(prev);
        next.delete(courseId);
        return next;
      });
      setRefreshKey(key => key + 1);
    } catch {
      // 失敗時保留在列表中，讓使用者可重試。
    } finally {
      setDeletingCourse(null);
      setConfirmCourse(null);
    }
  }

  const overlay = MODAL_STYLE.overlay;
  const box = { ...MODAL_STYLE.box, width: 380 };

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {creating && <CreateCourseModal onClose={() => setCreating(false)} onCreated={onCreated} />}

      {confirmCourse && (
        <div style={overlay} onClick={() => setConfirmCourse(null)}>
          <div style={box} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 10 }}>確認刪除課程</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)', marginBottom: 6, lineHeight: 1.7 }}>
              刪除課程會一併移除底下所有影片、AI 片段、學生選課、提問紀錄與 LINE 課程選擇狀態，這個動作無法復原。
            </div>
            <div style={{ fontSize: 13, color: '#fb923c', fontWeight: 600, marginBottom: 22, wordBreak: 'break-all' }}>
              {confirmCourse.title || '未命名課程'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmCourse(null)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10, color: 'rgba(255,255,255,0.82)', padding: '9px 18px', fontSize: 12, cursor: 'pointer' }}>取消</button>
              <button
                onClick={() => handleDeleteCourse(confirmCourse)}
                disabled={!!deletingCourse}
                style={{ background: '#dc2626', border: 'none', borderRadius: 10, color: '#fff', padding: '9px 20px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                {deletingCourse ? '刪除中...' : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.72)', fontSize: 13 }}>載入中...</div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#ff6b6b', fontSize: 13 }}>{error}</div>
        ) : courses.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.72)', fontSize: 13 }}>尚未建立課程</div>
        ) : (
          <>
            {/* Header row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 110px 90px 120px 90px',
                alignItems: 'center',
                padding: '12px 20px',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                color: 'rgba(255,255,255,0.35)',
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
              }}
            >
              <div>Title</div>
              <div>Status</div>
              <div>Videos</div>
              <div>Created</div>
              <div />
            </div>

            {courses.map((course, idx) => {
              const open = openIds.has(course._id);
              const isLast = idx === courses.length - 1;
              const videos = course.videos || [];
              const created = course.createdAt ? new Date(course.createdAt).toLocaleDateString('zh-TW') : '未記錄';
              return (
                <div key={course._id} style={{ borderBottom: !isLast ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                  <div
                    onClick={() => toggle(course._id)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 110px 90px 120px 90px',
                      alignItems: 'center',
                      padding: '14px 20px',
                      cursor: 'pointer',
                      transition: 'background .15s',
                      background: open ? 'rgba(241,79,33,0.04)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
                    onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <div style={{ color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center' }}>
                        <Chevron open={open} />
                      </div>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: 'rgba(165,180,252,0.12)',
                        border: '1px solid rgba(165,180,252,0.22)',
                        color: '#a5b4fc',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <Ic n="book" s={16} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {course.title}
                        </div>
                        {course.description && (
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {course.description}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className={`badge ${COURSE_STATUS_BADGE[course.status] || 'bb'}`}>
                        {COURSE_STATUS_LABEL[course.status] || course.status || '未知'}
                      </span>
                    </div>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: 600 }}>
                      {videos.length}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{created}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmCourse(course); }}
                        disabled={deletingCourse === course._id}
                        style={{ background: 'none', border: '1px solid rgba(220,38,38,0.5)', borderRadius: 8, color: '#fca5a5', padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
                      >
                        刪除
                      </button>
                    </div>
                  </div>

                  {open && (
                    <div style={{ padding: '4px 20px 18px 56px', background: 'rgba(0,0,0,0.18)' }}>
                      {videos.length === 0 ? (
                        <div style={{
                          padding: '14px 16px',
                          borderRadius: 10,
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px dashed rgba(255,255,255,0.1)',
                          color: 'rgba(255,255,255,0.5)',
                          fontSize: 12.5,
                        }}>
                          此課程尚未上傳影片。前往 Upload 頁面新增第一支影片。
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 110px 110px 90px',
                            padding: '4px 14px',
                            color: 'rgba(255,255,255,0.32)',
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '.08em',
                            textTransform: 'uppercase',
                          }}>
                            <div>Filename</div>
                            <div>Status</div>
                            <div>Date</div>
                            <div />
                          </div>
                          {videos.map((video) => {
                            const status = video.processing?.status;
                            const badge = VIDEO_STATUS_MAP[status] || { text: status || '未知', cls: 'bb' };
                            const date = video.processing?.queuedAt || video.createdAt;
                            const videoId = video.id || video._id;
                            return (
                              <div
                                key={videoId}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: '1fr 110px 110px 90px',
                                  alignItems: 'center',
                                  padding: '10px 14px',
                                  borderRadius: 10,
                                  background: 'rgba(255,255,255,0.03)',
                                  border: '1px solid rgba(255,255,255,0.05)',
                                  transition: 'background .15s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                  <div style={{ color: '#F14F21', display: 'flex' }}>
                                    <Ic n="film" s={14} />
                                  </div>
                                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {video.title || video.fileName || video.file_name || '未命名影片'}
                                  </span>
                                </div>
                                <div>
                                  {status ? <span className={`badge ${badge.cls}`}>{badge.text}</span> : <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>未知</span>}
                                </div>
                                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
                                  {date ? new Date(date).toLocaleDateString('zh-TW') : '未記錄'}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                  <button
                                    onClick={() => setConfirm(video)}
                                    disabled={deleting === videoId}
                                    style={{ background: 'none', border: '1px solid rgba(220,38,38,0.5)', borderRadius: 8, color: '#fca5a5', padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
                                  >
                                    刪除
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div style={{
        marginTop: 14,
        padding: '12px 18px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12,
        fontSize: 12,
        color: 'rgba(255,255,255,0.4)',
        lineHeight: 1.7,
      }}>
        💡 點擊課程列即可展開該課程的影片清單；新增影片請至「Upload」頁面，上傳完成會自動歸入所選課程。
      </div>
    </div>
  );
}
