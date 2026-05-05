import { useState, useEffect, useRef, useCallback } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch, getToken } from '../api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
const ACTIVE_UPLOAD_KEY = 'focusflow_active_upload_video';

const STATUS_LABEL = {
  queued: { text: '排隊中', cls: 'bb', message: '已建立影片紀錄，等待 STT pipeline 開始。' },
  processing: { text: '處理中', cls: 'by', message: '正在進行 Whisper、切段與 embedding，這段可以切到其他頁面。' },
  completed: { text: '已完成', cls: 'bg', message: '索引已寫入資料庫，學生可以開始提問。' },
  failed: { text: '失敗', cls: 'br', message: '處理失敗，請查看 STT_Whisper/data/pipeline_<videoId>.log。' },
};

function pipelineStep(stepIndex, status, hasVideo) {
  if (!hasVideo) return stepIndex === 0 ? 'active' : 'idle';
  if (status === 'completed') return 'done';
  if (status === 'failed') return stepIndex === 0 ? 'done' : 'fail';
  if (status === 'processing') return stepIndex <= 1 ? 'done' : stepIndex === 2 ? 'active' : 'idle';
  if (status === 'queued') return stepIndex === 0 ? 'done' : stepIndex === 1 ? 'active' : 'idle';
  return stepIndex === 0 ? 'done' : 'idle';
}

function StepDot({ state, n }) {
  const colors = { done: '#22c55e', active: '#F14F21', fail: '#ef4444', idle: 'rgba(255,255,255,0.35)' };
  const bg = state === 'done'
    ? 'rgba(34,197,94,0.18)'
    : state === 'active'
      ? 'rgba(241,79,33,0.2)'
      : state === 'fail'
        ? 'rgba(239,68,68,0.18)'
        : 'rgba(255,255,255,0.08)';

  return (
    <div style={{ width: 22, height: 22, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: colors[state], flexShrink: 0, fontFamily: "'Space Grotesk',sans-serif" }}>
      {state === 'done' ? '✓' : n}
    </div>
  );
}

function readActiveUpload() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_UPLOAD_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeActiveUpload(payload) {
  localStorage.setItem(ACTIVE_UPLOAD_KEY, JSON.stringify(payload));
}

function clearActiveUpload() {
  localStorage.removeItem(ACTIVE_UPLOAD_KEY);
}

