import { useCallback, useEffect, useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';
import { uploadCourseVideos } from '../services/videoUpload';
import {
  fileKey,
  formatFileSize,
  isTerminalStatus,
  mergeSelectedFiles,
  titleFromFilename,
} from './teacherUploadUtils';

const ACTIVE_UPLOAD_KEY = 'focusflow_active_upload_videos';
const TRACKING_QUERY_KEY = 'uploadVideos';

const STATUS_LABEL = {
  queued: { text: '排隊中', cls: 'bb', message: '已建立影片紀錄，等待 STT pipeline 開始。' },
  running: { text: '處理中', cls: 'by', message: '正在進行 Whisper、切段與 embedding。' },
  processing: { text: '處理中', cls: 'by', message: '正在進行 Whisper、切段與 embedding。' },
  retrying: { text: '重新嘗試中', cls: 'by', message: '正在從既有 checkpoint 重新嘗試。' },
  completed: { text: '處理完成', cls: 'bg', message: '索引已寫入資料庫。' },
  failed: { text: '處理失敗', cls: 'br', message: '處理失敗，請稍後重試或聯絡管理員。' },
  skipped: { text: '已略過', cls: 'bb', message: '此影片已略過。' },
};

function pipelineStep(stepIndex, items, uploading) {
  if (!items.length) return stepIndex === 0 ? 'active' : 'idle';
  const statuses = items.map((item) => item.processingStatus);
  const failed = statuses.some((status) => status === 'failed');
  const allDone = statuses.every((status) => isTerminalStatus(status));
  if (stepIndex === 0) return uploading ? 'active' : 'done';
  if (stepIndex === 1) return uploading ? 'idle' : statuses.some((status) => status === 'queued') ? 'active' : 'done';
  if (stepIndex === 2) {
    if (statuses.some((status) => status === 'processing' || status === 'running' || status === 'retrying')) return 'active';
    if (failed && allDone) return 'fail';
    return allDone ? 'done' : 'idle';
  }
  if (allDone) return failed ? 'fail' : 'done';
  return 'idle';
}

function StepDot({ state, n }) {
  const colors = { done: '#22c55e', active: '#F14F21', fail: '#ef4444', idle: 'rgba(255,255,255,0.35)' };
  const bg = state === 'done' ? 'rgba(34,197,94,0.18)' : state === 'active' ? 'rgba(241,79,33,0.2)' : state === 'fail' ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.08)';
  return (
    <div style={{ width: 22, height: 22, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: colors[state], flexShrink: 0, fontFamily: "'Space Grotesk',sans-serif" }}>
      {state === 'done' ? '✓' : n}
    </div>
  );
}

