import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  OPEN_SCRIPT_EVENT,
  SHORT_SCRIPT_PAGE,
  SHORT_UPLOAD_PAGE,
  consumePendingScriptOpen,
  isScriptTargetForPage,
  pickInitialCourseId,
  recallShortScriptCourse,
  rememberShortScriptCourse,
  requestOpenScript,
} from '../utils/scriptDeepLink';
import { Ic } from '../components/Icons';
import useCompactLayout from '../hooks/useCompactLayout';
import useMobileDetailView from '../hooks/useMobileDetailView';
import {
  FEEDBACK_TYPES,
  createScript,
  formatTimestamp,
  generateVersion,
  getScript,
  isFeatureDisabledError,
  latestVersion,
  listAssets,
  listCandidates,
  listCourses,
  listScripts,
  reviewScript,
} from '../services/shortScript';
import { deriveDisplayStatus, describeAssetState, findScriptAsset, groupScripts } from '../services/shortScriptStatus';
import { ARC_LABELS, renderScriptMarkdown } from '../services/shortScriptTemplate';
import {
  CollapseToggle, ConfirmDialog, EmptyRow, ErrorBanner, ScriptRows, ScriptSwitchSheet, SectionCard, StatusPill,
} from './shortScriptUi';
import { ACCENT, BODY, DIVIDER, GHOST_BTN, HEADING, MUTED, SECTION_LABEL, SMALL_BTN, describeError } from './shortScriptStyles';

// 版面：桌面與平板是左清單、右詳情兩欄（點一下就切換腳本）；手機（≤768px）改單欄，
// 點腳本後整個內容區切到詳情，並保留「切換腳本」抽屜，不用先回清單。
// 成品上傳在獨立的「成品上傳」頁（TeacherShortUploads.jsx），這裡只顯示成品摘要並導過去。
// 業務規則（建立 ≠ 生成、狀態轉換、兩種重新生成、退回後的兩條路）見
// docs/04_Features/Short_Script_Automation/decisions.md。

const MOBILE_HISTORY_KEY = 'ffShortScriptDetail';

function selectionLine(reason) {
  if (!reason) return '';
  return [
    reason.selectedBy === 'teacher' ? '教師指定' : '系統自動選題',
    reason.rank ? `排名第 ${reason.rank}` : '',
    `${reason.uniqueAskerCount} 人問過`,
    `共 ${reason.totalAskCount} 次`,
    `證據 ${reason.evidenceCount} 筆`,
  ].filter(Boolean).join(' · ');
}

