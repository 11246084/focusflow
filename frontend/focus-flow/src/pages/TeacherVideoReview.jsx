import { useState } from 'react';
import { Ic } from '../components/Icons';
import StepIndicator from '../components/StepIndicator';
import { submitVideoReview } from '../services/videoReview';
import { REJECTION_REASONS } from '../constants/videoReviewReasons';

const SAMPLE_VIDEO = {
  id: 'sample-short-001',
  title: '範例短影片：AI 生成教學片段',
  src: '/demo-videos/sv-test-01.mp4',
};

const STEP_LABELS = ['審核影片', '確認送出', '完成'];

const initialReasonState = Object.fromEntries(
  REJECTION_REASONS.map((r) => [r.code, { checked: false, note: '' }]),
);

export default function TeacherVideoReview() {
  const [step, setStep] = useState(1); // 1: review, 2: confirm, 3: done
  const [pendingAction, setPendingAction] = useState(null); // 'approved' | 'rejected'
  const [finalStatus, setFinalStatus] = useState(null); // 'approved' | 'rejected', set once submit succeeds
  const [showReasonPanel, setShowReasonPanel] = useState(false);
  const [reasonState, setReasonState] = useState(initialReasonState);
  const [showValidationError, setShowValidationError] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function toggleReason(code) {
    setReasonState((current) => ({
      ...current,
      [code]: { ...current[code], checked: !current[code].checked },
    }));
  }

  function updateNote(code, note) {
    setReasonState((current) => ({
      ...current,
      [code]: { ...current[code], note },
    }));
  }

  function handleApproveClick() {
    setPendingAction('approved');
    setShowValidationError(false);
    setValidationMessage('');
    setStep(2);
  }

  function handleRejectClick() {
    setShowReasonPanel(true);
    setShowValidationError(false);
    setValidationMessage('');
  }

  function handleRejectContinue() {
    const checkedEntries = Object.entries(reasonState).filter(([, v]) => v.checked);

    if (!checkedEntries.length) {
      setShowValidationError(true);
      setValidationMessage('請至少勾選一項不通過理由。');
      return;
    }
    const otherEntry = checkedEntries.find(([code]) => code === 'other');
    if (otherEntry && !otherEntry[1].note.trim()) {
      setShowValidationError(true);
      setValidationMessage('已勾選「其他」，請填寫必填說明。');
      return;
    }

    setShowValidationError(false);
    setValidationMessage('');
    setPendingAction('rejected');
    setStep(2);
  }

  async function handleConfirmSubmit() {
    setSubmitting(true);
    try {
      if (pendingAction === 'approved') {
        await submitVideoReview({ videoId: SAMPLE_VIDEO.id, status: 'approved' });
      } else {
        const checkedEntries = Object.entries(reasonState).filter(([, v]) => v.checked);
        const payload = {
          videoId: SAMPLE_VIDEO.id,
          status: 'rejected',
          reasons: checkedEntries.map(([code, { note }]) => ({ code, note: note.trim() })),
        };
        // TODO: 等後端 API 完成後，submitVideoReview 內部會改成真正呼叫後端；
        // 目前僅 console.log 輸出 payload，不會送出真實請求。
        await submitVideoReview(payload);
      }
      setFinalStatus(pendingAction);
      setStep(3);
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setStep(1);
    setPendingAction(null);
    setFinalStatus(null);
    setShowReasonPanel(false);
    setReasonState(initialReasonState);
    setShowValidationError(false);
    setValidationMessage('');
  }

  const checkedReasons = REJECTION_REASONS.filter((r) => reasonState[r.code].checked);

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%', overflowX: 'hidden' }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 20 }}>
        短影片審核頁
      </div>

      <StepIndicator steps={STEP_LABELS} currentStep={step} />

      {/* ── Step 1: review ── */}
      {step === 1 && (
        <div
          className="ff-grid-2"
          style={{
            display: 'grid',
            gridTemplateColumns: showReasonPanel ? '0.95fr 1.05fr' : '1fr',
            gap: 24,
            width: '100%',
            maxWidth: '98%',
          }}
        >
          <div className="card-sm video-review-card" style={{ padding: '16px 18px', width: '100%' }}>
            <label className="ff-label">SAMPLE VIDEO</label>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 12 }}>{SAMPLE_VIDEO.title}</div>

            <div className="review-btn-row" style={{ marginBottom: 16 }}>
              <button className="btn-primary" onClick={handleApproveClick} disabled={submitting}>
                通過
              </button>
              <button className="btn-outline btn-outline-danger" onClick={handleRejectClick} disabled={submitting}>
                不通過
              </button>
            </div>

            <video controls className="video-review-video" src={SAMPLE_VIDEO.src}>
              您的瀏覽器不支援影片播放。
            </video>
          </div>

          {showReasonPanel && (
            <div className="video-review-right card-sm video-review-card" style={{ padding: '16px 18px', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '.08em' }}>REJECTION REASONS</div>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>可複選，點擊展開填寫說明</span>
              </div>

              <div className="reject-reason-list">
                {REJECTION_REASONS.map(({ code, label, placeholder, required }) => {
                  const { checked, note } = reasonState[code];
                  return (
                    <div key={code} className={`reject-reason-item${checked ? ' is-expanded' : ''}`}>
                      <label className="reject-reason-checkbox">
                        <input type="checkbox" checked={checked} onChange={() => toggleReason(code)} />
                        <span>{label}</span>
                        {required ? <span className="required-mark">*</span> : <span className="optional-mark">選填</span>}
                      </label>
                      <div className={`reject-reason-note-wrap${checked ? ' is-open' : ''}`}>
                        <div className="reject-reason-note-inner">
                          <div className="reject-reason-note">
                            <textarea
                              value={note}
                              onChange={(e) => updateNote(code, e.target.value)}
                              placeholder={placeholder}
                              rows={2}
                            />
                            {required && !note.trim() && showValidationError && (
                              <p className="reject-reason-error">此欄位為必填</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {showValidationError && validationMessage && (
                <div style={{ fontSize: 12, color: '#ff6b6b', padding: '8px 12px', background: 'rgba(255,107,107,0.1)', borderRadius: 8, border: '1px solid rgba(255,107,107,0.2)', margin: '10px 0' }}>
                  {validationMessage}
                </div>
              )}

              <div className="review-btn-row" style={{ marginTop: 12 }}>
                <button className="btn-primary" onClick={handleRejectContinue} disabled={submitting}>
                  下一步：確認理由
                </button>
                <button
                  className="btn-outline"
                  onClick={() => { setShowReasonPanel(false); setShowValidationError(false); setValidationMessage(''); }}
                  disabled={submitting}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: confirm ── */}
      {step === 2 && (
        <div className="card-sm video-review-card" style={{ padding: '16px 18px', width: '100%', maxWidth: '98%' }}>
          <label className="ff-label">CONFIRM</label>

          {pendingAction === 'approved' ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginTop: 8, marginBottom: 6 }}>即將標示本影片為通過</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                確認後將標示「{SAMPLE_VIDEO.title}」為審核通過。
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginTop: 8, marginBottom: 12 }}>請確認以下不通過理由</div>
              <div className="reject-reason-list">
                {checkedReasons.map((r) => (
                  <div key={r.code} className="reject-reason-item is-expanded">
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{r.label}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
                      {reasonState[r.code].note.trim() || '（未填寫說明）'}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="review-btn-row" style={{ marginTop: 20 }}>
            <button className="btn-primary" onClick={handleConfirmSubmit} disabled={submitting}>
              {submitting ? '送出中…' : '確認送出'}
            </button>
            <button className="btn-outline" onClick={() => setStep(1)} disabled={submitting}>
              返回修改
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: done ── */}
      {step === 3 && (
        <div className="card-sm video-review-card" style={{ padding: '28px 18px', width: '100%', maxWidth: '98%', textAlign: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: '#F14F21',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px',
            }}
          >
            <Ic n="check" s={22} c="#fff" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 6 }}>已送出審核結果</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 20 }}>
            {finalStatus === 'approved' ? '本影片已標示為通過。' : '本影片已標示為不通過，理由已記錄。'}
          </div>
          <button className="btn-primary" onClick={handleReset}>
            審核下一支影片
          </button>
        </div>
      )}
    </div>
  );
}