function readTracking() {
  try {
    const stored = JSON.parse(localStorage.getItem(ACTIVE_UPLOAD_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function trackingIdsFromUrl() {
  return new URLSearchParams(window.location.search).get(TRACKING_QUERY_KEY)?.split(',').filter(Boolean) || [];
}

function readInitialTracking() {
  const stored = readTracking();
  const ids = trackingIdsFromUrl();
  return ids.length
    ? ids.map((videoId) => stored.find((item) => item.videoId === videoId) || { videoId, name: `影片 ${videoId.slice(-6)}`, processingStatus: 'queued' })
    : stored;
}

function persistTracking(items) {
  const safeItems = items.filter((item) => item.videoId).map(({ videoId, name, processingStatus }) => ({ videoId, name, processingStatus }));
  localStorage.setItem(ACTIVE_UPLOAD_KEY, JSON.stringify(safeItems));
  const url = new URL(window.location.href);
  if (safeItems.length) url.searchParams.set(TRACKING_QUERY_KEY, safeItems.map((item) => item.videoId).join(','));
  else url.searchParams.delete(TRACKING_QUERY_KEY);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function TeacherUpload() {
  const [drag, setDrag] = useState(false);
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [trackedItems, setTrackedItems] = useState(readInitialTracking);
  const initialTrackingRef = useRef(trackedItems);
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const pollProcessing = useCallback(async () => {
    const snapshot = readTracking();
    const pending = snapshot.filter((item) => !isTerminalStatus(item.processingStatus));
    if (!pending.length) {
      stopPolling();
      return;
    }
    const updates = await Promise.all(pending.map(async (item) => {
      try {
        const response = await apiFetch(`/videos/${item.videoId}/processing`);
        return { ...item, processingStatus: response.data?.processing?.status || response.data?.status || 'queued' };
      } catch {
        return item;
      }
    }));
    const byId = new Map(updates.map((item) => [item.videoId, item]));
    setTrackedItems((current) => {
      const next = current.map((item) => byId.get(item.videoId) || item);
      persistTracking(next);
      if (next.every((item) => isTerminalStatus(item.processingStatus))) stopPolling();
      return next;
    });
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    void pollProcessing();
    pollRef.current = setInterval(() => void pollProcessing(), 3000);
  }, [pollProcessing, stopPolling]);

  useEffect(() => {
    apiFetch('/courses').then((response) => {
      const list = response.data?.courses || [];
      setCourses(list);
      if (list.length) setCourseId(list[0]._id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const restored = initialTrackingRef.current;
    let restartTimer = null;
    if (restored.length) {
      persistTracking(restored);
      if (restored.some((item) => !isTerminalStatus(item.processingStatus))) {
        restartTimer = window.setTimeout(startPolling, 0);
      }
    }
    return () => {
      if (restartTimer) window.clearTimeout(restartTimer);
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  function addFiles(files) {
    const result = mergeSelectedFiles(selectedFiles, files);
    setSelectedFiles(result.files);
    setUploadError(result.errors.join(' '));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleDrop(event) {
    event.preventDefault();
    setDrag(false);
    addFiles(event.dataTransfer.files);
  }

  function removeFile(event, key) {
    event.stopPropagation();
    setSelectedFiles((files) => files.filter((file) => fileKey(file) !== key));
  }

  const updateTrackedItem = useCallback((key, changes) => {
    setTrackedItems((current) => current.map((item) => item.key === key ? { ...item, ...changes } : item));
  }, []);

  async function handleUpload() {
    if (uploading) return;
    if (!courseId) return setUploadError('請先選擇課程。');
    if (!selectedFiles.length) return setUploadError('請先選擇至少一支影片。');

    const multiple = selectedFiles.length > 1;
    const items = selectedFiles.map((file) => ({
      key: fileKey(file),
      file,
      name: file.name,
      title: multiple ? titleFromFilename(file.name) : title.trim(),
      uploadStatus: 'queued',
      processingStatus: null,
      videoId: '',
      error: '',
    }));
    setUploading(true);
    setUploadError('');
    setTrackedItems(items);
    const uploaded = await uploadCourseVideos({ courseId, items, onItemChange: updateTrackedItem });
    setTrackedItems((current) => {
      const next = current.map((item) => uploaded.find((result) => result.key === item.key) ? { ...item, ...uploaded.find((result) => result.key === item.key), uploadStatus: 'processing' } : item);
      persistTracking(next);
      return next;
    });
    setUploading(false);
    setSelectedFiles([]);
    setTitle('');
    if (uploaded.length) startPolling();
  }

  function resetTracking() {
    stopPolling();
    setTrackedItems([]);
    persistTracking([]);
    setUploadError('');
  }

  const isMultiple = selectedFiles.length > 1;
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const completedCount = trackedItems.filter((item) => item.processingStatus === 'completed').length;
  const failedCount = trackedItems.filter((item) => item.processingStatus === 'failed').length;
  const queuedCount = trackedItems.filter((item) => item.processingStatus === 'queued').length;
  const activeItem = trackedItems.find((item) => ['processing', 'running', 'retrying'].includes(item.processingStatus));
  const allTerminal = trackedItems.length > 0 && trackedItems.every((item) => isTerminalStatus(item.processingStatus));
  const currentStatus = allTerminal ? (failedCount ? (completedCount ? { text: '部分完成', cls: 'by' } : STATUS_LABEL.failed) : STATUS_LABEL.completed) : trackedItems.length ? STATUS_LABEL.processing : null;
  const stepDescriptions = trackedItems.length > 1 ? [
    `${trackedItems.filter((item) => item.videoId).length} / ${trackedItems.length} 已上傳`,
    `${activeItem ? 1 : 0} 支處理中，${queuedCount} 支排隊中`,
    activeItem ? `目前處理：${activeItem.name}` : '等待或已完成處理',
    `${completedCount} / ${trackedItems.length} 已完成`,
  ] : ['存入後端並啟動 AI 管線', '背景工作已建立', '轉字幕、切段並寫入向量資料庫', '學生可透過課程頁或 Line Bot 提問'];
  const steps = [['01', '上傳影片'], ['02', '排隊等待'], ['03', 'STT + Embedding'], ['04', 'Ready']];
  const stepStates = steps.map((_, index) => pipelineStep(index, trackedItems, uploading));

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Upload Video</div>
      <div className="ff-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: '90%' }}>
        <div>
          <div className="upload-z" style={{ height: 220, minHeight: 220, cursor: 'pointer', opacity: uploading ? 0.6 : 1, padding: 14 }} onDragOver={(event) => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={handleDrop} onClick={() => !uploading && fileInputRef.current?.click()}>
            <input ref={fileInputRef} type="file" multiple accept=".mp4,.mov,.mkv,video/mp4,video/quicktime,video/x-matroska" style={{ display: 'none' }} onChange={(event) => addFiles(event.target.files)} />
            {selectedFiles.length ? (
              <>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 13, color: '#fff' }}>已選擇 {selectedFiles.length} 支影片</strong>
                  <span style={{ fontSize: 11, color: '#F14F21' }}>繼續新增影片</span>
                </div>
                <div style={{ width: '100%', flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
                  {selectedFiles.map((file) => (
                    <div key={fileKey(file)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', marginBottom: 6, borderRadius: 9, background: 'rgba(255,255,255,0.05)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)' }}>{formatFileSize(file.size)}</div>
                      </div>
                      <button type="button" aria-label={`移除 ${file.name}`} onClick={(event) => removeFile(event, fileKey(file))} disabled={uploading} style={{ border: 0, background: 'transparent', color: '#ff8b72', cursor: 'pointer', fontSize: 16 }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>總大小：{formatFileSize(totalSize)}</div>
              </>
            ) : (
              <>
                <div style={{ color: '#F14F21' }}><Ic n="up" s={36} /></div>
                <div style={{ fontSize: 15, fontWeight: 600, color: drag ? '#fff' : 'rgba(255,255,255,0.7)' }}>拖曳影片至此</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>或點擊選擇檔案</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)' }}>支援單支或多支影片上傳</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>支援 MP4、MOV、MKV，單支最大 500 MB</div>
              </>
            )}
          </div>

          <div className="card-sm" style={{ padding: '16px 18px', marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '.08em' }}>PROCESSING PIPELINE</div>
              {currentStatus && <span className={`badge ${currentStatus.cls}`} style={{ fontSize: 10 }}>{currentStatus.text}</span>}
            </div>
            {steps.map(([n, label], index) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <StepDot state={stepStates[index]} n={n} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: stepStates[index] === 'idle' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.76)', fontWeight: 600 }}>{label}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginLeft: 6 }}>{stepDescriptions[index]}</span>
                </div>
              </div>
            ))}
            {allTerminal && <div style={{ marginTop: 10, fontSize: 12, color: failedCount ? '#ffb080' : '#86efac' }}>{failedCount ? `${completedCount} 支完成，${failedCount} 支失敗` : `${completedCount} 支影片皆已完成 AI 索引`}</div>}
            {trackedItems.map((item) => item.error ? <div key={item.key || item.videoId} style={{ marginTop: 6, fontSize: 11, color: '#ff8b72' }}>{item.name}：{item.error}</div> : null)}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="ff-label">COURSE</label>
              <select className="ff-input" value={courseId} onChange={(event) => setCourseId(event.target.value)} disabled={uploading}>
                {!courses.length && <option value="">目前沒有可用課程</option>}
                {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
              </select>
            </div>
            {!isMultiple && (
              <div>
                <label className="ff-label">VIDEO TITLE（選填）</label>
                <input className="ff-input" placeholder="e.g. 第三講：邏輯迴歸" value={title} onChange={(event) => setTitle(event.target.value)} disabled={uploading} />
              </div>
            )}
            {isMultiple && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>多支模式將以各影片檔名作為標題，Course 套用至全部影片。</div>}
          </div>

          {uploadError && <div style={{ marginTop: 12, fontSize: 12, color: '#ff6b6b', padding: '8px 12px', background: 'rgba(255,107,107,0.1)', borderRadius: 8, border: '1px solid rgba(255,107,107,0.2)' }}>{uploadError}</div>}

          <button className="btn-primary" style={{ width: '100%', marginTop: 20, padding: 15, opacity: uploading || !selectedFiles.length ? 0.7 : 1 }} onClick={handleUpload} disabled={uploading || !selectedFiles.length}>
            <Ic n="up" s={16} /> {uploading ? '正在上傳檔案...' : selectedFiles.length > 1 ? `上傳 ${selectedFiles.length} 支影片並建立 AI 索引` : '上傳影片並建立 AI 索引'}
          </button>

          {trackedItems.length > 0 && <button type="button" onClick={resetTracking} style={{ marginTop: 8, width: '100%', background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>清除目前追蹤狀態</button>}

          <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(241,79,33,0.08)', border: '1px solid rgba(241,79,33,0.18)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.8 }}>
              上傳後系統自動完成 STT 轉字幕、切段與向量索引。<br />
              <span style={{ color: '#F14F21' }}>可切換頁面或繼續操作</span>，回到此頁會由 URL 恢復目前追蹤工作。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
