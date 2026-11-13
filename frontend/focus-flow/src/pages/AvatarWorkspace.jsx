import { useEffect, useRef, useState } from 'react';
import useCompactLayout from '../hooks/useCompactLayout';
import { REJECTION_REASONS } from '../constants/videoReviewReasons';
import { FEEDBACK_TYPES, generateVersion, latestVersion, retryAssetUpload, reviewScript, uploadAsset } from '../services/shortScript.js';
import { findScriptAsset } from '../services/shortScriptStatus.js';
import { renderScriptMarkdown } from '../services/shortScriptTemplate.js';
import { getReviewErrorMessage, submitReviewAndReadback, validateRejectionReasons } from '../services/videoReview.js';
import { AVATAR_STEPS, describeAvatar, recutErrorText } from '../services/recutFlow.js';
import { formatFileSize, validateVideoFile } from './teacherUploadUtils';
import { ConfirmDialog, FlowStrip, PrimaryAction, SheetDialog, StateChip, StatusCard } from './recutUi';

// 數位分身短片的審閱畫面（UX-24）：系統產生腳本；教授在地端做好影片後傳回，確認成品後上架。
// 版面與 recut 相同：中欄問題、流程列與內容，右欄（手機為底部固定列）唯一的主要按鈕。

const YT_ORIGIN = 'https://www.youtube.com';
const BUSY_TEXT = {
  uploading: '影片傳送中',
  upload_waiting: '等待上傳',
  upload_needs_admin: '等管理員確認上傳',
  approved_waiting_upload: '已核准，影片傳完就上架',
};

