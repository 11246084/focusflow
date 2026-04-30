import { useState, useEffect, useRef, useCallback } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch, getToken } from '../api';

const STATUS_LABEL = {
  queued:     { text: '排隊中',  cls: 'bb' },
  processing: { text: '處理中',  cls: 'by' },
  completed:  { text: '已完成',  cls: 'bg' },
  failed:     { text: '失敗',    cls: 'br' },
};

function pipelineStep(stepIndex, status) {
  // stepIndex: 0=upload done, 1=queued, 2=processing, 3=completed
  if (status === 'completed') return stepIndex <= 3 ? 'done' : 'idle';
  if (status === 'processing') return stepIndex === 0 ? 'done' : stepIndex === 1 ? 'done' : stepIndex === 2 ? 'active' : 'idle';
  if (status === 'queued')     return stepIndex === 0 ? 'done' : stepIndex === 1 ? 'active' : 'idle';
  if (status === 'failed')     return stepIndex === 0 ? 'done' : 'fail';
  return stepIndex === 0 ? 'active' : 'idle'; // uploading
}

function StepDot({ state, n }) {
  const colors = { done: '#22c55e', active: '#F14F21', fail: '#ef4444', idle: 'rgba(255,255,255,0.15)' };
  const bg = `rgba(${state === 'done' ? '34,197,94' : state === 'active' ? '241,79,33' : state === 'fail' ? '239,68,68' : '255,255,255'},${state === 'idle' ? '0.08' : '0.2'})`;
  return (
    <div style={{ width: 20, height: 20, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: colors[state], flexShrink: 0, fontFamily: "'Space Grotesk',sans-serif" }}>
      {state === 'done' ? '✓' : n}
    </div>
  );
}

export default function TeacherUpload() {
  const [drag, setDrag]           = useState(false);
  const [courses, setCourses]     = useState([]);
  const [courseId, setCourseId]   = useState('');
  const [title, setTitle]         = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [videoId, setVideoId]     = useState(null);
  const [procStatus, setProcStatus] = useState(null); // null | 'queued' | 'processing' | 'completed' | 'failed'
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  // Load teacher's courses
  useEffect(() => {
    apiFetch('/courses')
      .then(res => {
        const list = res.data?.courses || [];
        setCourses(list);
        if (list.length > 0) setCourseId(list[0]._id);
      })
      .catch(() => {});
  }, []);

  // Poll processing status after upload
  const startPolling = useCallback((vid) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/videos/${vid}/processing`);
        const s = res.data?.processing?.status;
        setProcStatus(s);
        if (s === 'completed' || s === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // ignore transient poll errors
      }
    }, 3000);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function handleDrop(e) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('video/')) { setSelectedFile(f); setUploadError(''); }
    else setUploadError('請選取影片檔案（MP4、MOV、MKV）');
  }

  function handleFileChange(e) {
    const f = e.target.files[0];
    if (f) { setSelectedFile(f); setUploadError(''); }
  }

  async function handleUpload() {
    if (!selectedFile) { setUploadError('請先選取影片檔案'); return; }
    if (!courseId)      { setUploadError('請選擇課程'); return; }

    const fd = new FormData();
    fd.append('video', selectedFile);
    if (title.trim()) fd.append('title', title.trim());

    setUploading(true);
    setUploadError('');
    setProcStatus(null);
    setVideoId(null);

    try {
      const res = await fetch(`http://localhost:4000/api/v1/courses/${courseId}/videos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '上傳失敗');

      const v = data.data?.video || data.data || {};
      const vid = v._id || v.id || String(v._id || '');
      setVideoId(vid);
      setProcStatus('queued');
      if (vid) startPolling(vid);
    } catch (e) {
      setUploadError(e.message || '上傳失敗，請再試一次');
    } finally {
      setUploading(false);
    }
  }

  const uploadDone = videoId !== null;
  const steps = [
    ['01', '上傳影片',         '存入後端並啟動 AI 管道'],
    ['02', 'Whisper STT',     '語音轉逐字稿（背景非同步）'],
    ['03', 'LLM + Embedding', '切段 + 向量索引寫入 MongoDB'],
    ['04', 'Ready',           '學生可透過 Line Bot 提問'],
  ];
  // Map each step to a pipeline state
  const stepStates = uploadDone
    ? [pipelineStep(0, procStatus), pipelineStep(1, procStatus), pipelineStep(2, procStatus), pipelineStep(3, procStatus)]
    : ['active', 'idle', 'idle', 'idle'];

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Upload Video</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 900 }}>

        {/* Left: drop zone + pipeline */}
        <div>
          <div
            className="upload-z"
            style={{ minHeight: 220, cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} />
            <div style={{ color: '#F14F21' }}><Ic n="up" s={36} /></div>
            {selectedFile ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{selectedFile.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: drag ? '#fff' : 'rgba(255,255,255,0.7)' }}>拖曳影片至此</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>或點擊選取檔案</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>支援 MP4, MOV, MKV · 最大 500 MB</div>
              </>
            )}
          </div>

          <div className="card-sm" style={{ padding: '16px 18px', marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '.08em' }}>PROCESSING PIPELINE</div>
              {procStatus && (
                <span className={`badge ${STATUS_LABEL[procStatus]?.cls || 'bb'}`} style={{ fontSize: 10 }}>
                  {STATUS_LABEL[procStatus]?.text}
                </span>
              )}
            </div>
            {steps.map(([n, t, d], i) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <StepDot state={stepStates[i]} n={n} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: stepStates[i] === 'idle' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{t}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginLeft: 6 }}>{d}</span>
                </div>
                {stepStates[i] === 'active' && (
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F14F21', animation: 'pulse 1.2s infinite' }} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: form */}
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="ff-label">COURSE</label>
              <select className="ff-input" value={courseId} onChange={e => setCourseId(e.target.value)} disabled={uploading || uploadDone}>
                {courses.length === 0 && <option value="">載入課程中…</option>}
                {courses.map(c => <option key={c._id} value={c._id}>{c.title}</option>)}
              </select>
            </div>
            <div>
              <label className="ff-label">VIDEO TITLE（選填）</label>
              <input className="ff-input" placeholder="e.g. 第三講：邏輯迴歸" value={title} onChange={e => setTitle(e.target.value)} disabled={uploading || uploadDone} />
            </div>
          </div>

          {uploadError && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#ff6b6b', padding: '8px 12px', background: 'rgba(255,107,107,0.1)', borderRadius: 8, border: '1px solid rgba(255,107,107,0.2)' }}>
              {uploadError}
            </div>
          )}

          {!uploadDone ? (
            <button
              className="btn-primary"
              style={{ width: '100%', marginTop: 20, padding: '15px', opacity: uploading ? 0.7 : 1 }}
              onClick={handleUpload}
              disabled={uploading}
            >
              <Ic n="up" s={16} /> {uploading ? '上傳中…' : '開始上傳並建立 AI 索引'}
            </button>
          ) : (
            <button
              className="btn-primary"
              style={{ width: '100%', marginTop: 20, padding: '15px', background: 'rgba(255,255,255,0.08)', cursor: 'default' }}
              onClick={() => { setVideoId(null); setProcStatus(null); setSelectedFile(null); setTitle(''); setUploadError(''); }}
            >
              ＋ 再上傳一支影片
            </button>
          )}

          <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(241,79,33,0.08)', border: '1px solid rgba(241,79,33,0.18)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.8 }}>
              上傳完成後系統非同步執行索引建立<br />
              <span style={{ color: '#F14F21' }}>不阻塞 UX</span>，可繼續其他操作
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
