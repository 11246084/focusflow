import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import useCompactLayout from '../hooks/useCompactLayout';
import useMobileDetailView from '../hooks/useMobileDetailView';
import {
  getScript,
  isFeatureDisabledError,
  latestVersion,
  listAssets,
  listCourses,
  listScripts,
} from '../services/shortScript';
import { deriveDisplayStatus, groupUploadScripts } from '../services/shortScriptStatus';
import { renderScriptMarkdown } from '../services/shortScriptTemplate';
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
import { pickInitialTab, recallTab, rememberTab } from '../utils/shortScriptTabs';
import ShortAssetPanel from './ShortAssetPanel';
import { NextStepCard, StartGuide } from './shortScriptGuide';
import {
  Disclosure, EmptyRow, ErrorBanner, ScriptRows, ScriptSwitchSheet, StatusPill, StatusTabList, StatusTabPanel,
} from './shortScriptUi';
import { BODY, DIVIDER, GHOST_BTN, HEADING, MUTED, SMALL_BTN, describeError } from './shortScriptStyles';

// 上傳短片頁（網址與 sub id 沿用 short-uploads／shortUploads）：教師依腳本拍好影片後，在這裡上傳並送審。
// 只列「影片還沒處理完」的腳本，依誰要動手分成「需要你處理」與「等待中」兩個分頁；生成與重新生成在「短影片腳本」頁。
// 版面與手機單欄做法同腳本頁，決策見 docs/04_Features/Short_Script_Automation/decisions.md。

const MOBILE_HISTORY_KEY = 'ffShortUploadDetail';
const TAB_KEYS = ['action', 'waiting'];
const WAITING_HINT = '這些在等系統或審核，你不需要動作。';

// 狀態相同，但「下一步」改成在這一頁的說法（腳本頁的說法是「到上傳短片頁…」）。
const UPLOAD_NEXT = {
  to_film: '上傳拍好的影片',
  changes_requested: '重傳同一版，或到腳本頁重新生成',
  asset_rejected: '重傳影片，或到腳本頁重新生成',
  upload_failed: '在下方按「重試上傳」',
};

function withUploadNext(status) {
  return status && UPLOAD_NEXT[status.key] ? { ...status, next: UPLOAD_NEXT[status.key] } : status;
}