export default function TeacherUpload() {
  const [drag, setDrag] = useState(false);
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState('file');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [videoId, setVideoId] = useState(null);
  const [procStatus, setProcStatus] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const applyStatus = useCallback((vid, status, persist = true) => {
    setVideoId(vid);
    setProcStatus(status);
    setStatusMessage(STATUS_LABEL[status]?.message || '');

    if (persist && vid) {
      writeActiveUpload({
        videoId: vid,
        status,
        updatedAt: new Date().toISOString(),
      });
    }

    if (status === 'completed' || status === 'failed') {
      stopPolling();
      clearActiveUpload();
    }
  }, [stopPolling]);

  const pollProcessing = useCallback(async (vid) => {
    const res = await apiFetch(`/videos/${vid}/processing`);
    const status = res.data?.processing?.status || 'queued';
    applyStatus(vid, status);
  }, [applyStatus]);

  const startPolling = useCallback((vid) => {
    if (!vid) return;
    stopPolling();
    pollProcessing(vid).catch(() => {});
    pollRef.current = setInterval(() => {
      pollProcessing(vid).catch(() => {});
    }, 3000);
  }, [pollProcessing, stopPolling]);

  useEffect(() => {
    apiFetch('/courses')
      .then((res) => {
        const list = res.data?.courses || [];
        setCourses(list);
        if (list.length > 0) setCourseId(list[0]._id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const activeUpload = readActiveUpload();
    if (activeUpload?.videoId) {
      setVideoId(activeUpload.videoId);
      setProcStatus(activeUpload.status || 'queued');
      setStatusMessage('已恢復上一個上傳工作的進度追蹤。');
      startPolling(activeUpload.videoId);
    }

    return () => stopPolling();
  }, [startPolling, stopPolling]);

  function handleDrop(e) {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      setSelectedFile(file);
      setUploadError('');
    } else {
      setUploadError('請選擇影片檔案，支援 MP4、MOV、MKV。');
    }
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setUploadError('');
    }
  }

  async function handleUpload() {
    if (!courseId) {
      setUploadError('請先選擇課程。');
      return;
    }

    if (mode === 'file' && !selectedFile) {
      setUploadError('請先選擇影片檔案。');
      return;
    }

    if (mode === 'youtube' && !youtubeUrl.trim()) {
      setUploadError('請輸入 YouTube 影片網址。');
      return;
    }

    setUploading(true);
    setUploadError('');
    setProcStatus(null);
    setStatusMessage(mode === 'youtube' ? '正在註冊 YouTube 影片並啟動 STT。' : '正在上傳影片到後端。');
    setVideoId(null);

    try {
      let res;
      if (mode === 'youtube') {
        res = await fetch(`${API_BASE}/courses/${courseId}/videos/youtube`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            youtubeUrl: youtubeUrl.trim(),
            title: title.trim() || undefined,
          }),
        });
      } else {
        const fd = new FormData();
        fd.append('video', selectedFile);
        if (title.trim()) fd.append('title', title.trim());
        res = await fetch(`${API_BASE}/courses/${courseId}/videos`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
          body: fd,
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '上傳失敗');

      const video = data.data?.video || data.data || {};
      const vid = video._id || video.id || '';

      if (!vid) {
        throw new Error('上傳成功，但後端沒有回傳 videoId。');
      }

      applyStatus(vid, video.processing?.status || 'queued');
      startPolling(vid);
    } catch (error) {
      setUploadError(error.message || '上傳失敗，請稍後再試。');
      setStatusMessage('');
    } finally {
      setUploading(false);
    }
  }

  function resetForm() {
    stopPolling();
    clearActiveUpload();
    setVideoId(null);
    setProcStatus(null);
    setSelectedFile(null);
    setYoutubeUrl('');
    setTitle('');
    setUploadError('');
    setStatusMessage('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const uploadDone = Boolean(videoId);
  const steps = [
    ['01', '上傳影片', '存入後端並啟動 AI 管線'],
    ['02', '排隊等待', '背景工作已建立'],
    ['03', 'STT + Embedding', '轉字幕、切段並寫入向量資料庫'],
    ['04', 'Ready', '學生可透過課程頁或 Line Bot 提問'],
  ];
  const stepStates = steps.map((_, index) => pipelineStep(index, procStatus, uploadDone));
  const currentStatus = procStatus ? STATUS_LABEL[procStatus] : null;

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Upload Video</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 900 }}>
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => !uploading && !uploadDone && setMode('file')}
              disabled={uploading || uploadDone}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: mode === 'file' ? 'rgba(241,79,33,0.18)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${mode === 'file' ? 'rgba(241,79,33,0.5)' : 'rgba(255,255,255,0.1)'}`,
                color: mode === 'file' ? '#F14F21' : 'rgba(255,255,255,0.6)',
              }}
            >
              上傳檔案
            </button>
            <button
              type="button"
              onClick={() => !uploading && !uploadDone && setMode('youtube')}
              disabled={uploading || uploadDone}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: mode === 'youtube' ? 'rgba(241,79,33,0.18)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${mode === 'youtube' ? 'rgba(241,79,33,0.5)' : 'rgba(255,255,255,0.1)'}`,
                color: mode === 'youtube' ? '#F14F21' : 'rgba(255,255,255,0.6)',
              }}
            >
              YouTube 連結
            </button>
          </div>
          {mode === 'file' ? (
          <div
            className="upload-z"
            style={{ minHeight: 220, cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} />
            <div style={{ color: '#F14F21' }}><Ic n="up" s={36} /></div>
            {selectedFile ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedFile.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: drag ? '#fff' : 'rgba(255,255,255,0.7)' }}>拖曳影片至此</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>或點擊選取檔案</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>支援 MP4, MOV, MKV，最大 500 MB</div>
              </>
            )}
          </div>
          ) : (
          <div className="upload-z" style={{ minHeight: 220, cursor: 'default', flexDirection: 'column', gap: 12, padding: '20px 24px' }}>
            <div style={{ color: '#F14F21' }}><Ic n="up" s={36} /></div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>貼上 YouTube 影片網址</div>
            <input
              className="ff-input"
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              disabled={uploading || uploadDone}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>支援 youtube.com/watch、youtu.be、shorts</div>
          </div>
          )}

          <div className="card-sm" style={{ padding: '16px 18px', marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '.08em' }}>PROCESSING PIPELINE</div>
              {currentStatus && (
                <span className={`badge ${currentStatus.cls}`} style={{ fontSize: 10 }}>
                  {currentStatus.text}
                </span>
              )}
            </div>
            {steps.map(([n, label, description], index) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <StepDot state={stepStates[index]} n={n} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: stepStates[index] === 'idle' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.76)', fontWeight: 600 }}>{label}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginLeft: 6 }}>{description}</span>
                </div>
                {stepStates[index] === 'active' && (
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F14F21', animation: 'pulse 1.2s infinite' }} />
                )}
              </div>
            ))}
            {statusMessage && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.68)', lineHeight: 1.7 }}>
                {statusMessage}
              </div>
            )}
            {videoId && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.32)', wordBreak: 'break-all' }}>
                videoId: {videoId}
              </div>
            )}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="ff-label">COURSE</label>
              <select className="ff-input" value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={uploading || uploadDone}>
                {courses.length === 0 && <option value="">目前沒有可用課程</option>}
                {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
              </select>
            </div>
            <div>
              <label className="ff-label">VIDEO TITLE（選填）</label>
              <input className="ff-input" placeholder="e.g. 第三講：邏輯迴歸" value={title} onChange={(e) => setTitle(e.target.value)} disabled={uploading || uploadDone} />
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
              <Ic n="up" s={16} /> {uploading ? '上傳中...' : '開始上傳並建立 AI 索引'}
            </button>
          ) : (
            <button
              className="btn-primary"
              style={{ width: '100%', marginTop: 20, padding: '15px', background: 'rgba(255,255,255,0.08)' }}
              onClick={resetForm}
            >
              上傳另一支影片
            </button>
          )}

          <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(241,79,33,0.08)', border: '1px solid rgba(241,79,33,0.18)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.8 }}>
              上傳完成後系統會在背景建立索引。<br />
              <span style={{ color: '#F14F21' }}>可切換頁面或繼續操作</span>，回到此頁會恢復追蹤最後一個上傳工作。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
