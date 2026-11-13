import { useEffect, useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import useCompactLayout from '../hooks/useCompactLayout';
import useVisiblePolling from '../hooks/useVisiblePolling';
import { FEEDBACK_TYPES, generateVersion, latestVersion, retryAssetUpload, reviewScript, uploadAsset } from '../services/shortScript.js';
import { findScriptAsset } from '../services/shortScriptStatus.js';
import { renderScriptMarkdown } from '../services/shortScriptTemplate.js';
import { getReviewErrorMessage, submitReviewAndReadback, validateRejectionReasons } from '../services/videoReview.js';
import { AVATAR_STEPS, describeAvatar, formatShotRange, recutErrorText } from '../services/recutFlow.js';
import { formatFileSize, validateVideoFile } from './teacherUploadUtils';
import { ConfirmDialog, FlowStrip, HelpTip, PrimaryAction, RejectReasonFields, SheetDialog, StateChip, StatusCard } from './recutUi';

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
  const [noteTouched, setNoteTouched] = useState(false);
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
    setRejectNote(''); setNoteTouched(false);
  }, getReviewErrorMessage);

  // 傳送中、等管理員、等 YouTube 處理完成時定時重新讀取（分頁在背景時暫停），畫面會自己換到下一步。
  const waitingOutside = Boolean(BUSY_TEXT[info.state]) || (info.state === 'in_review' && !asset?.youtubeVideoId);
  useVisiblePolling(() => { onChanged?.()?.catch?.(() => {}); }, 8000, waitingOutside);

  const scriptStage = ['to_generate', 'changes_requested'].includes(info.state);
  const uploadStage = ['to_film', 'asset_rejected'].includes(info.state);
  const reviewStage = info.state === 'in_review';
  const canRevise = version && (scriptStage || uploadStage);

  const modeAction = mode === 'regenerate'
    ? { label: '重新產生', onClick: regenerate, busy: pending === 'regenerate' }
    : mode === 'reject' ? { label: '送出退回', onClick: () => review('rejected'), busy: pending === 'reject', disabled: Boolean(rejectProblem), reason: rejectProblem } : null;
  // 原因一律放在面板裡選（手機從底部升起、電腦置中），這一步的主要按鈕不會被換掉。
  let primary = null;
  if (info.state === 'to_generate') primary = { label: '產生腳本', onClick: generate, busy: pending === 'generate' };
  else if (info.state === 'changes_requested') primary = { label: '重新產生', onClick: generate, busy: pending === 'generate' };
  // 這一步真正要做的是傳回影片：還沒選影片時主要按鈕是「選擇影片」，選了才換成「上傳影片」。
  else if (uploadStage && !file) primary = { label: '選擇影片', hint: '選你在自己電腦做好的影片檔', onClick: () => fileRef.current?.click(), disabled: pending === 'upload' };
  else if (uploadStage) {
    primary = { label: '上傳影片', onClick: upload, busy: pending === 'upload', disabled: !aiConfirmed || !consentConfirmed, reason: '勾選上傳前的兩項確認' };
  } else if (info.state === 'upload_failed' && asset?.upload?.retrySafe) primary = { label: '重試上傳', onClick: retry, busy: pending === 'retry' };
  else if (reviewStage) primary = { label: '核准上架', hint: '學生短片牆會看到', onClick: () => review('approved'), busy: pending === 'approve', disabled: !asset?.youtubeVideoId, reason: '影片還在上傳，完成後才能觀看' };

  // 選好影片後的檔名與兩項確認：電腦在右欄主要按鈕上方；手機放在主欄，底部列只留主要按鈕，不遮住腳本。
  const uploadChecks = uploadStage && file ? (
    <div className="rc-upload">
      <p className="rc-upload-file">
        <span>{file.name}（{formatFileSize(file.size)}）</span>
        <button type="button" className="rc-btn-text" onClick={() => fileRef.current?.click()} disabled={pending === 'upload'}>換一支</button>
      </p>
      <label className="rc-check">
        <input type="checkbox" checked={aiConfirmed} onChange={(event) => setAiConfirmed(event.target.checked)} />
        <span className="rc-check-body"><strong>右上角全程顯示「AI 合成影像・經本人授權」</strong></span>
      </label>
      <label className="rc-check">
        <input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} />
        <span className="rc-check-body"><strong>我已簽署數位分身書面同意書</strong><span>寫明用途、範圍、期限，並可撤回</span></span>
      </label>
    </div>
  ) : null;

  const actionBlock = (
    <div className={compact ? 'rc-dock' : 'rc-panel'} data-rc-actions>
      <div className="rc-actions">
        {uploadStage && (
          <input ref={fileRef} type="file" accept="video/*" className="rc-visually-hidden" tabIndex={-1} aria-hidden="true"
            onChange={pickFile} disabled={pending === 'upload'} />
        )}
        {!compact && uploadChecks}
        {primary && <PrimaryAction {...primary} />}
        {reviewStage && (
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" disabled={Boolean(pending)}
            onClick={() => { setMode('reject'); setRejectCodes(new Set()); setRejectNote(''); setNoteTouched(false); }}>
            退回
          </button>
        )}
        {['approved_waiting_upload', 'published'].includes(info.state) && (
          <p className="rc-done" role="status" data-done={info.state === 'published' ? 'true' : undefined}>
            <span aria-hidden="true"><Ic n={info.state === 'published' ? 'checkCircle' : 'hourglass'} s={18} /></span>
            {info.state === 'published' ? '已上架，學生看得到' : '已核准，影片上傳完成後自動上架'}
          </p>
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
      <fieldset className="rc-fieldset">
        <legend className="rc-visually-hidden">哪裡要改</legend>
        <div className="rc-pills">
          {FEEDBACK_TYPES.map((type) => (
            <label key={type.value} className="rc-pill">
              <input type="radio" name={`fb-${scriptId}`} checked={feedbackType === type.value} onChange={() => setFeedbackType(type.value)} />
              {type.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="rc-field">
        <span className="rc-field-label">補充（選填）</span>
        <textarea className="rc-textarea" value={feedback} maxLength={500} onChange={(event) => setFeedback(event.target.value)} />
      </label>
    </>
  );
  const rejectFields = (
    <RejectReasonFields codes={rejectCodes} onCodesChange={setRejectCodes} note={rejectNote} onNoteChange={setRejectNote}
      noteTouched={noteTouched} onNoteTouched={setNoteTouched} />
  );

  const options = version?.payload?.visualMetaphorOptions || [];
  const sidePanels = (
    <>
      {canRevise && (
        <details className="rc-panel rc-more">
          <summary>重新產生或不做這支</summary>
          <div className="rc-more-body">
            <button type="button" className="rc-btn rc-btn-outline rc-btn-block" disabled={Boolean(pending)} onClick={() => setMode('regenerate')}>重新產生腳本</button>
            <button type="button" className="rc-btn-text rc-self-start" onClick={() => setDismissOpen(true)}>不做這支</button>
          </div>
        </details>
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
          {/* 唯一保留的說明：數位分身要老師在自己電腦上做影片，版面本身表達不出這件事。 */}
          {uploadStage && <p className="rc-source">照腳本在自己的電腦做好影片，再從這裡傳回。</p>}
        </section>

        {BUSY_TEXT[info.state] && <StatusCard title={BUSY_TEXT[info.state]}><p>完成會通知你</p></StatusCard>}
        {info.state === 'upload_failed' && (
          <section className="rc-panel" role="alert">
            <StateChip tone="error">上傳失敗</StateChip>
            <p className="rc-mt-s">{asset?.upload?.retrySafe ? '可以重試一次。' : '已通知管理員確認，不要重新上傳同一支影片。'}</p>
          </section>
        )}
        {info.state === 'to_generate' && <section className="rc-panel"><p>還沒有腳本</p></section>}
        {compact && uploadChecks && <section className="rc-panel">{uploadChecks}</section>}

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
              <p className="rc-external"><a href={asset.youtubeUrl} target="_blank" rel="noopener noreferrer">在 YouTube 開啟</a></p>
            )}
          </section>
        )}

        {shots.length > 0 && (
          <section className="rc-panel" aria-label="腳本">
            {(scriptStage || uploadStage) && (
              <div className="rc-script-tools">
                <HelpTip label="怎麼做" title="數位分身短片怎麼做">
                  <ol className="rc-help-steps">
                    <li>複製或下載腳本，用你電腦上的數位分身工具照著做。</li>
                    <li>影片右上角全程放「AI 合成影像・經本人授權」。</li>
                    <li>下載的腳本最後有驗收清單，做完照著檢查。</li>
                    <li>回到這裡按「選擇影片」傳回，再確認成品上架。</li>
                  </ol>
                </HelpTip>
                <button type="button" className="rc-btn-text" onClick={copy}>複製腳本</button>
                <button type="button" className="rc-btn-text" onClick={download}>下載腳本</button>
              </div>
            )}
            {/* 畫面上的腳本與下載的腳本用同一個視覺隱喻，老師照畫面做也拿得到完整方向。 */}
            {options.length > 0 && (
              <div className="rc-concept">
                <span>視覺隱喻</span>
                {options.length > 1 && (scriptStage || uploadStage) ? (
                  <select className="rc-select" aria-label="視覺隱喻" value={metaphor} onChange={(event) => setMetaphor(Number(event.target.value))}>
                    {options.map((option, index) => <option key={option.label} value={index}>{option.label}</option>)}
                  </select>
                ) : <strong>{options[metaphor]?.label || options[0].label}</strong>}
              </div>
            )}
            <ol className="rc-script">
              {shots.map((shot) => (
                <li key={shot.shotNo} className="rc-line rc-line-shot" data-role="kept">
                  <span className="rc-cut">{formatShotRange(shot.timeRange)}</span>
                  <div className="rc-line-body">
                    <p className="rc-line-text">{shot.narration}</p>
                    {shot.subtitle && shot.subtitle !== shot.narration && <p className="rc-shot-sub"><span>字幕</span>{shot.subtitle}</p>}
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
      <SheetDialog open={Boolean(mode)} title={mode === 'reject' ? '哪裡要改' : '重新產生腳本'} onClose={() => setMode(null)}
        action={modeAction && <PrimaryAction {...modeAction} />}>
        {mode === 'reject' ? rejectFields : regenerateFields}
      </SheetDialog>
      <ConfirmDialog open={dismissOpen} title="不做這支短片？" confirmLabel="不做了" danger busy={pending === 'dismiss'}
        onConfirm={dismiss} onClose={() => setDismissOpen(false)}>
        <p>之後不會再出現在待辦裡。</p>
      </ConfirmDialog>
    </>
  );
}