export default function TeacherShortScripts({ onNav }) {
  const compact = useCompactLayout();
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [scripts, setScripts] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [assets, setAssets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [metaphorIndex, setMetaphorIndex] = useState(0);
  // 教師選定要做的候選主題。不選就照 DR-12 的排序自動選第一個通過證據檢查的。
  const [pickedTopicKey, setPickedTopicKey] = useState('');
  // 中等寬度以下（側欄自動收合時）候選主題預設收合，讓腳本清單留在第一屏。
  const [candidatesOpen, setCandidatesOpen] = useState(() => !window.matchMedia('(max-width: 1100px)').matches);
  const [othersOpen, setOthersOpen] = useState(true);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  // 「這版不要」面板：不是審核關卡（沒有腳本審核），只是重新生成前讓教師講一句哪裡不對。
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenType, setRegenType] = useState(FEEDBACK_TYPES[0].value);
  const [regenNote, setRegenNote] = useState('');
  const [confirm, setConfirm] = useState(null); // null | 'dismiss' | 'regenPublished'
  const [dismissNote, setDismissNote] = useState('');
  const [confirmError, setConfirmError] = useState('');
  // 手機單欄：list＝清單（新腳本＋分組），detail＝詳情。
  const { mobileView, setMobileView, showDetail, backToList } = useMobileDetailView(compact, MOBILE_HISTORY_KEY);
  const [switchOpen, setSwitchOpen] = useState(false);
  const switchButtonRef = useRef(null);

  // A notification may ask this page to open one script (see utils/scriptDeepLink).
  const [initialOpen] = useState(() => consumePendingScriptOpen(SHORT_SCRIPT_PAGE));
  const pendingOpenRef = useRef(initialOpen);
  const openRef = useRef(null);
  const courseIdRef = useRef('');

  useEffect(() => {
    listCourses()
      .then((list) => {
        setCourses(list);
        setCourseId(pickInitialCourseId(list, {
          requestedId: pendingOpenRef.current?.courseId,
          rememberedId: recallShortScriptCourse(),
        }));
      })
      .catch((requestError) => setError(`課程清單載入失敗：${describeError(requestError)}`));
  }, []);

  useEffect(() => {
    courseIdRef.current = courseId;
    // 與成品上傳頁共用目前的課程，切換頁面時不必重選。
    rememberShortScriptCourse(courseId);
  }, [courseId]);

  useEffect(() => {
    function onOpenScript(event) {
      const target = event.detail || {};
      // 只接手指定給腳本頁的請求；給成品上傳頁的留在 sessionStorage 等那一頁掛載。
      if (!isScriptTargetForPage(target, SHORT_SCRIPT_PAGE)) return;
      consumePendingScriptOpen(SHORT_SCRIPT_PAGE);
      if (!target.courseId || target.courseId === courseIdRef.current) {
        void openRef.current?.(target.scriptId);
        return;
      }
      // Switch course first; the refresh effect opens the script once the list loads.
      pendingOpenRef.current = target;
      setCourseId(target.courseId);
    }
    window.addEventListener(OPEN_SCRIPT_EVENT, onOpenScript);
    return () => window.removeEventListener(OPEN_SCRIPT_EVENT, onOpenScript);
  }, []);

  // clearError=false 用在操作之後的重讀：不能把剛顯示的操作錯誤蓋掉。
  const refresh = useCallback(async ({ clearError = true } = {}) => {
    if (!courseId) return courseId;

    setLoading(true);
    if (clearError) setError('');
    try {
      const [scriptList, candidateResult, assetList] = await Promise.all([
        listScripts(courseId),
        listCandidates(courseId),
        listAssets(courseId),
      ]);
      setScripts(scriptList);
      setCandidates(candidateResult.candidates);
      setAssets(assetList);
      setFeatureDisabled(false);
    } catch (requestError) {
      // 功能未啟用與一般錯誤要分開告知，否則教師只會看到「找不到」而不知原因。
      if (isFeatureDisabledError(requestError)) setFeatureDisabled(true);
      else setError(describeError(requestError));
    } finally {
      setLoading(false);
    }
    return courseId;
  }, [courseId]);

  useEffect(() => {
    setSelected(null);
    setPickedTopicKey('');
    setMobileView('list');
    refresh().then((loadedCourseId) => {
      const pending = pendingOpenRef.current;
      if (pending && (!pending.courseId || pending.courseId === loadedCourseId)) {
        pendingOpenRef.current = null;
        void openRef.current?.(pending.scriptId);
      }
    });
  }, [refresh, setMobileView]);

  const version = latestVersion(selected);
  const status = selected ? deriveDisplayStatus(selected, assets) : null;
  const groups = useMemo(() => groupScripts(scripts, assets), [scripts, assets]);
  const currentAsset = selected ? findScriptAsset(selected._id, assets) : null;
  const markdown = useMemo(
    () => (selected && version ? renderScriptMarkdown(selected, version, metaphorIndex) : ''),
    [selected, version, metaphorIndex],
  );

  async function loadScript(scriptId) {
    setError('');
    setCopied(false);
    setMetaphorIndex(0);
    setRegenOpen(false);
    setRegenNote('');
    setDismissNote('');
    try {
      setSelected(await getScript(scriptId));
      return true;
    } catch (requestError) {
      setError(describeError(requestError));
      return false;
    }
  }

  async function openScript(scriptId) {
    showDetail();
    await loadScript(scriptId);
  }

  useEffect(() => {
    openRef.current = openScript;
  });

  async function reloadAfterChange() {
    if (selected) {
      try { setSelected(await getScript(selected._id)); } catch { /* 清單重讀時會顯示錯誤 */ }
    }
    await refresh({ clearError: false });
  }

  async function handleCreate() {
    setBusy('create');
    setError('');
    try {
      // 教師選了主題就做那一題；沒選就交給排序規則。建立只凍結證據，還不會產生腳本文字。
      const created = await createScript(courseId, pickedTopicKey || null);
      setPickedTopicKey('');
      await refresh({ clearError: false });
      if (created?._id) await openScript(created._id);
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setBusy('');
    }
  }

  async function handleGenerate() {
    setBusy('generate');
    setError('');
    try {
      setSelected(await generateVersion(selected._id));
      await refresh({ clearError: false });
    } catch (requestError) {
      setError(`生成失敗：${describeError(requestError)}`);
      await refresh({ clearError: false });
    } finally {
      setBusy('');
    }
  }

  // generated／approved 不能直接重生（狀態機沒有 generated → generated），要先帶著回饋退回再生成；
  // changes_requested 的回饋已經在最新一版裡，直接生成即可，不要求重填。
  async function handleRegenerate() {
    if (selected.status === 'changes_requested') return handleGenerate();

    const note = regenNote.trim();
    if (!note) {
      setError('請先寫一句哪裡不對，重新生成才有依據。');
      return null;
    }

    setBusy('generate');
    setError('');
    try {
      await reviewScript(selected._id, { decision: 'request_changes', feedback: note, feedbackType: regenType });
    } catch (requestError) {
      // 退回沒成功：回饋與類型都留在面板上，可以直接再送。
      setError(describeError(requestError));
      setBusy('');
      return null;
    }
    try {
      setSelected(await generateVersion(selected._id));
      setRegenOpen(false);
      setRegenNote('');
      await refresh({ clearError: false });
    } catch (requestError) {
      // 退回已成功、生成失敗：腳本停在 changes_requested，回饋已保存在最新一版。
      setRegenOpen(false);
      await reloadAfterChange();
      setError(`回饋已儲存，但重新生成失敗：${describeError(requestError)}。可直接按「依回饋重新生成」再試，不必重填。`);
    } finally {
      setBusy('');
    }
    return null;
  }

  async function handleDismiss() {
    setBusy('dismiss');
    setConfirmError('');
    try {
      setSelected(await reviewScript(selected._id, { decision: 'dismiss', feedback: dismissNote.trim() || undefined }));
      setConfirm(null);
      setDismissNote('');
      await refresh({ clearError: false });
    } catch (requestError) {
      setConfirmError(describeError(requestError));
    } finally {
      setBusy('');
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
    } catch {
      // 部分瀏覽器在非 HTTPS 或未授權時會拒絕剪貼簿寫入；此時請教師手動選取。
      setError('瀏覽器拒絕寫入剪貼簿，請手動選取下方內容複製。');
    }
  }

  // 成品上傳在獨立頁面：帶著這份腳本過去，那一頁會直接選中它。
  const goToUploads = () => {
    requestOpenScript({ scriptId: selected._id, courseId, page: SHORT_UPLOAD_PAGE });
    onNav?.('shortUploads');
  };
  // 每個階段只有一個主要按鈕：操作區已有主要按鈕（或兩條路並列）時，正文的「複製完整腳本」降為次要。
  const actionHasPrimary = Boolean(status) && (
    ['to_film', 'upload_failed', 'asset_rejected', 'changes_requested'].includes(status.key)
    || (status.key === 'in_review' && Boolean(onNav))
    || regenOpen
  );

  if (featureDisabled) {
    return (
      <div className="fu scrl ss-page">
        <div className="card" style={{ padding: 32, maxWidth: 620 }}>
          <div style={{ ...HEADING, fontSize: 14, marginBottom: 10 }}>此功能尚未啟用</div>
          <div style={BODY}>
            後端的 <code>SHORT_SCRIPT_AUTOMATION_ENABLED</code> 為 <code>false</code>，整組短影片腳本路由回 404。
            在後端 <code>.env</code> 設成 <code>true</code> 並重啟後重新整理。
          </div>
          <div style={{ ...MUTED, marginTop: 10, lineHeight: 1.7 }}>部署環境的 <code>.env</code> 不進版控，本機可跑不代表伺服器可跑。</div>
        </div>
      </div>
    );
  }

  const pickedCandidate = candidates.find((candidate) => candidate.topicKey === pickedTopicKey);
  const showList = !compact || mobileView === 'list';
  const showDetailPane = !compact || mobileView === 'detail';

  // ── 左欄：新腳本、需要我處理、等待中／已完成 ──
  const listColumn = (
    <div className="ss-col">
      <SectionCard
        title="新腳本"
        action={<CollapseToggle open={candidatesOpen} controls="ss-candidates" label={`候選主題 · ${candidates.length}`} onClick={() => setCandidatesOpen((open) => !open)} />}
      >
        {candidatesOpen && (
          <div id="ss-candidates">
            <div style={{ padding: '12px 20px', borderBottom: candidates.length ? DIVIDER : 'none', ...MUTED, lineHeight: 1.7 }}>
              點一題指定要做；不指定就依「幾個人問過 → 問過幾次」自動選第一個證據足夠的。
            </div>
            {!candidates.length ? (
              <EmptyRow>{loading ? '載入中…' : '沒有符合條件的候選主題'}</EmptyRow>
            ) : candidates.map((candidate, index) => {
              const picked = pickedTopicKey === candidate.topicKey;
              return (
                <button
                  key={candidate.topicKey}
                  type="button"
                  className={`ss-row ss-candidate${picked ? ' active' : ''}`}
                  aria-pressed={picked}
                  style={{ borderBottom: index === candidates.length - 1 ? 'none' : DIVIDER }}
                  onClick={() => setPickedTopicKey(picked ? '' : candidate.topicKey)}
                >
                  <span className={`ss-rank${picked ? ' picked' : ''}`} aria-hidden="true">
                    {picked ? <Ic n="check" s={12} /> : index + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="ss-row-title" style={{ fontWeight: 500 }}>{candidate.question}</span>
                    <span className="ss-row-next">
                      {candidate.uniqueAskerCount} 人問過 · 共 {candidate.totalAskCount} 次 · 合併 {candidate.variants?.length || 1} 種問法
                      {picked ? ' · 已選定' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="ss-create">
          {pickedCandidate && (
            <div style={{ ...BODY, marginBottom: 8 }}>
              選定主題：<strong style={{ color: '#fff' }}>{pickedCandidate.question}</strong>
              {' '}<button type="button" className="ss-text-btn" onClick={() => setPickedTopicKey('')}>取消選定</button>
            </div>
          )}
          <button
            type="button"
            className="btn-primary"
            style={SMALL_BTN}
            disabled={!courseId || Boolean(busy)}
            onClick={handleCreate}
          >
            <Ic n="plus" s={13} />
            {busy === 'create' ? '建立中…（凍結證據）' : (pickedTopicKey ? '用選定主題建立腳本（固定證據）' : '自動選題建立腳本（固定證據）')}
          </button>
          <div style={{ ...MUTED, marginTop: 8, lineHeight: 1.7 }}>
            建立只會凍結證據，還沒有腳本文字；下一步再「生成腳本」（約 30–45 秒）。
            建立後這個主題會<strong style={{ color: 'rgba(255,255,255,0.8)' }}>永久離開候選清單</strong>，之後否決也不會回來。
          </div>
        </div>
      </SectionCard>

      <SectionCard title={`需要我處理 · ${groups.action.length}`}>
        <ScriptRows rows={groups.action} selectedId={selected?._id} onOpen={openScript} empty={loading ? '載入中…' : '目前沒有需要處理的腳本'} />
      </SectionCard>

      <SectionCard
        title={`等待中／已完成 · ${groups.others.length}`}
        action={<CollapseToggle open={othersOpen} controls="ss-others" onClick={() => setOthersOpen((open) => !open)} />}
      >
        {othersOpen && (
          <div id="ss-others">
            <ScriptRows rows={groups.others} selectedId={selected?._id} onOpen={openScript} empty={loading ? '載入中…' : '沒有等待中或已完成的腳本'} />
          </div>
        )}
      </SectionCard>
    </div>
  );

  // ── 依狀態出現的主要操作區：每個階段只有一個主要按鈕 ──
  function renderActionArea() {
    const generating = busy === 'generate';
    const dismissButton = selected.status !== 'dismissed' && (
      <button type="button" className="btn-primary" style={GHOST_BTN} disabled={Boolean(busy)} onClick={() => { setConfirmError(''); setConfirm('dismiss'); }}>
        不做這一題
      </button>
    );

    if (selected.status === 'evidence_ready') {
      return (
        <div className="ss-action">
          <div style={BODY}>證據已凍結，還沒有腳本文字。先核對下方的選題理由與證據對照表，確認沒問題再生成。</div>
          <div className="ss-actions">
            <button type="button" className="btn-primary" style={SMALL_BTN} disabled={Boolean(busy)} onClick={handleGenerate}>
              <Ic n="spark" s={13} /> {generating ? '生成中（約 30–45 秒）…' : '生成腳本'}
            </button>
            {dismissButton}
          </div>
          {generating && <div role="status" style={MUTED}>正在生成，請勿關閉頁面；完成後會自動顯示腳本。</div>}
        </div>
      );
    }

    if (selected.status === 'changes_requested') {
      const typeLabel = FEEDBACK_TYPES.find((type) => type.value === version?.feedbackType)?.label || version?.feedbackType;
      return (
        <div className="ss-action">
          <div className="card-sm ss-feedback">
            <div style={SECTION_LABEL}>
              {version?.rejectedAsAsset ? '成品審核退回' : '教師退回'} · 第 {version?.versionNo} 版{typeLabel ? ` · ${typeLabel}` : ''}
            </div>
            <div style={{ ...BODY, marginTop: 4 }}>{version?.feedback || '（沒有填寫理由）'}</div>
          </div>
          <div style={MUTED}>兩條路都可以，依實際情況自己選：</div>
          <div className="ss-paths">
            <div className="card-sm ss-path">
              <div style={{ ...HEADING, fontSize: 13.5 }}>(a) 依回饋重新生成腳本</div>
              <div style={{ ...BODY, flex: 1 }}>產生第 {(version?.versionNo || 0) + 1} 版腳本，之後依新版重拍並上傳。回饋已保存，不用重填。</div>
              <button type="button" className="btn-primary" style={GHOST_BTN} disabled={Boolean(busy)} onClick={handleRegenerate}>
                <Ic n="sync" s={13} /> {generating ? '重新生成中（約 30–45 秒）…' : '依回饋重新生成'}
              </button>
            </div>
            <div className="card-sm ss-path">
              <div style={{ ...HEADING, fontSize: 13.5 }}>(b) 腳本沒問題，只重錄或重剪影片</div>
              <div style={{ ...BODY, flex: 1 }}>不重新生成，到「成品上傳」頁用目前的第 {version?.versionNo} 版重傳；審核通過後就上架。</div>
              <button type="button" className="btn-primary" style={GHOST_BTN} disabled={Boolean(busy)} onClick={goToUploads}>
                <Ic n="up" s={13} /> 前往成品上傳頁（第 {version?.versionNo} 版）
              </button>
            </div>
          </div>
          <div className="ss-actions">{dismissButton}</div>
        </div>
      );
    }

    if (selected.status === 'dismissed') {
      return (
        <div className="ss-action">
          <div style={BODY}>這一題已否決，不會再生成或上傳成品。{selected.dismissReason ? `理由：${selected.dismissReason}` : ''}</div>
        </div>
      );
    }

    // generated 或 approved：有腳本正文。
    const published = selected.status === 'approved';
    const regenButton = (
      <button
        type="button"
        className="btn-primary"
        style={GHOST_BTN}
        disabled={Boolean(busy)}
        onClick={() => (published ? setConfirm('regenPublished') : setRegenOpen((open) => !open))}
      >
        <Ic n="sync" s={13} /> 這版不要，重新生成{published ? '…' : ''}
      </button>
    );
    const nextHint = {
      to_film: '腳本已生成。複製完整腳本去拍攝，拍完到「成品上傳」頁上傳送審。',
      uploading: '成品正在傳上 YouTube，傳完就能到「短影片審核」看片審核。',
      upload_failed: '成品傳送失敗，可到「成品上傳」頁重試。',
      upload_needs_admin: '成品傳送失敗，需由管理員確認 YouTube 是否已收到，處理後會自動更新。',
      in_review: '成品已傳上 YouTube（非公開），等待審核；審核通過後學生才看得到。',
      approved_waiting_upload: '成品已審核通過，影片傳完後會自動上架。',
      asset_rejected: '成品已被退回。可以到「成品上傳」頁重傳，或重新生成腳本。',
      published: '已上架：審核通過的成品已在學生的短影片牆。',
    }[status.key];

    return (
      <div className="ss-action">
        {nextHint && <div style={BODY}>{nextHint}</div>}
        <div className="ss-actions">
          {status.key === 'to_film' && (
            <button type="button" className="btn-primary" style={regenOpen ? GHOST_BTN : SMALL_BTN} onClick={handleCopy}>
              <Ic n="check" s={13} /> {copied ? '已複製到剪貼簿' : '複製完整腳本'}
            </button>
          )}
          {['upload_failed', 'asset_rejected'].includes(status.key) && (
            <button type="button" className="btn-primary" style={regenOpen ? GHOST_BTN : SMALL_BTN} onClick={goToUploads}>
              <Ic n="up" s={13} /> 前往成品上傳
            </button>
          )}
          {status.key === 'in_review' && onNav && (
            <button type="button" className="btn-primary" style={regenOpen ? GHOST_BTN : SMALL_BTN} onClick={() => onNav('reviewShorts')}>
              <Ic n="play" s={13} /> 前往短影片審核
            </button>
          )}
          {!published && regenButton}
          {!published && dismissButton}
        </div>
        {published && (
          <div className="ss-actions ss-secondary">
            <span style={MUTED}>其他操作：</span>
            {regenButton}
            {dismissButton}
          </div>
        )}
        {regenOpen && (
          <div className="card-sm" style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.03)' }}>
            <div className="ss-chips" role="radiogroup" aria-label="哪裡不對">
              {FEEDBACK_TYPES.map((type) => {
                const on = regenType === type.value;
                return (
                  <button key={type.value} type="button" role="radio" aria-checked={on} className={`ss-chip${on ? ' on' : ''}`} onClick={() => setRegenType(type.value)}>
                    {type.label}
                  </button>
                );
              })}
            </div>
            <div style={{ ...MUTED, marginTop: 6 }}>{FEEDBACK_TYPES.find((type) => type.value === regenType)?.hint}</div>
            <textarea
              className="ff-input ss-field"
              rows={2}
              aria-label="哪裡不對"
              placeholder="一句話：哪裡不對？"
              value={regenNote}
              style={{ marginTop: 10, resize: 'vertical' }}
              onChange={(event) => setRegenNote(event.target.value)}
            />
            <div className="ss-actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn-primary" style={SMALL_BTN} disabled={Boolean(busy)} onClick={handleRegenerate}>
                {generating ? '重新生成中（約 30–45 秒）…' : '退回並重新生成'}
              </button>
              <button type="button" className="btn-primary" style={GHOST_BTN} disabled={generating} onClick={() => setRegenOpen(false)}>取消</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderScriptBody() {
    const evidence = selected.evidence || [];
    const evidenceDetails = (
      <details className="ss-details" open={selected.status === 'evidence_ready'} key={`${selected._id}-${selected.status}`}>
        <summary className="ss-summary">證據對照表 · 未修飾的逐字稿原文（{evidence.length} 筆）</summary>
        <div style={{ padding: '0 20px 16px' }}>
          {evidence.map((item) => (
            <div key={item.chunkId} style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: ACCENT, fontSize: 13, fontWeight: 700 }}>[{item.code}]</span>
                <span style={MUTED}>
                  {formatTimestamp(item.startSec)}–{formatTimestamp(item.endSec)}
                  {item.expandedFrom ? ' · 鄰接擴展' : ' · 檢索命中'}
                </span>
              </div>
              <div className="ss-wrap" style={{ ...BODY, marginTop: 3 }}>{item.rawText}</div>
            </div>
          ))}
        </div>
      </details>
    );

    if (!version) return evidenceDetails;

    const options = version.payload.visualMetaphorOptions || [];
    const option = options[metaphorIndex];
    const meanings = version.payload.stageMeanings;

    return (
      <>
        <div style={{ padding: '16px 20px', borderBottom: DIVIDER }}>
          <div className="ss-body-head">
            <div style={SECTION_LABEL}>完整腳本 · 第 {version.versionNo} 版</div>
            <button type="button" className="btn-primary" style={actionHasPrimary ? GHOST_BTN : SMALL_BTN} onClick={handleCopy}>
              <Ic n="check" s={13} /> {copied ? '已複製到剪貼簿' : '複製完整腳本'}
            </button>
          </div>
          <textarea
            className="ff-input ss-script-text"
            readOnly
            aria-label="完整腳本（唯讀）"
            value={markdown}
            rows={18}
            onFocus={(event) => event.target.select()}
          />
          <div style={{ ...MUTED, marginTop: 6 }}>
            複製內容使用目前選的視覺隱喻：{option?.label || '—'}
          </div>
        </div>

        <details className="ss-details">
          <summary className="ss-summary">視覺隱喻 · 目前：{option?.label || '—'}（會寫進複製內容）</summary>
          <div style={{ padding: '0 20px 16px' }}>
            <div className="ss-chips" role="radiogroup" aria-label="視覺隱喻">
              {options.map((item, index) => {
                const on = metaphorIndex === index;
                return (
                  <button key={item.label} type="button" role="radio" aria-checked={on} className={`ss-chip${on ? ' on' : ''}`} onClick={() => { setMetaphorIndex(index); setCopied(false); }}>
                    {item.label}
                  </button>
                );
              })}
            </div>
            {option && meanings && (
              <div style={{ marginTop: 12 }}>
                {['s1', 's2', 's3'].map((key) => (
                  <div key={key} className="ss-wrap" style={BODY}>
                    <span style={{ color: ACCENT, fontWeight: 700 }}>{key.toUpperCase()}</span>{' '}{option[key]}
                    <span style={MUTED}>{' '}＝ {meanings[key]}</span>
                  </div>
                ))}
                {option.rationale && <div style={{ ...MUTED, marginTop: 6, lineHeight: 1.7 }}>為什麼用這個隱喻：{option.rationale}</div>}
              </div>
            )}
          </div>
        </details>

        {evidenceDetails}

        <details className="ss-details">
          <summary className="ss-summary">分鏡 · 第 {version.versionNo} 版（{version.payload.shots.length} 鏡）</summary>
          <div style={{ padding: '0 20px 16px' }}>
            {version.payload.shots.map((shot) => (
              <div key={shot.shotNo} className="ss-wrap" style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>鏡 {String(shot.shotNo).padStart(2, '0')}</span>
                  <span style={MUTED}>{ARC_LABELS[shot.arcRole] || shot.arcRole} · {shot.timeRange}</span>
                </div>
                <div style={{ ...BODY, marginTop: 3 }}>{shot.narration}</div>
                <div style={{ ...MUTED, marginTop: 2 }}>字幕：{shot.subtitle}</div>
                {shot.brollStage && <div style={MUTED}>素材：{shot.brollStage}{shot.brollNote ? `（${shot.brollNote}）` : ''}</div>}
                {shot.cut && <div style={MUTED}>剪輯：{shot.cut}{shot.hookQuestion ? `｜埋問題：${shot.hookQuestion}` : ''}</div>}
                <div style={MUTED}>依據：{shot.basedOn === 'template' ? 'template' : (shot.basedOn || []).join('、')}</div>
              </div>
            ))}
          </div>
        </details>
      </>
    );
  }

  function renderAssetSummary() {
    const state = describeAssetState(currentAsset);
    return (
      <div className="ss-asset-summary">
        <span style={MUTED}>
          成品：{state ? `審核 ${state.review} · ${state.youtube} · ${state.students}` : '尚未上傳'}
        </span>
        {selected.status !== 'dismissed' && version && (
          <button type="button" className="ss-text-btn" onClick={goToUploads}>前往成品上傳 →</button>
        )}
      </div>
    );
  }

  const detailPane = (
    <div className="card ss-detail" style={{ overflow: 'hidden', minWidth: 0 }}>
      {!selected ? (
        <EmptyRow>{compact ? '請先選一份腳本' : '從左側選一份腳本查看內容'}</EmptyRow>
      ) : (
        <>
          <div className="ss-detail-head">
            {compact && (
              <div className="ss-mobile-head">
                <button type="button" className="ss-icon-btn" aria-label="返回腳本清單" onClick={backToList}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <div className="ss-mobile-title">{selected.topic}</div>
                <StatusPill status={status} />
              </div>
            )}
            {!compact && (
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <h2 style={{ ...HEADING, fontSize: 15, lineHeight: 1.5, minWidth: 0, margin: 0, overflowWrap: 'anywhere' }}>{selected.topic}</h2>
                <StatusPill status={status} />
              </div>
            )}
            {selected.selectionReason && <div style={{ ...MUTED, marginTop: 6 }}>選題來源：{selectionLine(selected.selectionReason)}</div>}
            {compact && (
              <button
                ref={switchButtonRef}
                type="button"
                className="btn-primary ss-switch-btn"
                style={GHOST_BTN}
                aria-haspopup="dialog"
                aria-expanded={switchOpen}
                onClick={() => setSwitchOpen(true)}
              >
                切換腳本 <span aria-hidden="true">▾</span>
              </button>
            )}
          </div>

          {error && <ErrorBanner style={{ margin: '16px 20px 0' }}>{error}</ErrorBanner>}

          <div style={{ padding: '16px 20px', borderBottom: DIVIDER }}>{renderActionArea()}</div>
          {renderScriptBody()}
          {renderAssetSummary()}
        </>
      )}
    </div>
  );

  return (
    <div className="fu scrl ss-page">
      {showList && (
        <div className="ss-toolbar">
          <select
            className="ff-input ss-course-select"
            aria-label="課程"
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
          >
            {!courses.length && <option value="">目前沒有可用課程</option>}
            {courses.map((course) => (
              <option key={course._id} value={course._id}>{course.title}</option>
            ))}
          </select>
          <button type="button" className="btn-primary" style={GHOST_BTN} disabled={loading} onClick={() => refresh()}>
            <Ic n="sync" s={13} /> {loading ? '載入中…' : '重新整理'}
          </button>
        </div>
      )}

      {/* 詳情面板顯示時，錯誤顯示在詳情裡（靠近操作區）；否則顯示在頁面上方。 */}
      {(!selected || !showDetailPane) && <ErrorBanner style={{ marginBottom: 16 }}>{error}</ErrorBanner>}

      {!courses.length && !error && !loading && (
        <div className="card" style={{ padding: 28, textAlign: 'center', ...MUTED }}>這個帳號目前沒有可管理的課程。</div>
      )}

      <div className="ss-layout">
        {showList && listColumn}
        {showDetailPane && detailPane}
      </div>

      {compact && switchOpen && (
        <ScriptSwitchSheet
          groups={[['需要我處理', groups.action], ['等待中／已完成', groups.others]]}
          selectedId={selected?._id}
          onSelect={(scriptId) => { setSwitchOpen(false); void loadScript(scriptId); }}
          onClose={() => setSwitchOpen(false)}
          returnFocusRef={switchButtonRef}
        />
      )}

      {confirm === 'dismiss' && selected && (
        <ConfirmDialog
          title="不做這一題？"
          confirmLabel="確定不做這一題"
          busyLabel="處理中…"
          danger
          busy={busy === 'dismiss'}
          onCancel={() => setConfirm(null)}
          onConfirm={handleDismiss}
        >
          <p>「{selected.topic}」否決後：</p>
          <ul>
            <li>無法復原，腳本會停在「已否決」。</li>
            <li>不能再生成或上傳這份腳本的成品。</li>
            <li>這個主題不會回到候選清單。</li>
            {currentAsset?.status === 'published' && <li>已上架的影片不會因此下架，學生仍看得到。</li>}
          </ul>
          <label className="ff-label" htmlFor="ss-dismiss-note">理由（選填）</label>
          <textarea
            id="ss-dismiss-note"
            className="ff-input ss-field"
            rows={2}
            value={dismissNote}
            disabled={busy === 'dismiss'}
            onChange={(event) => setDismissNote(event.target.value)}
          />
          <ErrorBanner style={{ marginTop: 10 }}>{confirmError}</ErrorBanner>
        </ConfirmDialog>
      )}

      {confirm === 'regenPublished' && selected && (
        <ConfirmDialog
          title="已上架的腳本要重新生成？"
          confirmLabel="繼續，填寫哪裡不對"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); setRegenOpen(true); }}
        >
          <p>這個操作會把腳本改回「需修改」並記下你的回饋，接著生成新一版。對已發布的影片：</p>
          <ul>
            <li>目前上架的影片<strong>不會下架</strong>，學生仍看得到，YouTube 上的影片也不變。</li>
            <li>依新版重拍上傳後會建立<strong>另一支成品</strong>；它審核通過後也會進學生的短影片牆，原本那支不會自動下架。</li>
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}
