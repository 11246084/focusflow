import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useModalDialog from '../hooks/useModalDialog';
import { apiFetch, buildApiError } from '../api';

const FEEDBACK_FORM_URL = 'https://forms.gle/QyQN4ZaHyCc8KnVu9';
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const CATEGORY_OPTIONS = [
  { value: 'login_account', label: '登入／帳號' },
  { value: 'course_video', label: '課程或影片' },
  { value: 'ai_qa', label: 'AI 問答' },
  { value: 'line_bot', label: 'LINE Bot' },
  { value: 'shorts', label: '教學短片' },
  { value: 'ui_operation', label: '畫面操作' },
  { value: 'other', label: '其他' },
];
const SEVERITY_OPTIONS = [
  { value: 'blocking', label: '完全無法繼續使用' },
  { value: 'partial', label: '部分功能有問題，但仍可繼續使用' },
  { value: 'minor', label: '不影響使用，屬於小問題或建議' },
];
// 這兩個類型的問題幾乎都跟特定課程／影片有關，記下名稱可以省去 admin 事後猜測。
const CATEGORIES_WITH_COURSE_CONTEXT = new Set(['course_video', 'ai_qa']);

function ChatIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6.5A7 7 0 0 1 3 11V8a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FeedbackIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="9" y="3" width="6" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function IssueReportDialog({ onClose }) {
  const descriptionRef = useRef(null);
  const dialogRef = useModalDialog(onClose, { initialFocusRef: descriptionRef });
  const fileInputRef = useRef(null);

  const [category, setCategory] = useState(CATEGORY_OPTIONS[0].value);
  const [severity, setSeverity] = useState('');
  const [description, setDescription] = useState('');
  const [courseVideoName, setCourseVideoName] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | submitting | success
  const [error, setError] = useState('');
  const severityRef = useRef(null);
  const showCourseContext = CATEGORIES_WITH_COURSE_CONTEXT.has(category);

  const handleFilesSelected = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    setError('');
    setAttachments((prev) => {
      const next = [...prev];
      for (const file of files) {
        if (next.length >= MAX_ATTACHMENTS) {
          setError(`最多只能上傳 ${MAX_ATTACHMENTS} 張圖片。`);
          break;
        }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          setError('只接受 JPEG、PNG 或 WebP 圖片。');
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setError('單張圖片大小不能超過 10 MB。');
          continue;
        }
        next.push(file);
      }
      return next;
    });
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = description.trim();
    if (!trimmed) {
      setError('請描述你遇到的問題。');
      descriptionRef.current?.focus();
      return;
    }
    if (!severity) {
      setError('請選擇對使用的影響程度。');
      severityRef.current?.focus();
      return;
    }

    setStatus('submitting');
    setError('');

    try {
      const formData = new FormData();
      formData.append('category', category);
      formData.append('severity', severity);
      formData.append('description', trimmed);
      formData.append('pageContext', window.location.pathname);
      if (showCourseContext && courseVideoName.trim()) formData.append('courseVideoName', courseVideoName.trim());
      for (const file of attachments) {
        formData.append('attachments', file);
      }
      await apiFetch('/feedback', { method: 'POST', body: formData });
      setStatus('success');
    } catch (err) {
      setStatus('idle');
      setError(err.message || buildApiError({ status: 0 }).message);
    }
  };

  if (status === 'success') {
    return (
      <div className="issue-report-overlay" role="presentation" onMouseDown={onClose}>
        <section
          ref={dialogRef}
          className="issue-report-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="issue-report-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" className="issue-report-close" aria-label="關閉問題回報視窗" onClick={onClose}>×</button>
          <div className="issue-report-icon" aria-hidden="true"><CheckIcon /></div>
          <h2 id="issue-report-title">已收到你的回報</h2>
          <p>謝謝你協助改善 FocusFlow，我們會盡快處理。</p>
          <div className="issue-report-actions">
            <button type="button" className="btn-primary" onClick={onClose}>關閉</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="issue-report-overlay" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="issue-report-dialog issue-report-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-report-title"
        aria-describedby="issue-report-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="issue-report-close" aria-label="關閉問題回報視窗" onClick={onClose}>×</button>

        <div className="issue-report-icon" aria-hidden="true">
          <ChatIcon size={24} />
        </div>
        <h2 id="issue-report-title">回報問題</h2>
        <p id="issue-report-description">
          告訴我們哪裡卡住了，可以附上截圖。送出後管理員會在後台看到你的回報。
        </p>

        <form onSubmit={handleSubmit} className="issue-report-form">
          <label className="issue-report-field">
            <span>回報類型</span>
            <select className="ff-input" value={category} onChange={(e) => setCategory(e.target.value)} disabled={status === 'submitting'}>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="issue-report-field">
            <span>對你使用的影響程度</span>
            <select
              ref={severityRef}
              className="ff-input"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              disabled={status === 'submitting'}
            >
              <option value="" disabled>請選擇……</option>
              {SEVERITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {showCourseContext && (
            <label className="issue-report-field">
              <span>課程名稱／影片名稱（選填）</span>
              <input
                type="text"
                className="ff-input"
                maxLength={200}
                placeholder="例如：AI 入門基礎課 / 第三講 影片處理工具"
                value={courseVideoName}
                onChange={(e) => setCourseVideoName(e.target.value)}
                disabled={status === 'submitting'}
              />
            </label>
          )}

          <label className="issue-report-field">
            <span>問題描述</span>
            <textarea
              ref={descriptionRef}
              className="ff-input"
              rows={4}
              maxLength={2000}
              placeholder="請描述發生的狀況，例如：在哪個頁面、做了什麼操作、看到什麼錯誤訊息……"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={status === 'submitting'}
            />
          </label>

          <label className="issue-report-field">
            <span>附上截圖（選填，最多 {MAX_ATTACHMENTS} 張，JPEG／PNG／WebP，單張 10 MB 內）</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              multiple
              onChange={handleFilesSelected}
              disabled={status === 'submitting' || attachments.length >= MAX_ATTACHMENTS}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="issue-report-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={status === 'submitting' || attachments.length >= MAX_ATTACHMENTS}
            >
              選擇圖片 / 拍照
            </button>
          </label>

          {attachments.length > 0 && (
            <ul className="issue-report-attachment-list">
              {attachments.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <span>{file.name}</span>
                  <span className="issue-report-attachment-size">{formatBytes(file.size)}</span>
                  <button type="button" onClick={() => removeAttachment(index)} disabled={status === 'submitting'} aria-label={`移除 ${file.name}`}>×</button>
                </li>
              ))}
            </ul>
          )}

          {error && <div className="issue-report-error">{error}</div>}

          <div className="issue-report-actions">
            <button type="button" className="btn-outline" onClick={onClose} disabled={status === 'submitting'}>
              取消
            </button>
            <button type="submit" className="btn-primary issue-report-primary" disabled={status === 'submitting'}>
              {status === 'submitting' ? '送出中...' : '送出回報'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function IssueReportLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="fab-group">
        <a
          className="fab-feedback"
          href={FEEDBACK_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FeedbackIcon />
          <span>意見回饋</span>
        </a>
        <button
          type="button"
          className="issue-report-launcher"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <ChatIcon />
          <span>回報問題</span>
        </button>
      </div>

      {open && createPortal(
        <IssueReportDialog onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}
