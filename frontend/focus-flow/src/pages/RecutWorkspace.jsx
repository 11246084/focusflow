import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import useCompactLayout from '../hooks/useCompactLayout';
import { REJECTION_REASONS } from '../constants/videoReviewReasons';
import * as api from '../services/recut.js';
import {
  POLL_INTERVAL_MS, buildScriptLines, describeScript, durationStatus, formatClock, isBusyState,
  isCancellableState, isFixedRenderFailure, openingSentence, renderFailureText, sourceLabel, withCutMarks, playbackTimeline, recutErrorText, rejectScope, sentenceAt, stateInfo,
} from '../services/recutFlow.js';
import { ConfirmDialog, DurationMeter, FlowStrip, PrimaryAction, SheetDialog, StateChip, StatusCard } from './recutUi';

// 一支 recut 短片的審閱畫面。製作與管理兩個入口都打開這一份。
// 中欄：問題、流程列、講稿（或成品）；右欄（手機為底部固定列）：時長與這一步唯一的主要按鈕。

const BUSY_TEXT = {
  idle: '準備中',
  queued: '排隊中',
  generating: 'AI 正在整理講稿',
  updating: '正在套用修改',
  render_queued: '等待製作短片',
  rendering: '正在製作短片',
};
const EDITABLE_STATES = new Set(['script_review', 'render_failed']);
const YT_ORIGIN = 'https://www.youtube.com';