export default function TeacherShortUploads({ onNav }) {
  const compact = useCompactLayout();
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [scripts, setScripts] = useState([]);
  const [assets, setAssets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const { mobileView, setMobileView, showDetail, backToList } = useMobileDetailView(compact, MOBILE_HISTORY_KEY);
  const [switchOpen, setSwitchOpen] = useState(false);
  // 目前的分頁；null 表示還沒選，依記住的分頁或資料決定（utils/shortScriptTabs）。
  const [tab, setTab] = useState(null);
  const switchButtonRef = useRef(null);
  const tabsIdBase = useId();

  // 腳本頁的「前往上傳短片」會指定要開哪一份腳本（utils/scriptDeepLink）。
  const [initialOpen] = useState(() => consumePendingScriptOpen(SHORT_UPLOAD_PAGE));
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
    rememberShortScriptCourse(courseId);
  }, [courseId]);

  useEffect(() => {
    function onOpenScript(event) {
      const target = event.detail || {};
      if (!isScriptTargetForPage(target, SHORT_UPLOAD_PAGE)) return;
      consumePendingScriptOpen(SHORT_UPLOAD_PAGE);
      if (!target.courseId || target.courseId === courseIdRef.current) {
        void openRef.current?.(target.scriptId);
        return;
      }
      pendingOpenRef.current = target;
      setCourseId(target.courseId);
    }
    window.addEventListener(OPEN_SCRIPT_EVENT, onOpenScript);
    return () => window.removeEventListener(OPEN_SCRIPT_EVENT, onOpenScript);
  }, []);

  const refresh = useCallback(async ({ clearError = true } = {}) => {
    if (!courseId) return courseId;
    setLoading(true);
    if (clearError) setError('');
    try {
      const [scriptList, assetList] = await Promise.all([listScripts(courseId), listAssets(courseId)]);
      setScripts(scriptList);
      setAssets(assetList);
      setFeatureDisabled(false);
    } catch (requestError) {
      if (isFeatureDisabledError(requestError)) setFeatureDisabled(true);
      else setError(describeError(requestError));
    } finally {
      setLoading(false);
    }
    return courseId;
  }, [courseId]);

  useEffect(() => {
    setSelected(null);
    setTab(null);
    setMobileView('list');
    refresh().then((loadedCourseId) => {
      const pending = pendingOpenRef.current;
      if (pending && (!pending.courseId || pending.courseId === loadedCourseId)) {
        pendingOpenRef.current = null;
        void openRef.current?.(pending.scriptId);
      }
    });
  }, [refresh, setMobileView]);

  const groups = useMemo(() => {
    const grouped = groupUploadScripts(scripts, assets);
    const adapt = (rows) => rows.map((row) => ({ ...row, status: withUploadNext(row.status) }));
    return { action: adapt(grouped.action), waiting: adapt(grouped.waiting) };
  }, [scripts, assets]);
  const rememberedTab = useMemo(() => recallTab(SHORT_UPLOAD_PAGE, courseId), [courseId]);
  const activeTab = tab ?? pickInitialTab(TAB_KEYS, { action: groups.action.length, waiting: groups.waiting.length }, rememberedTab);
  const tabs = [
    { key: 'action', label: '需要你處理', icon: 'alert', count: groups.action.length, rows: groups.action, variant: 'action' },
    { key: 'waiting', label: '等待中', icon: 'hourglass', count: groups.waiting.length, rows: groups.waiting, variant: 'waiting', hint: WAITING_HINT },
  ];
  const version = latestVersion(selected);
  const status = selected ? withUploadNext(deriveDisplayStatus(selected, assets)) : null;
  const scriptAssets = useMemo(
    () => (selected ? assets.filter((asset) => asset.sourceScriptId === selected._id) : []),
    [assets, selected],
  );
  // 摘要裡的全文用第一組視覺隱喻；要換隱喻、複製完整腳本請到腳本頁。
  const markdown = useMemo(
    () => (selected && version ? renderScriptMarkdown(selected, version, 0) : ''),
    [selected, version],
  );

  async function loadScript(scriptId) {
    setError('');
    try {
      setSelected(await getScript(scriptId));
    } catch (requestError) {
      setError(describeError(requestError));
    }
  }

  async function openScript(scriptId) {
    showDetail();
    await loadScript(scriptId);
  }

  // 桌面與平板：關閉詳情，右欄回到「建議下一步」，焦點回到清單裡原本選中的那一列。
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

  // Esc 關閉詳情（桌面與平板）。
  useEffect(() => {
    if (!selected || compact) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') closeDetail();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, compact]);

  async function reloadAfterChange() {
    if (selected) {
      try { setSelected(await getScript(selected._id)); } catch { /* 清單重讀時會顯示錯誤 */ }
    }
    await refresh({ clearError: false });
  }

  const goToScripts = (scriptId = null) => {
    if (scriptId) requestOpenScript({ scriptId, courseId, page: SHORT_SCRIPT_PAGE });
    onNav?.('shortScripts');
  };

  if (featureDisabled) {
    return (
      <div className="fu scrl ss-page">
        <div className="card" style={{ padding: 32, maxWidth: 620 }}>
          <div style={{ ...HEADING, fontSize: 14, marginBottom: 10 }}>此功能尚未啟用</div>
          <div style={BODY}>
            後端的 <code>SHORT_SCRIPT_AUTOMATION_ENABLED</code> 為 <code>false</code>，上傳短片與短影片腳本路由回 404。
            在後端 <code>.env</code> 設成 <code>true</code> 並重啟後重新整理。
          </div>
        </div>
      </div>
    );
  }

  const showList = !compact || mobileView === 'list';
  const showDetailPane = !compact || mobileView === 'detail';
  const nothingToDo = !loading && !groups.action.length && !groups.waiting.length;
  const currentTab = tabs.find((item) => item.key === activeTab) || tabs[0];

  function chooseTab(key) {
    setTab(key);
    rememberTab(SHORT_UPLOAD_PAGE, courseId, key);
  }

  // ── 面板頂部：課程、重新整理 ──
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
    </div>
  );

  // ── 分頁列：橫跨整個面板，放在課程選擇那一列下方 ──
  const tabsBar = <StatusTabList idBase={tabsIdBase} tabs={tabs} active={currentTab.key} onChange={chooseTab} label="影片處理狀態" />;

  // ── 左欄：清單（說明文字放在清單頂端，不放在分頁列裡） ──
  const listColumn = (
    <div className="ss-pane ss-list-pane">
      <StatusTabPanel idBase={tabsIdBase} tab={currentTab}>
        <ScriptRows
          rows={currentTab.rows}
          variant={currentTab.variant}
          selectedId={selected?._id}
          onOpen={openScript}
          empty={loading ? '載入中…' : (currentTab.key === 'action' ? '目前沒有需要你上傳或重試的影片' : '沒有等待中的影片')}
        />
      </StatusTabPanel>
      {/* 手機沒有右欄引導，沒有可列的腳本時在這裡給前往連結。 */}
      {compact && nothingToDo && (
        <div className="ss-pane-note">
          到「短影片腳本」頁生成腳本後，會出現在這裡。
          <button type="button" className="ss-text-btn" onClick={() => goToScripts()}>前往短影片腳本 →</button>
        </div>
      )}
    </div>
  );

  function renderSummary() {
    if (!version) return null;
    const shots = version.payload?.shots || [];
    return (
      <Disclosure key={selected._id} title="這一版腳本摘要" count={`第 ${version.versionNo} 版 · ${shots.length} 鏡`}>
        <div style={BODY}>主題：{selected.topic}</div>
        <Disclosure nested title="完整腳本（唯讀）">
          <textarea
            className="ff-input ss-script-text"
            readOnly
            aria-label="完整腳本（唯讀）"
            value={markdown}
            rows={14}
            onFocus={(event) => event.target.select()}
          />
        </Disclosure>
        <button type="button" className="ss-text-btn" onClick={() => goToScripts(selected._id)}>
          在短影片腳本頁開啟（換視覺隱喻、複製腳本）→
        </button>
      </Disclosure>
    );
  }

  // 右欄還沒選腳本時的引導（只在桌面與平板；手機直接看清單）。
  function renderEmptyPane() {
    if (compact) return <EmptyRow>請先選一份腳本</EmptyRow>;
    if (loading && !scripts.length) return <EmptyRow>載入中…</EmptyRow>;
    if (!groups.action.length && !groups.waiting.length) {
      return (
        <div className="ss-guide">
          <StartGuide
            title={scripts.length ? '目前沒有需要處理影片的腳本' : '這門課還沒有短影片腳本'}
            action={<button type="button" className="btn-primary" style={SMALL_BTN} onClick={() => goToScripts()}>前往短影片腳本 →</button>}
          >
            到「短影片腳本」頁建立並生成腳本後，會出現在這裡，拍好短片就能上傳送審。
          </StartGuide>
        </div>
      );
    }
    return (
      <div className="ss-guide">
        <NextStepCard primary row={groups.action[0]} actionLabel="打開並上傳" onOpen={openScript}>
          <div style={BODY}>
            目前沒有需要你上傳或重試的影片，等待中的會自動更新。到「短影片腳本」頁生成腳本後，會出現在這裡。
          </div>
          <div>
            <button type="button" className="ss-text-btn" onClick={() => goToScripts()}>前往短影片腳本 →</button>
          </div>
        </NextStepCard>
      </div>
    );
  }

  const detailPane = (
    <div className="ss-pane ss-detail-pane">
      {!selected ? renderEmptyPane() : (
        <>
          <div className="ss-detail-head">
            {compact ? (
              <div className="ss-mobile-head">
                <button type="button" className="ss-icon-btn" aria-label="返回清單" onClick={backToList}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <div className="ss-mobile-title">{selected.topic}</div>
                <StatusPill status={status} />
              </div>
            ) : (
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
            <div style={{ ...MUTED, marginTop: 6 }}>
              {version ? `依第 ${version.versionNo} 版腳本拍攝` : '還沒有腳本版本'}
              {status?.next ? ` · 下一步：${status.next}` : ''}
            </div>
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

          {selected.status === 'dismissed' ? (
            <div style={{ padding: '16px 20px', ...BODY }}>
              這一題已否決，不能再上傳成品。{selected.dismissReason ? `理由：${selected.dismissReason}` : ''}
            </div>
          ) : (
            <>
              {renderSummary()}
              <ShortAssetPanel
                key={selected._id}
                script={selected}
                version={version}
                assets={scriptAssets}
                compact={compact}
                onChanged={reloadAfterChange}
              />
            </>
          )}
          {selected.status === 'dismissed' && scriptAssets.length > 0 && (
            <div style={{ ...MUTED, padding: '0 20px 16px', borderTop: DIVIDER }}>這份腳本先前有 {scriptAssets.length} 支成品，維持原狀。</div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="fu scrl ss-page">
      {/* 說明：待生成、已上架與已否決的腳本不列在這裡，頁首常駐、不收合。 */}
      <div className="ss-flow-bar">
        待生成、已上架與已否決的腳本不列在這裡；要生成或重新生成腳本，請到「短影片腳本」頁。
        {' '}<button type="button" className="ss-text-btn" onClick={() => goToScripts()}>前往短影片腳本 →</button>
      </div>

      {(!selected || !showDetailPane) && <ErrorBanner style={{ marginBottom: 16 }}>{error}</ErrorBanner>}

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
    </div>
  );
}