export default function AvatarWorkspace({ script, assets, onChanged, onNext }) {
  const scriptId = String(script._id);
  const compact = useCompactLayout();
  const info = describeAvatar(script, assets);
  const version = latestVersion(script);
  const asset = findScriptAsset(scriptId, assets);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [metaphor, setMetaphor] = useState(0);
  const [mode, setMode] = useState(null); // 'regenerate' | 'reject'
  const [feedbackType, setFeedbackType] = useState(FEEDBACK_TYPES[0].value);
  const [feedback, setFeedback] = useState('');
  const [rejectCodes, setRejectCodes] = useState(() => new Set());
  const [rejectNote, setRejectNote] = useState('');
  const [file, setFile] = useState(null);
  const [aiConfirmed, setAiConfirmed] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const fileRef = useRef(null);
  const headingRef = useRef(null);
  const [announcement, setAnnouncement] = useState('');
  // 換步驟時原本的主要按鈕會消失；焦點若掉到頁面本身，移回標題並念出新步驟。
  const previousStateRef = useRef(info.state);
  useEffect(() => {
    if (previousStateRef.current === info.state) return;
    previousStateRef.current = info.state;
    setAnnouncement(info.label);
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, [info.state, info.label]);

  const run = async (name, action, describe = recutErrorText) => {
    setPending(name);
    setError('');
    setNotice('');
    try {
      await action();
      await onChanged?.();
    } catch (err) {
      setError(describe(err));
    } finally {
      setPending('');
    }
  };

  const generate = () => run('generate', () => generateVersion(scriptId));
  const regenerate = () => run('regenerate', async () => {
    if (script.status === 'generated') await reviewScript(scriptId, { decision: 'request_changes', feedback: feedback.trim() || undefined, feedbackType });
    await generateVersion(scriptId);
    setMode(null);
    setFeedback('');
  });
  const dismiss = () => run('dismiss', async () => {
    await reviewScript(scriptId, { decision: 'dismiss' });
    setDismissOpen(false);
  });
  const markdown = version ? renderScriptMarkdown(script, version, metaphor) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setNotice('已複製腳本');
      setError('');
    } catch {
      setError('瀏覽器不允許複製，請改用下載。');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${script.topic || '短片腳本'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const pickFile = (event) => {
    const picked = event.target.files?.[0];
    if (!picked) return;
    const invalid = validateVideoFile(picked);
    if (invalid) { setError(invalid); setFile(null); return; }
    setError('');
    setFile(picked);
  };
  const upload = () => run('upload', async () => {
    await uploadAsset(scriptId, { file, title: script.topic, versionNo: version.versionNo });
    setFile(null);
    setAiConfirmed(false);
    setConsentConfirmed(false);
    if (fileRef.current) fileRef.current.value = '';
  });
  const retry = () => run('retry', () => retryAssetUpload(asset.id));

  const rejectReasons = [...rejectCodes].map((code) => ({ code, ...(code === 'other' ? { note: rejectNote.trim() } : {}) }));
  const rejectProblem = rejectCodes.size ? validateRejectionReasons(rejectReasons) : '請選擇退回原因';
  const review = (status) => run(status === 'approved' ? 'approve' : 'reject', async () => {
    await submitReviewAndReadback({ shortAssetId: asset.id, status, expectedGenerationVersion: asset.generationVersion,
      ...(status === 'rejected' ? { reasons: rejectReasons } : {}) });
    setMode(null);
    setRejectCodes(new Set());
    setRejectNote('');
  }, getReviewErrorMessage);

  const scriptStage = ['to_generate', 'changes_requested'].includes(info.state);
  const uploadStage = ['to_film', 'asset_rejected'].includes(info.state);
  const reviewStage = info.state === 'in_review';
  const canRevise = version && (scriptStage || uploadStage);

  const modeAction = mode === 'regenerate'
    ? { label: '重新產生', onClick: regenerate, busy: pending === 'regenerate' }
    : mode === 'reject' ? { label: '送出退回', onClick: () => review('rejected'), busy: pending === 'reject', disabled: Boolean(rejectProblem), reason: rejectProblem } : null;
  // 手機上原因放在底部面板，底部列維持這一步原本的主要按鈕。
  let primary = null;
  if (modeAction && !compact) primary = modeAction;
  else if (info.state === 'to_generate') primary = { label: '產生腳本', onClick: generate, busy: pending === 'generate' };
  else if (info.state === 'changes_requested') primary = { label: '重新產生', onClick: generate, busy: pending === 'generate' };
  // 依步驟排：還沒選影片時先「複製腳本」拿去地端做；選了影片才換成「上傳影片」。
  else if (uploadStage && !file) primary = { label: '複製腳本', onClick: copy };
  else if (uploadStage) {
    primary = { label: '上傳影片', onClick: upload, busy: pending === 'upload', disabled: !aiConfirmed || !consentConfirmed, reason: '勾選上傳前的兩項確認' };
  } else if (info.state === 'upload_failed' && asset?.upload?.retrySafe) primary = { label: '重試上傳', onClick: retry, busy: pending === 'retry' };
  else if (reviewStage) primary = { label: '核准上架', hint: '學生短片牆會看到', onClick: () => review('approved'), busy: pending === 'approve', disabled: !asset?.youtubeVideoId, reason: '影片還在上傳，完成後才能觀看' };

  const actionBlock = (
    <div className={compact ? 'rc-dock' : 'rc-panel'}>
      <div className="rc-actions">
        {primary && <PrimaryAction {...primary} />}
        {version && (scriptStage || uploadStage) && (!mode || compact) && (
          <div style={{ display: 'flex', gap: 8 }}>
            {primary?.label !== '複製腳本' && <button type="button" className="rc-btn rc-btn-outline" style={{ flex: 1 }} onClick={copy}>複製腳本</button>}
            <button type="button" className="rc-btn rc-btn-outline" style={{ flex: 1 }} onClick={download}>下載腳本</button>
          </div>
        )}
        {canRevise && (
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" disabled={Boolean(pending)}
            onClick={() => setMode((value) => (value === 'regenerate' ? null : 'regenerate'))}>
            {mode === 'regenerate' && !compact ? '不重新產生' : '重新產生'}
          </button>
        )}
        {reviewStage && (
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" disabled={Boolean(pending)}
            onClick={() => { setMode((value) => (value === 'reject' ? null : 'reject')); setRejectCodes(new Set()); setRejectNote(''); }}>
            {mode === 'reject' && !compact ? '不退回' : '退回'}
          </button>
        )}
        {onNext && !primary && (
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" onClick={onNext}>下一支</button>
        )}
        {error && <p className="rc-error" role="alert">{error}</p>}
        {notice && <p className="rc-reason" role="status">{notice}</p>}
      </div>
    </div>
  );

  const regenerateFields = (
    <>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className={compact ? 'rc-visually-hidden' : 'rc-section-title'}>哪裡要改</legend>
        <div className="rc-pills">
          {FEEDBACK_TYPES.map((type) => (
            <label key={type.value} className="rc-pill">
              <input type="radio" name={`fb-${scriptId}`} checked={feedbackType === type.value} onChange={() => setFeedbackType(type.value)} />
              {type.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label style={{ display: 'block', marginTop: 12 }}>
        <span className="rc-field-label">補充（選填）</span>
        <textarea className="rc-textarea" value={feedback} maxLength={500} onChange={(event) => setFeedback(event.target.value)} />
      </label>
    </>
  );
  const rejectFields = (
    <>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className={compact ? 'rc-visually-hidden' : 'rc-section-title'}>哪裡要改</legend>
        <div className="rc-pills">
          {REJECTION_REASONS.map((reason) => (
            <label key={reason.code} className="rc-pill">
              <input type="checkbox" checked={rejectCodes.has(reason.code)} onChange={(event) => setRejectCodes((prev) => {
                const next = new Set(prev);
                if (event.target.checked) next.add(reason.code); else next.delete(reason.code);
                return next;
              })} />
              {reason.label}
            </label>
          ))}
        </div>
      </fieldset>
      {rejectCodes.has('other') && (
        <label style={{ display: 'block', marginTop: 12 }}>
          <span className="rc-field-label">其他原因</span>
          <textarea className="rc-textarea" value={rejectNote} maxLength={500} onChange={(event) => setRejectNote(event.target.value)} />
        </label>
      )}
    </>
  );

  const options = version?.payload?.visualMetaphorOptions || [];
  const sidePanels = (
    <>
      {mode === 'regenerate' && !compact && (
        <section className="rc-panel">
          {regenerateFields}
        </section>
      )}
      {mode === 'reject' && !compact && (
        <section className="rc-panel">
          {rejectFields}
        </section>
      )}
      {uploadStage && (!mode || compact) && (
        <section className="rc-panel" aria-labelledby={`up-${scriptId}`}>
          <h2 id={`up-${scriptId}`} className="rc-section-title">傳回影片</h2>
          <label className="rc-btn rc-btn-outline rc-btn-block" style={{ position: 'relative' }}>
            <input ref={fileRef} type="file" accept="video/*" onChange={pickFile} disabled={pending === 'upload'}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
            {file ? `${file.name}（${formatFileSize(file.size)}）` : '選擇影片'}
          </label>
          <label className="rc-check">
            <input type="checkbox" checked={aiConfirmed} onChange={(event) => setAiConfirmed(event.target.checked)} />
            <span className="rc-check-body"><strong>影片已加上全片常駐的 AI 生成標示</strong></span>
          </label>
          <label className="rc-check">
            <input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} />
            <span className="rc-check-body"><strong>已取得出現在影片中的教師書面同意</strong></span>
          </label>
        </section>
      )}
      {version && (scriptStage || uploadStage) && options.length > 1 && !mode && (
        <section className="rc-panel">
          <label>
            <span className="rc-field-label">視覺隱喻</span>
            <select className="rc-select" value={metaphor} onChange={(event) => setMetaphor(Number(event.target.value))}>
              {options.map((option, index) => <option key={option.label} value={index}>{option.label}</option>)}
            </select>
          </label>
        </section>
      )}
      {canRevise && !mode && (
        <button type="button" className="rc-btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => setDismissOpen(true)}>不做這支</button>
      )}
    </>
  );

  const showAsset = reviewStage || info.state === 'published' || info.state === 'approved_waiting_upload';
  const shots = version?.payload?.shots || [];
  return (
    <>
      <div className="rc-col rc-main">
        <section className="rc-panel rc-main" aria-labelledby={`av-q-${scriptId}`}>
          <h1 id={`av-q-${scriptId}`} ref={headingRef} tabIndex={-1} className="rc-question">{script.sourceQuestions?.[0]?.question || script.topic}</h1>
          <FlowStrip step={info.step} steps={AVATAR_STEPS} />
          {info.state === 'published' && <StateChip tone="done">已上架，學生看得到</StateChip>}
        </section>

        {BUSY_TEXT[info.state] && <StatusCard title={BUSY_TEXT[info.state]}><p>完成會通知你</p></StatusCard>}
        {info.state === 'upload_failed' && (
          <section className="rc-panel" role="alert">
            <StateChip tone="error">上傳失敗</StateChip>
            <p style={{ marginTop: 8 }}>{asset?.upload?.retrySafe ? '可以重試一次。' : '已通知管理員確認，不要重新上傳同一支影片。'}</p>
          </section>
        )}
        {info.state === 'to_generate' && <section className="rc-panel"><p>還沒有腳本</p></section>}

        {showAsset && (
          <section className="rc-panel" aria-label="成品">
            <div className="rc-player">
              {asset?.youtubeVideoId ? (
                <iframe title={`成品：${script.topic}`}
                  src={`${YT_ORIGIN}/embed/${encodeURIComponent(asset.youtubeVideoId)}?cc_load_policy=1&cc_lang_pref=zh-Hant&playsinline=1&rel=0`}
                  allow="encrypted-media; picture-in-picture; fullscreen" />
              ) : <p className="rc-player-empty">影片還在上傳</p>}
            </div>
            {info.state === 'published' && asset?.youtubeUrl && (
              <p style={{ marginTop: 12, textAlign: 'center' }}><a href={asset.youtubeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ff-ember-orange)' }}>在 YouTube 開啟</a></p>
            )}
          </section>
        )}

        {shots.length > 0 && (
          <section className="rc-panel" aria-label="腳本">
            <ol className="rc-script">
              {shots.map((shot) => (
                <li key={shot.shotNo} className="rc-line" data-role="kept">
                  <span className="rc-time" aria-hidden="true" style={{ cursor: 'default' }}>{shot.timeRange}</span>
                  <div className="rc-line-body">
                    <p className="rc-line-text">{shot.narration}</p>
                    {shot.subtitle && shot.subtitle !== shot.narration && <p className="rc-reason" style={{ textAlign: 'left' }}>{shot.subtitle}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
        {compact && sidePanels}
        {compact && actionBlock}
      </div>
      <aside className="rc-col rc-side" aria-label="這一步">
        {!compact && actionBlock}
        {!compact && sidePanels}
      </aside>
      <p className="rc-visually-hidden" role="status" aria-live="polite">{announcement}</p>
      {compact && (
        <SheetDialog open={Boolean(mode)} title={mode === 'reject' ? '哪裡要改' : '重新產生'} onClose={() => setMode(null)}
          action={modeAction && <PrimaryAction {...modeAction} />}>
          {mode === 'reject' ? rejectFields : regenerateFields}
        </SheetDialog>
      )}
      <ConfirmDialog open={dismissOpen} title="不做這支短片？" confirmLabel="不做了" danger busy={pending === 'dismiss'}
        onConfirm={dismiss} onClose={() => setDismissOpen(false)}>
        <p>之後不會再出現在待辦裡。</p>
      </ConfirmDialog>
    </>
  );
}
