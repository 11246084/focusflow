import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import BottomSheet from '../components/BottomSheet';
import { deriveDisplayStatus, describeAssetState, findScriptAsset, groupScripts } from '../services/shortScriptStatus';
import { ARC_LABELS, renderScriptMarkdown } from '../services/shortScriptTemplate';
import { pickInitialTab, recallTab, rememberTab } from '../utils/shortScriptTabs';
import { FlowBar, NextStepCard, StartGuide } from './shortScriptGuide';
import {
  ConfirmDialog, Disclosure, EmptyRow, ErrorBanner, ScriptRows, ScriptSwitchSheet, StatusPill, StatusTabList, StatusTabPanel,
} from './shortScriptUi';
import { ACCENT, BODY, DIVIDER, GHOST_BTN, HEADING, MUTED, SECTION_LABEL, SMALL_BTN, describeError } from './shortScriptStyles';

// 版面：一個面板，頂部是課程、重新整理與「＋ 新腳本」；桌面與平板是左清單（狀態分頁）、右詳情兩欄，
// 手機（≤768px）改單欄，點腳本後整個內容區切到詳情，並保留「切換腳本」抽屜，不用先回清單。
// 新腳本（候選主題與建立）在桌面佔用右欄、在手機用底部抽屜，只在按「＋ 新腳本」後出現。
// 上傳成品在獨立的「上傳短片」頁（TeacherShortUploads.jsx），這裡只顯示成品摘要並導過去。
// 業務規則（建立 ≠ 生成、狀態轉換、兩種重新生成、退回後的兩條路）見
// docs/04_Features/Short_Script_Automation/decisions.md。

