import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useModalDialog from '../hooks/useModalDialog';

const ISSUE_REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSef66soFCDdGOUKAHJjeuGitefI4aSKdHfBu-PLSYxTMaFp0Q/viewform';

function ChatIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6.5A7 7 0 0 1 3 11V8a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IssueReportDialog({ onClose }) {
  const primaryActionRef = useRef(null);
  const dialogRef = useModalDialog(onClose, { initialFocusRef: primaryActionRef });

  return (
    <div className="issue-report-overlay" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="issue-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-report-title"
        aria-describedby="issue-report-description issue-report-note"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="issue-report-close" aria-label="關閉問題回報視窗" onClick={onClose}>
          ×
        </button>

        <div className="issue-report-icon" aria-hidden="true">
          <ChatIcon size={24} />
        </div>
        <h2 id="issue-report-title">遇到問題嗎？</h2>
        <p id="issue-report-description">
          告訴我們哪裡卡住了，你的回報會協助團隊改善 FocusFlow。
        </p>
        <p id="issue-report-note" className="issue-report-note">
          表單會在新分頁開啟；若要上傳截圖，需要先登入 Google 帳戶。
        </p>

        <div className="issue-report-actions">
          <button type="button" className="btn-outline" onClick={onClose}>
            稍後再說
          </button>
          <a
            ref={primaryActionRef}
            className="btn-primary issue-report-primary"
            href={ISSUE_REPORT_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
          >
            前往問題回報
            <ExternalLinkIcon />
          </a>
        </div>
      </section>
    </div>
  );
}

export default function IssueReportLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
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

      {open && createPortal(
        <IssueReportDialog onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}
