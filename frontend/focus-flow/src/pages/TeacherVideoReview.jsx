import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import StepIndicator from '../components/StepIndicator';
import {
  canSubmitReview,
  getReviewErrorMessage,
  getShortAsset,
  listShortAssets,
  shouldReloadAfterReviewError,
  submitReviewAndReadback,
  validateRejectionReasons,
} from '../services/videoReview';
import { REJECTION_REASONS } from '../constants/videoReviewReasons';

const STEP_LABELS = ['審核短影片', '確認送出', '完成'];

const initialReasonState = Object.fromEntries(
  REJECTION_REASONS.map((reason) => [reason.code, { checked: false, note: '' }]),
);

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-TW');
}

export default function TeacherVideoReview() {
  const [items, setItems] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [step, setStep] = useState(1);
  const [pendingAction, setPendingAction] = useState(null);
  const [finalStatus, setFinalStatus] = useState(null);
  const [showReasonPanel, setShowReasonPanel] = useState(false);
  const [reasonState, setReasonState] = useState(initialReasonState);
  const [validationMessage, setValidationMessage] = useState('');
  const [operationError, setOperationError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewPersistedAwaitingReadback, setReviewPersistedAwaitingReadback] = useState(false);

  const resetReviewForm = useCallback(() => {
    setStep(1);
    setPendingAction(null);
    setFinalStatus(null);
    setShowReasonPanel(false);
    setReasonState(initialReasonState);
    setValidationMessage('');
    setOperationError('');
    setReviewPersistedAwaitingReadback(false);
  }, []);

  const loadAsset = useCallback(async (shortAssetId, { preserveDraft = false } = {}) => {
    setLoadingDetail(true);
    setOperationError('');
    if (!preserveDraft) {
      setSelectedAsset(null);
      resetReviewForm();
    }
    try {
      const asset = await getShortAsset(shortAssetId);
      setSelectedAsset(asset);
      setReviewPersistedAwaitingReadback(false);
      return asset;
    } catch (error) {
      setOperationError(getReviewErrorMessage(error));
      if (error.code === 'SHORT_ASSET_NOT_FOUND') setSelectedAsset(null);
      return null;
    } finally {
      setLoadingDetail(false);
    }
  }, [resetReviewForm]);

  const loadQueue = useCallback(async () => {
    setLoadingList(true);
    setOperationError('');
    try {
      const data = await listShortAssets({ reviewStatus: 'pending', limit: 50 });
      const nextItems = data?.items || [];
      setItems(nextItems);
      if (nextItems.length) {
        await loadAsset(nextItems[0].id);
      } else {
        setSelectedAsset(null);
        resetReviewForm();
      }
    } catch (error) {
      setItems([]);
      setSelectedAsset(null);
      setOperationError(getReviewErrorMessage(error));
    } finally {
      setLoadingList(false);
    }
  }, [loadAsset, resetReviewForm]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  function selectedReasons() {
    return REJECTION_REASONS
      .filter(({ code }) => reasonState[code].checked)
      .map(({ code }) => ({ code, note: reasonState[code].note.trim() }));
  }

  function toggleReason(code) {
    setReasonState((current) => ({
      ...current,
      [code]: { ...current[code], checked: !current[code].checked },
    }));
    setValidationMessage('');
    setOperationError('');
  }

  function updateNote(code, note) {
    setReasonState((current) => ({
      ...current,
      [code]: { ...current[code], note },
    }));
    setValidationMessage('');
    setOperationError('');
  }

  function handleApproveClick() {
    setPendingAction('approved');
    setValidationMessage('');
    setOperationError('');
    setStep(2);
  }

  function handleRejectClick() {
    setShowReasonPanel(true);
    setValidationMessage('');
    setOperationError('');
  }

  function handleRejectContinue() {
    const message = validateRejectionReasons(selectedReasons());
    if (message) {
      setValidationMessage(message);
      return;
    }
    setValidationMessage('');
    setOperationError('');
    setPendingAction('rejected');
    setStep(2);
  }

  async function handleConfirmSubmit() {
    if (!selectedAsset || submitting || reviewPersistedAwaitingReadback) return;
    const review = {
      shortAssetId: selectedAsset.id,
      status: pendingAction,
      expectedGenerationVersion: selectedAsset.generationVersion,
      ...(pendingAction === 'rejected' ? { reasons: selectedReasons() } : {}),
    };

    setSubmitting(true);
    setOperationError('');
    try {
      const latestAsset = await submitReviewAndReadback(review);
      setSelectedAsset(latestAsset);
      setReviewPersistedAwaitingReadback(false);
      setFinalStatus(latestAsset.reviewStatus);
      setStep(3);
    } catch (error) {
      if (error.latestAsset) setSelectedAsset(error.latestAsset);
      setOperationError(getReviewErrorMessage(error));
      if (error.reviewPersisted) {
        setReviewPersistedAwaitingReadback(true);
        setStep(1);
      } else if (shouldReloadAfterReviewError(error) || error.code === 'VALIDATION_ERROR') {
        setStep(1);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const checkedReasons = REJECTION_REASONS.filter(({ code }) => reasonState[code].checked);
  const isReviewable = selectedAsset?.reviewStatus === 'pending';
  const reviewActionsEnabled = canSubmitReview({
    isReviewable,
    submitting,
    reviewPersistedAwaitingReadback,
  });

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%', overflowX: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>
          短影片審核頁
        </div>
        <button className="btn-outline" onClick={loadQueue} disabled={loadingList || submitting}>
          {loadingList ? '載入中…' : '重新載入待審清單'}
        </button>
      </div>

      {operationError && (
        <div role="alert" aria-live="assertive" style={{ fontSize: 12, color: '#ffb0a0', padding: '10px 12px', background: 'rgba(255,107,107,0.1)', borderRadius: 8, border: '1px solid rgba(255,107,107,0.25)', marginBottom: 16 }}>
          {operationError}
          {selectedAsset && (
            <button className="btn-outline" style={{ marginLeft: 12 }} onClick={() => loadAsset(selectedAsset.id, { preserveDraft: true })} disabled={loadingDetail || submitting}>
              {reviewPersistedAwaitingReadback ? '只重新讀取最新狀態' : '重新讀取'}
            </button>
          )}
        </div>
      )}

      {!loadingList && !items.length && !selectedAsset && (
        <div className="card-sm" style={{ padding: 24, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
          目前沒有待審核的短影片。
        </div>
      )}

      {!!items.length && (
        <div style={{ marginBottom: 18 }}>
          <label className="ff-label" htmlFor="short-review-select">待審短影片</label>
          <select
            id="short-review-select"
            value={selectedAsset?.id || ''}
            onChange={(event) => loadAsset(event.target.value)}
            disabled={loadingDetail || submitting}
            style={{ width: 'min(520px, 100%)', padding: '10px 12px', borderRadius: 8, background: '#250f20', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            {items.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title} · {asset.course?.title || '未命名課程'} · v{asset.generationVersion}
              </option>
            ))}
          </select>
        </div>
      )}

      {loadingDetail && <div style={{ color: 'rgba(255,255,255,0.55)' }}>正在讀取最新素材…</div>}

      {selectedAsset && !loadingDetail && (
        <>
          <StepIndicator steps={STEP_LABELS} currentStep={step} />

          {step === 1 && (
            <div className="ff-grid-2" style={{ display: 'grid', gridTemplateColumns: showReasonPanel ? '0.95fr 1.05fr' : '1fr', gap: 24, width: '100%', maxWidth: '98%' }}>
              <div className="card-sm video-review-card" style={{ padding: '16px 18px', width: '100%' }}>
                <label className="ff-label">SHORT ASSET · v{selectedAsset.generationVersion}</label>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>{selectedAsset.title}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
                  課程：{selectedAsset.course?.title || '—'} · 生命週期：{selectedAsset.status} · 審核：{selectedAsset.reviewStatus}
                </div>
                {selectedAsset.description && (
                  <p style={{ fontSize: 12, lineHeight: 1.6, color: 'rgba(255,255,255,0.65)' }}>{selectedAsset.description}</p>
                )}

                {selectedAsset.youtubeVideoId ? (
                  <iframe
                    title={selectedAsset.title}
                    src={`https://www.youtube.com/embed/${encodeURIComponent(selectedAsset.youtubeVideoId)}`}
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="video-review-video"
                    style={{ border: 0, aspectRatio: '9 / 16', maxHeight: 520 }}
                  />
                ) : selectedAsset.thumbnail ? (
                  <img className="video-review-video" src={selectedAsset.thumbnail} alt={`${selectedAsset.title} 預覽圖`} style={{ objectFit: 'contain', maxHeight: 520 }} />
                ) : (
                  <div style={{ minHeight: 180, display: 'grid', placeItems: 'center', borderRadius: 10, background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.45)' }}>
                    此素材目前沒有可播放影片或預覽圖。
                  </div>
                )}

                {selectedAsset.youtubeUrl && (
                  <a href={selectedAsset.youtubeUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 10, color: '#ff8666', fontSize: 12 }}>
                    在 YouTube 開啟預覽
                  </a>
                )}
                <div style={{ marginTop: 12, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                  素材 ID：{selectedAsset.id} · 最後更新：{formatDate(selectedAsset.updatedAt)}
                </div>

                {!isReviewable && (
                  <div style={{ marginTop: 14, fontSize: 12, color: '#ffd18a' }}>此版本已完成審核，不可再次送出。</div>
                )}
                {reviewPersistedAwaitingReadback && (
                  <div style={{ marginTop: 14, fontSize: 12, color: '#ffd18a' }}>審核已送出，重新讀取成功前不可再次送審。</div>
                )}
                <div className="review-btn-row" style={{ marginTop: 16 }}>
                  <button className="btn-primary" onClick={handleApproveClick} disabled={!reviewActionsEnabled}>通過並上架</button>
                  <button className="btn-outline btn-outline-danger" onClick={handleRejectClick} disabled={!reviewActionsEnabled}>不通過</button>
                </div>
              </div>

              {showReasonPanel && reviewActionsEnabled && (
                <div className="video-review-right card-sm video-review-card" style={{ padding: '16px 18px', width: '100%' }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '.08em', marginBottom: 12 }}>REJECTION REASONS</div>
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
                                <textarea value={note} onChange={(event) => updateNote(code, event.target.value)} placeholder={placeholder} rows={2} maxLength={500} />
                                <div style={{ textAlign: 'right', fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{note.length}/500</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {validationMessage && <div role="alert" style={{ fontSize: 12, color: '#ff6b6b', marginTop: 10 }}>{validationMessage}</div>}
                  <div className="review-btn-row" style={{ marginTop: 12 }}>
                    <button className="btn-primary" onClick={handleRejectContinue} disabled={submitting}>下一步：確認理由</button>
                    <button className="btn-outline" onClick={() => setShowReasonPanel(false)} disabled={submitting}>取消</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="card-sm video-review-card" style={{ padding: '16px 18px', width: '100%', maxWidth: '98%' }}>
              <label className="ff-label">CONFIRM · v{selectedAsset.generationVersion}</label>
              {pendingAction === 'approved' ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginTop: 8, marginBottom: 6 }}>即將審核通過並上架 YouTube</div>
                  {/* 審核通過就是上架閘門（規格書 R-08 / DR-13）：後端會在通過後自動把影片傳到
                      YouTube。這是對外且不可逆的動作，確認前必須講清楚。 */}
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7 }}>
                    通過後系統會自動把「{selectedAsset.title}」上傳到 YouTube，這是對外且不可逆的動作。
                    上傳一律是「非公開」：有連結才看得到，不會出現在搜尋結果或頻道頁。
                    上傳在背景進行，結果與失敗原因會顯示在腳本頁的「成品上傳」分頁。
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginTop: 8, marginBottom: 12 }}>請確認以下不通過理由</div>
                  <div className="reject-reason-list">
                    {checkedReasons.map((reason) => (
                      <div key={reason.code} className="reject-reason-item is-expanded">
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{reason.label}</div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>{reasonState[reason.code].note.trim() || '（未填寫說明）'}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="review-btn-row" style={{ marginTop: 20 }}>
                <button className="btn-primary" onClick={handleConfirmSubmit} disabled={submitting}>{submitting ? '送出並讀回中…' : (pendingAction === 'approved' ? '確認通過並上架' : '確認送出')}</button>
                <button className="btn-outline" onClick={() => setStep(1)} disabled={submitting}>返回修改</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="card-sm video-review-card" style={{ padding: '28px 18px', width: '100%', maxWidth: '98%', textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#F14F21', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <Ic n="check" s={22} c="#fff" />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 6 }}>伺服器已保存審核結果</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 20 }}>
                {finalStatus === 'approved' ? '本短影片已審核通過，系統正在背景上傳到 YouTube。上架結果請到腳本頁的「成品上傳」分頁確認。' : '本短影片已標示為不通過，結構化理由已讀回。'}
              </div>
              <button className="btn-primary" onClick={loadQueue}>審核下一支短影片</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