const MOBILE_HISTORY_KEY = 'ffShortScriptDetail';
const TAB_KEYS = ['action', 'waiting', 'published', 'dismissed'];
const TAB_EMPTY = {
  action: '目前沒有需要你處理的腳本',
  waiting: '沒有等待中的腳本',
  published: '還沒有已上架的腳本',
  dismissed: '沒有已否決的腳本',
};

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
  // 目前的狀態分頁；null 表示還沒選，依記住的分頁或資料決定（utils/shortScriptTabs）。
  const [tab, setTab] = useState(null);
  // 「＋ 新腳本」檢視：桌面佔用右欄，手機是底部抽屜。
  const [newOpen, setNewOpen] = useState(false);
  // 證據對照表預設收起；待生成時操作區的「點開核對證據」會打開它。
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const newButtonRef = useRef(null);
  const newHeadingRef = useRef(null);
  const tabsIdBase = useId();

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
  // 手機單欄：list＝清單（狀態分頁），detail＝詳情。
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
    // 與上傳短片頁共用目前的課程，切換頁面時不必重選。
    rememberShortScriptCourse(courseId);
  }, [courseId]);

  useEffect(() => {
    function onOpenScript(event) {
      const target = event.detail || {};
      // 只接手指定給腳本頁的請求；給上傳短片頁的留在 sessionStorage 等那一頁掛載。
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
    setTab(null);
    setNewOpen(false);
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
  const rememberedTab = useMemo(() => recallTab(SHORT_SCRIPT_PAGE, courseId), [courseId]);
  const activeTab = tab ?? pickInitialTab(TAB_KEYS, {
    action: groups.action.length, waiting: groups.waiting.length, published: groups.published.length, dismissed: groups.dismissed.length,
  }, rememberedTab);
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
    setEvidenceOpen(false);
    try {
      setSelected(await getScript(scriptId));
      return true;
    } catch (requestError) {
      setError(describeError(requestError));
      return false;
    }
  }

  async function openScript(scriptId) {
    setNewOpen(false);
    showDetail();
    await loadScript(scriptId);
  }

  // 桌面與平板：關閉腳本詳情，右欄回到「建議下一步」，焦點回到清單裡原本選中的那一列。
  function closeDetail() {
    const previousId = selected?._id;
    setSelected(null);
    if (previousId) {
      requestAnimationFrame(() => {
        document.querySelector(`.ss-list-pane .ss-row[data-script-id="${previousId}"]`)?.focus();
      });
    }
  }

  useEffect(() => {
    openRef.current = openScript;
  });

  // 桌面打開「新腳本」檢視時把焦點移到標題，鍵盤與螢幕閱讀器使用者知道右欄換了內容。
  useEffect(() => {
    if (newOpen && !compact) newHeadingRef.current?.focus();
  }, [newOpen, compact]);

  // Esc 關閉腳本詳情（桌面與平板）；有確認視窗開著時交給它自己處理 Esc。
  useEffect(() => {
    if (!selected || compact || confirm) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') closeDetail();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, compact, confirm]);

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
      setNewOpen(false);
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

  // 上傳短片在獨立頁面：帶著這份腳本過去，那一頁會直接選中它。
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
  const tabs = [
    { key: 'action', label: '需要你處理', icon: 'alert', count: groups.action.length, rows: groups.action },
    { key: 'waiting', label: '等待中', icon: 'hourglass', count: groups.waiting.length, rows: groups.waiting, hint: '這些在等影片傳送或審核，你不需要動作。' },
    { key: 'published', label: '已上架', icon: 'checkCircle', count: groups.published.length, rows: groups.published },
    { key: 'dismissed', label: '已否決', icon: 'ban', count: groups.dismissed.length, rows: groups.dismissed },
  ];
  const currentTab = tabs.find((item) => item.key === activeTab) || tabs[0];

  function chooseTab(key) {
    setTab(key);
    rememberTab(SHORT_SCRIPT_PAGE, courseId, key);
  }

  function openNewScript() {
    setError('');
    if (newOpen && !compact) newHeadingRef.current?.focus();
    else setNewOpen(true);
  }

  function closeNewScript() {
    setNewOpen(false);
    newButtonRef.current?.focus();
  }

  // 待生成時「點開核對證據」：展開證據對照表並捲過去，焦點放在它的標題列。
  function openEvidence() {
    setEvidenceOpen(true);
    requestAnimationFrame(() => {
      const head = document.querySelector('#ss-evidence .ss-disclosure-head');
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      head?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      head?.focus({ preventScroll: true });
    });
  }

  // ── 面板頂部：課程、重新整理、＋ 新腳本 ──
  const panelBar = (
    <div className="ss-panel-bar">
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
      <button type="button" className="ss-icon-btn" aria-label={loading ? '載入中' : '重新整理'} title="重新整理" disabled={loading} onClick={() => refresh()}>
        <Ic n="sync" s={16} />
      </button>
      <span className="ss-bar-spacer" />
      <button ref={newButtonRef} type="button" className="btn-primary" style={SMALL_BTN} disabled={!courseId} onClick={openNewScript}>
        <Ic n="plus" s={13} /> 新腳本
      </button>
    </div>
  );

  // ── 分頁列：橫跨整個面板，放在課程選擇那一列下方 ──
  const tabsBar = <StatusTabList idBase={tabsIdBase} tabs={tabs} active={currentTab.key} onChange={chooseTab} label="腳本狀態" />;

  // ── 左欄：清單（說明文字放在清單頂端，不放在分頁列裡） ──
  const listColumn = (
    <div className="ss-pane ss-list-pane">
      <StatusTabPanel idBase={tabsIdBase} tab={currentTab}>
        <ScriptRows rows={currentTab.rows} selectedId={selected?._id} onOpen={openScript} empty={loading ? '載入中…' : TAB_EMPTY[currentTab.key]} />
      </StatusTabPanel>
    </div>
  );

  // ── 新腳本：候選主題、建立按鈕與說明（桌面在右欄，手機在底部抽屜） ──
  function renderNewScript() {
    return (
      <div className="ss-new">
        {!compact && (
          <div className="ss-new-head">
            <h2 ref={newHeadingRef} tabIndex={-1} style={{ ...HEADING, margin: 0 }}>新腳本</h2>
            <button type="button" className="ss-icon-btn" aria-label="關閉新腳本" onClick={closeNewScript}>
              <Ic n="x" s={16} />
            </button>
          </div>
        )}
        <div className="ss-new-intro">
          {candidates.length ? (
            <>
              <div style={SECTION_LABEL}>候選主題 · {candidates.length}</div>
              <div style={{ ...MUTED, marginTop: 6, lineHeight: 1.7 }}>
                點一題指定要做；不指定就依「幾個人問過 → 問過幾次」自動選第一個證據足夠的。
              </div>
            </>
          ) : (
            <div style={BODY}>
              目前沒有候選主題。候選主題來自學生在這門課的提問，同一個問題被問到一定次數後才會出現在這裡。
              仍可以按下方「自動選題建立腳本」，沒有符合條件的主題時會顯示原因。
            </div>
          )}
        </div>
        {candidates.length > 0 && (
          <div role="group" aria-label="候選主題">
            {candidates.map((candidate, index) => {
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
          <ErrorBanner style={{ marginTop: 12 }}>{error}</ErrorBanner>
        </div>
      </div>
    );
  }

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
            {!evidenceOpen && (
              <button type="button" className="btn-primary" style={GHOST_BTN} onClick={openEvidence}>
                點開核對證據（{selected.evidence?.length || 0} 筆）
              </button>
            )}
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
              <div style={{ ...BODY, flex: 1 }}>不重新生成，到「上傳短片」頁用目前的第 {version?.versionNo} 版重傳；審核通過後就上架。</div>
              <button type="button" className="btn-primary" style={GHOST_BTN} disabled={Boolean(busy)} onClick={goToUploads}>
                <Ic n="shortUp" s={13} /> 前往上傳短片頁（第 {version?.versionNo} 版）
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
      to_film: '腳本已生成。複製完整腳本去拍攝，拍完到「上傳短片」頁上傳送審。',
      uploading: '成品正在傳上 YouTube，傳完就能到「短影片審核」看片審核。',
      upload_failed: '成品傳送失敗，可到「上傳短片」頁重試。',
      upload_needs_admin: '成品傳送失敗，需由管理員確認 YouTube 是否已收到，處理後會自動更新。',
      in_review: '成品已傳上 YouTube（非公開），等待審核；審核通過後學生才看得到。',
      approved_waiting_upload: '成品已審核通過，影片傳完後會自動上架。',
      asset_rejected: '成品已被退回。可以到「上傳短片」頁重傳，或重新生成腳本。',
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
              <Ic n="shortUp" s={13} /> 前往上傳短片
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
      <Disclosure id="ss-evidence" title="證據對照表" count={`${evidence.length} 筆`} open={evidenceOpen} onToggle={setEvidenceOpen}>
        <div style={MUTED}>未修飾的逐字稿原文。</div>
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
      </Disclosure>
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

        <Disclosure key={`${selected._id}-metaphor`} title="視覺隱喻" count={`${options.length} 組（目前：${option?.label || '—'}，會寫進複製內容）`}>
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
        </Disclosure>

        {evidenceDetails}

        <Disclosure key={`${selected._id}-shots`} title="分鏡" count={`${version.payload.shots.length} 鏡`}>
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
        </Disclosure>
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
          <button type="button" className="ss-text-btn" onClick={goToUploads}>前往上傳短片 →</button>
        )}
      </div>
    );
  }

  // 右欄還沒選腳本時的引導（只在桌面與平板；手機直接看清單）。
  function renderEmptyPane() {
    if (compact) return <EmptyRow>請先選一份腳本</EmptyRow>;
    if (loading && !scripts.length) return <EmptyRow>載入中…</EmptyRow>;
    const newButton = (
      <button type="button" className="btn-primary" style={SMALL_BTN} onClick={openNewScript}>
        <Ic n="plus" s={13} /> 新腳本
      </button>
    );
    const candidateHint = candidates.length
      ? `目前有 ${candidates.length} 個候選主題，可以按「＋ 新腳本」挑一題建立，或讓系統自動選題。`
      : '目前還沒有候選主題。候選主題來自學生在這門課的提問，同一個問題被問到一定次數後才會出現。';
    if (!scripts.length) {
      return (
        <div className="ss-guide">
          <StartGuide title="這門課還沒有短影片腳本" action={newButton}>{candidateHint}</StartGuide>
        </div>
      );
    }
    return (
      <div className="ss-guide">
        <NextStepCard row={groups.action[0]} actionLabel="打開這份腳本" onOpen={openScript}>
          <div style={BODY}>目前沒有需要你處理的腳本。{candidateHint}</div>
          <div>{newButton}</div>
        </NextStepCard>
      </div>
    );
  }

  const detailPane = (
    <div className="ss-pane ss-detail-pane">
      {newOpen && !compact ? renderNewScript() : !selected ? renderEmptyPane() : (
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
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <StatusPill status={status} />
                  <button type="button" className="ss-icon-btn" aria-label="關閉腳本詳情" onClick={closeDetail}>
                    <Ic n="x" s={16} />
                  </button>
                </span>
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
      {/* 流程說明：頁首常駐、不收合。 */}
      <FlowBar />

      {/* 詳情或新腳本檢視顯示時，錯誤顯示在裡面（靠近操作區）；否則顯示在頁面上方。 */}
      {(!selected || !showDetailPane) && !newOpen && <ErrorBanner style={{ marginBottom: 16 }}>{error}</ErrorBanner>}

      {!courses.length && !error && !loading && (
        <div className="card" style={{ padding: 28, marginBottom: 16, textAlign: 'center', ...MUTED }}>這個帳號目前沒有可管理的課程。</div>
      )}

      {/* 單一面板：頂部列＋分頁列（橫跨全寬）＋左右兩欄，欄與區塊之間只用分隔線。 */}
      <div className="card ss-panel">
        {showList && panelBar}
        {showList && tabsBar}
        <div className="ss-panel-body">
          {showList && listColumn}
          {showDetailPane && detailPane}
        </div>
      </div>

      {compact && switchOpen && (
        <ScriptSwitchSheet
          tabs={tabs}
          initialTab={currentTab.key}
          selectedId={selected?._id}
          onSelect={(scriptId) => { setSwitchOpen(false); void loadScript(scriptId); }}
          onClose={() => setSwitchOpen(false)}
          returnFocusRef={switchButtonRef}
        />
      )}

      {compact && newOpen && (
        <BottomSheet title="新腳本" onClose={closeNewScript} returnFocusRef={newButtonRef}>
          {renderNewScript()}
        </BottomSheet>
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