export default function RecutWorkspace({ script, onStateChange, onNext, nextLabel }) {
  const scriptId = String(script._id);
  const compact = useCompactLayout();
  const [snapshot, setSnapshot] = useState(null);
  const [review, setReview] = useState(null);
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expandedGaps, setExpandedGaps] = useState(() => new Set());
  const [chosenSuggestions, setChosenSuggestions] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectCodes, setRejectCodes] = useState(() => new Set());
  const [rejectNote, setRejectNote] = useState('');
  const [playingId, setPlayingId] = useState(null);
  const [playheadId, setPlayheadId] = useState(null);
  const audioRef = useRef(null);
  const stopAtRef = useRef(null);
  const iframeRef = useRef(null);
  const watchedTaskRef = useRef(null);
  const aliveRef = useRef(true);
  const headingRef = useRef(null);
  const [announcement, setAnnouncement] = useState('');
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);

  const state = snapshot?.recut?.state || script.recut?.state || 'idle';
  const info = describeScript({ recut: { state } }, snapshot?.task);

  const loadReview = useCallback(async (recut) => {
    if (!recut?.currentVersionId) { setReview(null); return null; }
    const data = await api.getReview(scriptId);
    if (aliveRef.current) setReview(data);
    return data;
  }, [scriptId]);

  const loadAsset = useCallback(async (recut) => {
    if (!recut?.currentAssetId) { setAsset(null); return; }
    try {
      const data = await api.getShortAsset(recut.currentAssetId);
      if (aliveRef.current) setAsset(data);
    } catch { if (aliveRef.current) setAsset(null); }
  }, []);

  const refresh = useCallback(async () => {
    const data = await api.getRecutState(scriptId);
    if (!aliveRef.current) return data;
    setSnapshot(data);
    onStateChangeRef.current?.(scriptId, data.recut);
    const watched = watchedTaskRef.current;
    if (watched && data.task?.id === watched && ['failed', 'cancelled'].includes(data.task.status)) {
      watchedTaskRef.current = null;
      setError(recutErrorText(data.task.error || { code: data.task.status === 'cancelled' ? 'RECUT_TASK_CANCELLED' : 'RECUT_TASK_FAILED' }));
    }
    if (!isBusyState(data.recut.state)) {
      await Promise.all([loadReview(data.recut), loadAsset(data.recut)]);
    }
    return data;
  }, [scriptId, loadReview, loadAsset]);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    setError('');
    setNotice('');
    setReview(null);
    setAsset(null);
    setRejecting(false);
    setChosenSuggestions(new Set());
    setExpandedGaps(new Set());
    refresh().catch((err) => setError(recutErrorText(err))).finally(() => aliveRef.current && setLoading(false));
    return () => { aliveRef.current = false; };
  }, [refresh]);

  // 背景處理中定時查狀態；停止等待不等於取消。
  useEffect(() => {
    if (!isBusyState(state)) return undefined;
    const timer = setInterval(() => { refresh().catch(() => {}); }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state, refresh]);

  // 換步驟時（例如核准後開始製作），原本的主要按鈕會消失；焦點若掉到頁面本身，移回標題並念出新步驟。
  const previousStateRef = useRef(null);
  useEffect(() => {
    const previous = previousStateRef.current;
    previousStateRef.current = state;
    if (loading || previous === null || previous === state) return;
    setAnnouncement(describeScript({ recut: { state } }).label);
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, [state, loading]);

  // 試跑要量審閱時間：進入確認講稿／確認成品時開始，離開時結束。失敗不影響操作。
  const timingPhase = state === 'script_review' ? 'script_review' : state === 'asset_review' ? 'asset_review' : null;
  const timingVersion = review?.versionId;
  useEffect(() => {
    if (!timingPhase || !timingVersion || !review) return undefined;
    let timing = null;
    api.startReviewTimer(scriptId, review, timingPhase).then((data) => { timing = data; }).catch(() => {});
    return () => {
      if (timing) api.stopReviewTimer(scriptId, { versionId: timing.versionId, timingId: timing.id, phase: timingPhase }).catch(() => {});
    };
    // 只在階段或版本改變時重新計時，revision 變動（逐句草稿）不算新的一段。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptId, timingPhase, timingVersion]);

  const run = useCallback(async (name, action, { reloadOnConflict = true } = {}) => {
    setPending(name);
    setError('');
    setNotice('');
    try {
      return await action();
    } catch (err) {
      if (err?.status === 409 && reloadOnConflict && err.code !== 'RECUT_LOCK_CONFIRM_REQUIRED') {
        await refresh().catch(() => {});
      }
      setError(recutErrorText(err));
      throw err;
    } finally {
      if (aliveRef.current) setPending('');
    }
  }, [refresh]);

  const startTask = useCallback(async (name, action) => {
    const task = await run(name, action);
    if (task?.id) watchedTaskRef.current = task.id;
    await refresh();
  }, [run, refresh]);

  // ── 講稿 ───────────────────────────────────────────────────────
  const view = review?.draft || review?.current;
  const sentences = useMemo(() => review?.source?.sentences || [], [review]);
  const timelineItems = useMemo(() => playbackTimeline(sentences), [sentences]);
  const cutStart = useMemo(() => new Map(timelineItems.map((item) => [item.id, item.from])), [timelineItems]);
  const lines = useMemo(() => withCutMarks(buildScriptLines(sentences, expandedGaps), timelineItems), [sentences, expandedGaps, timelineItems]);
  const opening = openingSentence(sentences);
  // 修改送出中不拿掉按鈕（拿掉會讓鍵盤焦點掉回頁首、整欄重排），只忽略重複點擊。
  const editable = EDITABLE_STATES.has(state);
  const answerable = review?.current?.selection?.answerable !== false;
  const duration = durationStatus(view?.durationSec);

  const toggleSentence = (sentence) => {
    if (pending) return;
    const adding = !sentence.selected;
    run('edit', async () => {
      const data = await api.editSelection(scriptId, review, [{ sentenceId: sentence.id, action: adding ? 'add' : 'remove' }]);
      setReview(data);
      const total = Math.round(Number((data.draft || data.current)?.durationSec) || 0);
      setAnnouncement(`${adding ? '已加回' : '已移除'}，總長 ${total} 秒`);
    }).catch(() => {});
  };

  const stopAudio = () => { audioRef.current?.pause(); stopAtRef.current = null; setPlayingId(null); };
  const playSentence = (sentence) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === sentence.id) { stopAudio(); return; }
    setError('');
    stopAtRef.current = Number(sentence.endSec);
    setPlayingId(sentence.id);
    const begin = () => { audio.currentTime = Number(sentence.startSec) || 0; audio.play().catch(() => { setPlayingId(null); }); };
    if (audio.readyState >= 1) begin();
    else { audio.addEventListener('loadedmetadata', begin, { once: true }); audio.load(); }
  };
  const onAudioTime = () => {
    const audio = audioRef.current;
    if (audio && stopAtRef.current != null && audio.currentTime >= stopAtRef.current) stopAudio();
  };

  // ── 成品播放：讀 YouTube 播放器回報的時間，標出講稿目前那一句 ─────────────
  const timeline = timelineItems;
  const showAsset = ['asset_review', 'asset_approved', 'published'].includes(state);
  useEffect(() => {
    if (!showAsset || !asset?.youtubeVideoId) return undefined;
    const onMessage = (event) => {
      if (event.origin !== YT_ORIGIN || event.source !== iframeRef.current?.contentWindow) return;
      let data = event.data;
      try { data = typeof data === 'string' ? JSON.parse(data) : data; } catch { return; }
      const time = data?.info?.currentTime;
      if (typeof time === 'number') setPlayheadId(sentenceAt(timeline, time));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [showAsset, asset?.youtubeVideoId, timeline]);
  const listenToPlayer = () => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: scriptId }), YT_ORIGIN);
  };

  // ── 動作 ───────────────────────────────────────────────────────
  const approveAndRender = () => run('approve', async () => {
    const approved = await api.approveScript(scriptId, review);
    setReview(approved);
    await api.queueRender(scriptId, approved);
    await refresh();
  }).catch(() => {});
  const render = () => run('render', async () => { await api.queueRender(scriptId, review); await refresh(); }).catch(() => {});
  const applyDraft = () => startTask('apply', () => api.applySelection(scriptId, review)).catch(() => {});
  const restoreDraft = () => run('restore', async () => {
    const data = await api.restoreSelection(scriptId, review);
    setReview(data);
    setDialog(null);
  }).catch(() => setDialog(null));
  const generate = () => startTask('generate', () => api.startGeneration(scriptId)).catch(() => {});
  const cancel = () => run('cancel', async () => {
    if (snapshot?.task?.id) await api.cancelTask(scriptId, snapshot.task.id);
    setNotice('正在取消，講稿會維持原樣。');
    await refresh();
  }).catch(() => {});

  const openSuggestions = (review?.suggestions || []).filter((s) => s.adopted === null);
  const adopt = (confirmed = []) => startTask('adopt', () => api.applySuggestions(scriptId, review, [...chosenSuggestions], confirmed))
    .then(() => { setChosenSuggestions(new Set()); setDialog(null); })
    .catch(() => setDialog(null));
  const requestAdopt = () => {
    const needConfirm = openSuggestions.filter((s) => chosenSuggestions.has(s.id) && s.requiresSelectionConfirmation);
    if (needConfirm.length) setDialog({ type: 'confirmSuggestions', ids: needConfirm.map((s) => s.id) });
    else adopt();
  };

  const approveAsset = () => run('approveAsset', async () => {
    const data = await api.approveAsset(scriptId, review);
    setReview(data);
    await refresh();
  }).catch(() => {});
  const otherCode = 'other';
  const rejectReady = rejectCodes.size > 0 && (!rejectCodes.has(otherCode) || rejectNote.trim());
  const sendReject = () => run('reject', async () => {
    const codes = [...rejectCodes];
    const reasons = codes.map((code) => ({ code, ...(code === otherCode ? { note: rejectNote.trim() } : {}) }));
    const data = await api.rejectAsset(scriptId, review, { scope: rejectScope(codes), reasons });
    setReview(data);
    setRejecting(false);
    setRejectCodes(new Set());
    setRejectNote('');
    await refresh();
  }).catch(() => {});

  // ── 這一步的主要動作與停用原因 ─────────────────────────────────────
  let primary = null;
  if (state === 'idle') primary = { label: info.action === '重新產生' ? '重新產生' : '產生講稿', onClick: generate, busy: pending === 'generate' };
  else if (state === 'script_review' && review?.draft) {
    primary = { label: '套用修改', onClick: applyDraft, busy: pending === 'apply', disabled: !duration.valid, reason: '總長需在 30～65 秒' };
  } else if (state === 'script_review' && review) {
    primary = { label: '核准講稿', onClick: approveAndRender, busy: pending === 'approve',
      disabled: !answerable, reason: review.current?.selection?.unanswerableReason || '這段錄音無法回答這個問題' };
  } else if (state === 'script_approved') primary = { label: '開始製作', onClick: render, busy: pending === 'render' };
  else if (state === 'render_failed' && review?.draft) {
    primary = { label: '套用修改', onClick: applyDraft, busy: pending === 'apply', disabled: !duration.valid, reason: '總長需在 30～65 秒' };
  } else if (state === 'render_failed' && !isFixedRenderFailure(snapshot?.render?.errorCode)) {
    primary = { label: '重新製作', onClick: render, busy: pending === 'render' };
  }
  const rejectAction = { label: '送出退回', onClick: sendReject, busy: pending === 'reject', disabled: !rejectReady,
    reason: rejectCodes.has(otherCode) ? '請寫下其他原因' : '請選擇退回原因' };
  // 手機上退回原因在底部面板裡，底部列維持「核准上架」；電腦版把主要按鈕換成「送出退回」。
  if (state === 'asset_review' && rejecting && !compact) {
    primary = rejectAction;
  } else if (state === 'asset_review') {
    primary = { label: '核准上架', onClick: approveAsset, busy: pending === 'approveAsset',
      disabled: !asset?.youtubeVideoId, reason: '影片還在上傳，完成後才能觀看' };
  }

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
      {rejectCodes.has(otherCode) && (
        <label style={{ display: 'block', marginTop: 12 }}>
          <span className="rc-field-label">其他原因</span>
          <textarea className="rc-textarea" value={rejectNote} maxLength={500} onChange={(event) => setRejectNote(event.target.value)} />
        </label>
      )}
    </>
  );

  const playheadText = playheadId ? sentences.find((item) => item.id === playheadId)?.text || '' : '';
  const showDuration = Boolean(view) && !showAsset && !isBusyState(state);
  const actionBlock = (
    <div className={compact ? 'rc-dock' : 'rc-panel'}>
      <div className="rc-actions">
        {showDuration && <DurationMeter seconds={view.durationSec} />}
        {primary && <PrimaryAction {...primary} />}
        {(state === 'script_review' || state === 'render_failed') && review?.draft && (
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" disabled={Boolean(pending)} onClick={() => setDialog({ type: 'restore' })}>全部復原</button>
        )}
        {state === 'asset_review' && (
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" disabled={Boolean(pending)}
            onClick={() => { setRejecting((value) => !value); setRejectCodes(new Set()); setRejectNote(''); }}>
            {rejecting && !compact ? '不退回' : '退回'}
          </button>
        )}
        {isCancellableState(state) && snapshot?.task?.id && (
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" disabled={Boolean(pending) || snapshot.task.status === 'cancel_requested'} onClick={cancel}>
            {snapshot.task.status === 'cancel_requested' ? '正在取消' : '取消'}
          </button>
        )}
        {onNext && ['render_queued', 'rendering', 'asset_approved', 'published', 'queued', 'generating', 'updating'].includes(state) && (
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" onClick={onNext}>{nextLabel || '下一支'}</button>
        )}
        {error && <p className="rc-error" role="alert">{error}</p>}
        {notice && <p className="rc-reason" role="status">{notice}</p>}
      </div>
    </div>
  );

  const renderLine = (sentence, role) => {
    const kept = role === 'kept' || role === 'opening';
    const live = playingId === sentence.id || playheadId === sentence.id;
    const canToggle = editable && sentence.selectionAllowed !== false && answerable;
    return (
      <li key={sentence.id} className="rc-line" data-role={role} data-playing={live}>
        <span className="rc-cut" aria-hidden={!kept}>
          {kept && cutStart.has(sentence.id) ? <><span className="rc-visually-hidden">短片 </span>{formatClock(cutStart.get(sentence.id))}</> : ''}
        </span>
        <div className="rc-line-body">
          {role === 'opening' && <span className="rc-line-tag">片頭</span>}
          <p className="rc-line-text">
            {!kept && <span className="rc-visually-hidden">略過：</span>}
            {live && <span className="rc-visually-hidden">正在播放：</span>}
            {sentence.text}
          </p>
          <span className="rc-line-meta">
            <button type="button" className="rc-time" aria-pressed={playingId === sentence.id} onClick={() => playSentence(sentence)}>
              <Ic n="play" s={10} /> 原音 {formatClock(sentence.startSec)}
            </button>
            {sentence.teacherChanged && <StateChip tone="mine">{kept ? '已加回' : '已移除'}</StateChip>}
          </span>
        </div>
        {canToggle && (
          <button type="button" className="rc-btn-text rc-line-toggle" data-act={kept ? 'remove' : 'add'} onClick={() => toggleSentence(sentence)}
            aria-disabled={pending ? 'true' : undefined} aria-label={`${kept ? '移除' : '加回'}：${sentence.text}`}>
            {kept ? '移除' : '加回'}
          </button>
        )}
      </li>
    );
  };

  const changeSummary = review?.latestChangeSummary?.changes || [];
  const sidePanels = (
    <>
        {state === 'asset_review' && rejecting && !compact && (
          <section className="rc-panel">
            {rejectFields}
          </section>
        )}

        {state === 'script_review' && !review?.draft && openSuggestions.length > 0 && (
          <section className="rc-panel">
            <h2 className="rc-section-title">AI 建議</h2>
            {openSuggestions.map((suggestion) => (
              <label key={suggestion.id} className="rc-check">
                <input type="checkbox" checked={chosenSuggestions.has(suggestion.id)} disabled={Boolean(pending)}
                  onChange={(event) => setChosenSuggestions((prev) => {
                    const next = new Set(prev);
                    if (event.target.checked) next.add(suggestion.id); else next.delete(suggestion.id);
                    return next;
                  })} />
                <span className="rc-check-body">
                  <strong>{suggestion.proposedChange || suggestion.problem}</strong>
                  {suggestion.proposedChange && suggestion.problem && <span>{suggestion.problem}</span>}
                </span>
              </label>
            ))}
            <button type="button" className="rc-btn rc-btn-outline rc-btn-block" style={{ marginTop: 10 }}
              disabled={!chosenSuggestions.size || Boolean(pending)} onClick={requestAdopt}>
              {pending === 'adopt' ? '處理中…' : `採納 ${chosenSuggestions.size || ''} 項建議`}
            </button>
          </section>
        )}

        {changeSummary.length > 0 && state === 'script_review' && (
          <section className="rc-panel">
            <h2 className="rc-section-title">這一版改了</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{changeSummary.map((change) => <li key={change}>{change}</li>)}</ul>
          </section>
        )}
    </>
  );

  const busy = isBusyState(state);
  const step = state === 'published' ? 3 : stateInfo(state).step;

  return (
    <>
      <div className="rc-col rc-main">
        <section className="rc-panel rc-main" aria-labelledby={`rc-q-${scriptId}`}>
          <h1 id={`rc-q-${scriptId}`} ref={headingRef} tabIndex={-1} className="rc-question">{script.sourceQuestions?.[0]?.question || script.topic}</h1>
          {review?.source && <p className="rc-source">{sourceLabel(script, review.source)}</p>}
          <FlowStrip step={step} />
          {review?.source?.notice && <p className="rc-reason" style={{ textAlign: 'left' }}>{review.source.notice}</p>}
          {view?.warnings?.map((warning) => <p key={warning} className="rc-error">{warning}</p>)}
        </section>

        {!loading && state === 'render_failed' && (
          <section className="rc-panel" role="alert">
            <StateChip tone="error">製作失敗</StateChip>
            <p style={{ marginTop: 8, color: 'var(--ff-chalk-white)' }}>{renderFailureText(snapshot?.render)}</p>
          </section>
        )}
        {loading && <p className="rc-reason">載入中…</p>}
        {!loading && busy && (
          <StatusCard title={BUSY_TEXT[state] || info.label}>
            <p>{state === 'rendering' || state === 'render_queued' ? '約幾分鐘，完成會通知你' : '約一分鐘'}</p>
          </StatusCard>
        )}
        {!loading && state === 'idle' && !review && (
          <section className="rc-panel"><p>{info.label === '尚未產生講稿' ? '還沒有講稿' : info.label}</p></section>
        )}

        <div className="rc-review">
          <div className="rc-review-grid" data-asset={showAsset && !loading ? 'true' : undefined}>
        {!loading && showAsset && (
          <section className="rc-panel" aria-label="成品">
            <div className="rc-player-wrap">
            <div className="rc-player">
              {asset?.youtubeVideoId ? (
                <iframe ref={iframeRef} onLoad={listenToPlayer} title={`成品：${script.topic}`}
                  src={`${YT_ORIGIN}/embed/${encodeURIComponent(asset.youtubeVideoId)}?enablejsapi=1&cc_load_policy=1&cc_lang_pref=zh-Hant&playsinline=1&rel=0&origin=${encodeURIComponent(window.location.origin)}`}
                  allow="encrypted-media; picture-in-picture; fullscreen" />
              ) : (
                <p className="rc-player-empty">影片還在上傳</p>
              )}
            </div>
            {playheadText && <p className="rc-now" aria-hidden="true">{playheadText}</p>}
            </div>
            {state === 'published' && asset?.youtubeUrl && (
              <p style={{ marginTop: 12, textAlign: 'center' }}><a href={asset.youtubeUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ff-ember-orange)' }}>在 YouTube 開啟</a></p>
            )}
          </section>
        )}

        {!loading && !busy && review && (
          <section className="rc-panel" aria-label="講稿">
            <ol className="rc-script">
              {opening && renderLine(opening, 'opening')}
              {lines.map((line) => (line.type === 'mark' ? (
                <li key={line.id} className="rc-mark" data-sec={line.sec}><span>{line.sec} 秒</span></li>
              ) : line.type === 'gap' ? (
                <li key={line.id} className="rc-gap">
                  <button type="button" className="rc-btn-text" onClick={() => setExpandedGaps((prev) => new Set(prev).add(line.id))}>
                    略過 {line.count} 句
                  </button>
                </li>
              ) : renderLine(line.sentence, line.role)))}
            </ol>
          </section>
        )}
          </div>
        </div>
        {compact && sidePanels}
        {compact && actionBlock}
      </div>

      <aside className="rc-col rc-side" aria-label="這一步">
        {!compact && actionBlock}

        {!compact && sidePanels}
      </aside>

      {review?.source?.videoId && (
        <audio ref={audioRef} preload="none" src={`/api/v1/videos/${encodeURIComponent(review.source.videoId)}/source`}
          onTimeUpdate={onAudioTime} onPause={() => setPlayingId(null)}
          onError={() => { setPlayingId(null); setError(recutErrorText({ code: 'LOCAL_PLAYBACK_UNAVAILABLE' })); }} />
      )}

      <p className="rc-visually-hidden" role="status" aria-live="polite">{announcement}</p>

      {compact && (
        <SheetDialog open={state === 'asset_review' && rejecting} title="哪裡要改" onClose={() => setRejecting(false)}
          action={<PrimaryAction {...rejectAction} />}>
          {rejectFields}
        </SheetDialog>
      )}

      <ConfirmDialog open={dialog?.type === 'restore'} title="放棄這些修改？" confirmLabel="全部復原" danger
        busy={pending === 'restore'} onConfirm={restoreDraft} onClose={() => setDialog(null)}>
        <p>講稿會回到 AI 整理的版本。</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog?.type === 'confirmSuggestions'} title="這些建議會改到你調整過的句子" confirmLabel="仍要採納"
        busy={pending === 'adopt'} onConfirm={() => adopt(dialog?.ids || [])} onClose={() => setDialog(null)}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {openSuggestions.filter((s) => dialog?.ids?.includes(s.id)).map((s) => <li key={s.id}>{s.proposedChange || s.problem}</li>)}
        </ul>
      </ConfirmDialog>
    </>
  );
}
