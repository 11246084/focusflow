import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import useCompactLayout from '../hooks/useCompactLayout';
import useVisiblePolling from '../hooks/useVisiblePolling';
import * as api from '../services/recut.js';
import { listAssets } from '../services/shortScript.js';
import { REJECTION_REASONS } from '../constants/videoReviewReasons';
import {
  POLL_INTERVAL_MS, buildScriptLines, describeScript, durationStatus, formatClock, isBusyState,
  isCancellableState, isFixedRenderFailure, openingSentence, renderFailureText, sourceLabel, withCutMarks, playbackTimeline, recutErrorText, rejectScope, sentenceAt, stateInfo,
} from '../services/recutFlow.js';
import { ConfirmDialog, DurationMeter, FlowStrip, HelpTip, PrimaryAction, RejectReasonFields, SheetDialog, StateChip, StatusCard } from './recutUi';

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
const REJECT_LABEL = new Map(REJECTION_REASONS.map((reason) => [reason.code, reason.label]));
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
  const [noteTouched, setNoteTouched] = useState(false);
  const [lineError, setLineError] = useState(null);
  const [lastReject, setLastReject] = useState(null); // 上一支成品被退回的原因代碼 // { id, text }：逐句修改失敗時顯示在那一句下方
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

  // 背景處理中定時查狀態（分頁在背景時暫停）；停止等待不等於取消。
  useVisiblePolling(() => { refresh().catch(() => {}); }, POLL_INTERVAL_MS, isBusyState(state));
  // 成品在 YouTube 處理完成前不能核准；已核准的要等上架。這兩段也要定時查，畫面才會自己更新。
  const waitingForYouTube = (state === 'asset_review' && !asset?.youtubeVideoId) || state === 'asset_approved';
  useVisiblePolling(() => { refresh().catch(() => {}); }, POLL_INTERVAL_MS * 2, waitingForYouTube);

  // 成品被退回後目前成品會清空：從這門課的成品裡找這支最近一次被退回的原因，告訴老師為什麼回到這一步、接下來做什麼。
  useEffect(() => {
    if (!['script_review', 'script_approved', 'render_failed'].includes(state)) { setLastReject(null); return undefined; }
    let alive = true;
    (async () => {
      const own = (await listAssets(script.courseId)).filter((item) => item.sourceScriptId === scriptId && item.status !== 'archived')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const latest = own[0];
      if (!latest || latest.reviewStatus !== 'rejected') { if (alive) setLastReject(null); return; }
      const detail = await api.getShortAsset(latest.id);
      if (alive) setLastReject((detail.reviewReasons || []).map((reason) => reason.code));
    })().catch(() => { if (alive) setLastReject(null); });
    return () => { alive = false; };
  }, [state, script.courseId, scriptId]);

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
  // 狀態先換、講稿稍後才重新讀到：講稿的 revision 不舊於目前狀態才開始計時（逐句修改會讓講稿較新），否則會拿舊版本去開始而被拒。
  const reviewFresh = Boolean(review && snapshot && review.revision >= (snapshot.recut?.revision ?? 0));
  const timingVersion = reviewFresh ? review.versionId : null;
  // 送出會換版本或換狀態的動作前先結束計時；等狀態換完才結束，後端會因版本已更新而拒收。
  const timingRef = useRef(null);
  const stopTiming = useCallback(async () => {
    const timing = timingRef.current;
    timingRef.current = null;
    if (timing) await api.stopReviewTimer(scriptId, timing).catch(() => {});
  }, [scriptId]);
  useEffect(() => {
    if (!timingPhase || !timingVersion || !review) return undefined;
    let cancelled = false;
    api.startReviewTimer(scriptId, review, timingPhase).then((data) => {
      const timing = { versionId: data.versionId, timingId: data.id, phase: timingPhase };
      if (cancelled) api.stopReviewTimer(scriptId, timing).catch(() => {});
      else timingRef.current = timing;
    }).catch(() => {});
    return () => { cancelled = true; stopTiming(); };
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
  // 核准時要說清楚核准的是什麼：留用幾句、總長幾秒（片頭算在內）。
  const keptCount = sentences.filter((item) => item.selected || item.opening).length;

  const toggleSentence = (sentence) => {
    if (pending) return;
    const adding = !sentence.selected;
    setLineError(null);
    run('edit', async () => {
      const data = await api.editSelection(scriptId, review, [{ sentenceId: sentence.id, action: adding ? 'add' : 'remove' }]);
      setReview(data);
      const total = Math.round(Number((data.draft || data.current)?.durationSec) || 0);
      setAnnouncement(`${adding ? '已加回' : '已移除'}，總長 ${total} 秒；按「確定修改」後才能核准`);
    }).catch((err) => {
      // 錯誤放在那一句下面（而不是右欄），老師不用找。
      setError('');
      setLineError({ id: sentence.id, text: recutErrorText(err) });
    });
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
    await stopTiming();
    const approved = await api.approveScript(scriptId, review);
    setReview(approved);
    await api.queueRender(scriptId, approved);
    await refresh();
  }).catch(() => {});
  const render = () => run('render', async () => { await api.queueRender(scriptId, review); await refresh(); }).catch(() => {});
  const applyDraft = () => startTask('apply', async () => { await stopTiming(); return api.applySelection(scriptId, review); }).catch(() => {});
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
  const adopt = (confirmed = []) => startTask('adopt', async () => { await stopTiming(); return api.applySuggestions(scriptId, review, [...chosenSuggestions], confirmed); })
    .then(() => { setChosenSuggestions(new Set()); setDialog(null); })
    .catch(() => setDialog(null));
  const requestAdopt = () => {
    const needConfirm = openSuggestions.filter((s) => chosenSuggestions.has(s.id) && s.requiresSelectionConfirmation);
    if (needConfirm.length) setDialog({ type: 'confirmSuggestions', ids: needConfirm.map((s) => s.id) });
    else adopt();
  };

  const approveAsset = () => run('approveAsset', async () => {
    await stopTiming();
    const data = await api.approveAsset(scriptId, review);
    setReview(data);
    await refresh();
  }).catch(() => {});
  const otherCode = 'other';
  const rejectReady = rejectCodes.size > 0 && (!rejectCodes.has(otherCode) || rejectNote.trim());
  const sendReject = () => run('reject', async () => {
    await stopTiming();
    const codes = [...rejectCodes];
    const reasons = codes.map((code) => ({ code, ...(code === otherCode ? { note: rejectNote.trim() } : {}) }));
    const data = await api.rejectAsset(scriptId, review, { scope: rejectScope(codes), reasons });
    setReview(data);
    setRejecting(false);
    setRejectCodes(new Set());
    setRejectNote(''); setNoteTouched(false);
    await refresh();
  }).catch(() => {});

  // ── 這一步的主要動作與停用原因 ─────────────────────────────────────
  let primary = null;
  if (state === 'idle') primary = { label: info.action === '重新產生' ? '重新產生' : '產生講稿', onClick: generate, busy: pending === 'generate' };
  else if (state === 'script_review' && review?.draft) {
    primary = { label: '確定修改', hint: '修改已自動儲存；按下後系統依修改重排講稿，約一分鐘，完成後再核准', onClick: applyDraft, busy: pending === 'apply', disabled: !duration.valid, reason: '總長需在 30～65 秒' };
  } else if (state === 'script_review' && review) {
    primary = { label: '核准講稿', hint: `${keptCount} 句，接著自動製作短片；做好後會再請你確認才上架`, onClick: approveAndRender, busy: pending === 'approve',
      disabled: !answerable, reason: review.current?.selection?.unanswerableReason || '這段錄音無法回答這個問題' };
  } else if (state === 'script_approved') primary = { label: '開始製作', onClick: render, busy: pending === 'render' };
  else if (state === 'render_failed' && review?.draft) {
    primary = { label: '確定修改', onClick: applyDraft, busy: pending === 'apply', disabled: !duration.valid, reason: '總長需在 30～65 秒' };
  } else if (state === 'render_failed' && !isFixedRenderFailure(snapshot?.render?.errorCode)) {
    primary = { label: '重新製作', onClick: render, busy: pending === 'render' };
  }
  const rejectAction = { label: '送出退回', onClick: sendReject, busy: pending === 'reject', disabled: !rejectReady,
    reason: rejectCodes.has(otherCode) ? '請寫下其他原因' : '請選擇退回原因' };
  // 退回原因在面板裡選（手機從底部升起、電腦置中），主要按鈕一直是「核准上架」。
  if (state === 'asset_review') {
    primary = { label: '核准上架', hint: '學生短片牆會看到', onClick: approveAsset, busy: pending === 'approveAsset',
      disabled: !asset?.youtubeVideoId, reason: '影片還在上傳，完成後才能觀看' };
  }

  const rejectFields = (
    <>
      <p className="rc-reason rc-reason-start rc-sheet-note">選「內容」或「其他」會回到講稿修改；只選聲音、畫面、字幕，會用同一份講稿重新製作。</p>
      <RejectReasonFields codes={rejectCodes} onCodesChange={setRejectCodes} note={rejectNote} onNoteChange={setRejectNote}
      noteTouched={noteTouched} onNoteTouched={setNoteTouched} />
    </>
  );

  const playheadText = playheadId ? sentences.find((item) => item.id === playheadId)?.text || '' : '';
  const showDuration = Boolean(view) && !showAsset && !isBusyState(state);
  const actionBlock = (
    <div className={compact ? 'rc-dock' : 'rc-panel'} data-rc-actions>
      <div className="rc-actions">
        {showDuration && <DurationMeter seconds={view.durationSec} />}
        {primary && <PrimaryAction {...primary} />}
        {state === 'asset_review' && (
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" disabled={Boolean(pending)}
            onClick={() => { setRejecting(true); setRejectCodes(new Set()); setRejectNote(''); setNoteTouched(false); }}>
            退回
          </button>
        )}
        {isCancellableState(state) && snapshot?.task?.id && (
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" disabled={Boolean(pending) || snapshot.task.status === 'cancel_requested'} onClick={cancel}>
            {snapshot.task.status === 'cancel_requested' ? '正在取消' : '取消'}
          </button>
        )}
        {['asset_approved', 'published'].includes(state) && (
          <p className="rc-done" role="status" data-done={state === 'published' ? 'true' : undefined}>
            <span aria-hidden="true"><Ic n={state === 'published' ? 'checkCircle' : 'hourglass'} s={18} /></span>
            {state === 'published' ? '已上架，學生看得到' : '已核准，影片上傳完成後自動上架'}
          </p>
        )}
        {onNext && ['render_failed', 'render_queued', 'rendering', 'asset_approved', 'published', 'queued', 'generating', 'updating'].includes(state) && (
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
          {kept && cutStart.has(sentence.id) ? <><span className="rc-cut-label">短片</span>{' '}{formatClock(cutStart.get(sentence.id))}</> : ''}
        </span>
        <div className="rc-line-body">
          {role === 'opening' && <span className="rc-line-tag">片頭</span>}
          <p className="rc-line-text" id={`${scriptId}-${sentence.id}`}>
            {!kept && <span className="rc-visually-hidden">略過：</span>}
            {live && <span className="rc-visually-hidden">正在播放：</span>}
            {sentence.text}
          </p>
          <span className="rc-line-meta">
            <button type="button" className="rc-time" aria-pressed={playingId === sentence.id} onClick={() => playSentence(sentence)}
              aria-label={`播放原音 ${formatClock(sentence.startSec)}`} aria-describedby={`${scriptId}-${sentence.id}`}>
              <Ic n="play" s={10} /> 原音 {formatClock(sentence.startSec)}
            </button>
            {sentence.teacherChanged && <StateChip tone="edit">{kept ? '已加回' : '已移除'}</StateChip>}
          </span>
          {lineError?.id === sentence.id && <p className="rc-line-error" role="alert">{lineError.text}</p>}
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

  // 上下鍵在句子間移動：停在同一種按鈕（移除／加回，或原音），不必一路按 Tab。
  const moveBetweenLines = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const kind = event.target.closest?.('.rc-line-toggle') ? '.rc-line-toggle' : event.target.closest?.('.rc-time') ? '.rc-time' : null;
    if (!kind) return;
    const all = [...event.currentTarget.querySelectorAll(kind)];
    const next = all[all.indexOf(event.target.closest(kind)) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  const changeSummary = review?.latestChangeSummary?.changes || [];
  const sidePanels = (
    <>
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
            <button type="button" className="rc-btn rc-btn-outline rc-btn-block rc-mt-s"
              disabled={!chosenSuggestions.size || Boolean(pending)} onClick={requestAdopt}>
              {pending === 'adopt' ? '處理中…' : chosenSuggestions.size ? `採納 ${chosenSuggestions.size} 項建議` : '勾選建議後採納'}
            </button>
            {chosenSuggestions.size > 0 && <p className="rc-reason rc-mt-xs">採納後系統重排講稿，約一分鐘</p>}
          </section>
        )}

        {changeSummary.length > 0 && state === 'script_review' && (
          <section className="rc-panel">
            <h2 className="rc-section-title">這一版改了</h2>
            <ul className="rc-bullets">{changeSummary.map((change) => <li key={change}>{change}</li>)}</ul>
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
          {review?.source?.notice && <p className="rc-reason rc-reason-start">{review.source.notice}</p>}
          {view?.warnings?.map((warning) => <p key={warning} className="rc-error">{warning}</p>)}
        </section>

        {!loading && lastReject && state !== 'render_failed' && (
          <section className="rc-panel" role="status">
            <StateChip tone="mine">上一支成品已退回</StateChip>
            <p className="rc-mt-s rc-strong-text">{lastReject.map((code) => REJECT_LABEL.get(code) || code).join('、') || '未提供原因'}</p>
            <p className="rc-after rc-mt-xs">{state === 'script_review'
              ? '在下方修改講稿，確定後核准，系統會重新製作。'
              : '講稿不用改。按「開始製作」會用同一份講稿重新做一支，做好後再請你確認。'}</p>
          </section>
        )}
        {!loading && state === 'render_failed' && (
          <section className="rc-panel" role="alert">
            <StateChip tone="error">製作失敗</StateChip>
            <p className="rc-mt-s rc-strong-text">{renderFailureText(snapshot?.render)}</p>
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
              <p className="rc-external"><a href={asset.youtubeUrl} target="_blank" rel="noopener noreferrer">在 YouTube 開啟</a></p>
            )}
          </section>
        )}

        {!loading && !busy && review && (
          <section className="rc-panel" aria-label="講稿">
            <div className="rc-script-tools">
              <HelpTip title="講稿怎麼看">
                <dl className="rc-help-list">
                  <dt>短片 0:04</dt><dd>這句在短片裡從第幾秒開始。</dd>
                  <dt>原音 1:15</dt><dd>這句在課堂錄音裡的位置，按下去可以聽。</dd>
                  <dt>片頭</dt><dd>放在最前面、先講結論的一句。</dd>
                  {editable ? (
                    <>
                      <dt>灰色句子</dt><dd>沒放進短片；按「加回」放進來，按「移除」拿掉。</dd>
                      <dt>30 秒、65 秒線</dt><dd>短片要落在這兩條線之間。</dd>
                      <dt>確定修改</dt><dd>改過句子後按它，系統重排講稿約一分鐘，之後才能核准。</dd>
                      <dt>鍵盤</dt><dd>在「移除／加回」或「原音」上按上下鍵，換到上一句或下一句。</dd>
                    </>
                  ) : (
                    <>
                      <dt>灰色句子</dt><dd>沒放進短片，只是讓你看前後文。</dd>
                      {showAsset && <dt>播放成品</dt>}
                      {showAsset && <dd>播放時，講稿會標出正在播的那一句。</dd>}
                    </>
                  )}
                </dl>
              </HelpTip>
              {editable && review?.draft && (
                <button type="button" className="rc-btn-text" disabled={Boolean(pending)} onClick={() => setDialog({ type: 'restore' })}>放棄修改</button>
              )}
            </div>
            <ol className="rc-script" onKeyDown={moveBetweenLines}>
              {opening && renderLine(opening, 'opening')}
              {lines.map((line) => (line.type === 'mark' ? (
                <li key={line.id} className="rc-mark" data-sec={line.sec}><span>{line.sec} 秒</span></li>
              ) : line.type === 'gap' ? (
                <li key={line.id} className="rc-gap">
                  <button type="button" className="rc-btn-text" onClick={() => setExpandedGaps((prev) => new Set(prev).add(line.id))}>
                    展開略過的 {line.count} 句
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

      <SheetDialog open={state === 'asset_review' && rejecting} title="哪裡要改" onClose={() => setRejecting(false)}
        action={<PrimaryAction {...rejectAction} />}>
        {rejectFields}
      </SheetDialog>

      <ConfirmDialog open={dialog?.type === 'restore'} title="放棄這些修改？" confirmLabel="放棄修改" danger
        busy={pending === 'restore'} onConfirm={restoreDraft} onClose={() => setDialog(null)}>
        <p>這次加回與移除的句子都會取消，講稿回到上一次確定的版本。</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog?.type === 'confirmSuggestions'} title="這些建議會改到你調整過的句子" confirmLabel="仍要採納"
        busy={pending === 'adopt'} onConfirm={() => adopt(dialog?.ids || [])} onClose={() => setDialog(null)}>
        <ul className="rc-bullets">
          {openSuggestions.filter((s) => dialog?.ids?.includes(s.id)).map((s) => <li key={s.id}>{s.proposedChange || s.problem}</li>)}
        </ul>
      </ConfirmDialog>
    </>
  );
}
