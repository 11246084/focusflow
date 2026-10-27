import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import ShortAssetPanel from './ShortAssetPanel';
import { EmptyRow, ErrorBanner, ScriptRows, ScriptSwitchSheet, SectionCard, StatusPill } from './shortScriptUi';
import { BODY, DIVIDER, GHOST_BTN, HEADING, MUTED, SMALL_BTN, describeError } from './shortScriptStyles';

// 成品上傳頁：教師依腳本拍好影片後，在這裡上傳並送審。只列「影片還沒處理完」的腳本
// （待上傳、處理中）；生成與重新生成在「短影片腳本」頁。版面與手機單欄做法同腳本頁，
// 決策見 docs/04_Features/Short_Script_Automation/decisions.md。

const MOBILE_HISTORY_KEY = 'ffShortUploadDetail';

// 狀態相同，但「下一步」改成在這一頁的說法（腳本頁的說法是「到成品上傳…」）。
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
  const switchButtonRef = useRef(null);

  // 腳本頁的「前往成品上傳」會指定要開哪一份腳本（utils/scriptDeepLink）。
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
    return { toUpload: adapt(grouped.toUpload), processing: adapt(grouped.processing) };
  }, [scripts, assets]);
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

  useEffect(() => {
    openRef.current = openScript;
  });

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
            後端的 <code>SHORT_SCRIPT_AUTOMATION_ENABLED</code> 為 <code>false</code>，成品上傳與短影片腳本路由回 404。
            在後端 <code>.env</code> 設成 <code>true</code> 並重啟後重新整理。
          </div>
        </div>
      </div>
    );
  }

  const showList = !compact || mobileView === 'list';
  const showDetailPane = !compact || mobileView === 'detail';
  const nothingToDo = !loading && !groups.toUpload.length && !groups.processing.length;

  const listColumn = (
    <div className="ss-col">
      {nothingToDo ? (
        <div className="card" style={{ padding: '24px 20px' }}>
          <div style={{ ...HEADING, fontSize: 14, marginBottom: 8 }}>目前沒有需要處理影片的腳本</div>
          <div style={{ ...BODY, marginBottom: 14 }}>到「短影片腳本」頁生成腳本後，會出現在這裡。</div>
          <button type="button" className="btn-primary" style={SMALL_BTN} onClick={() => goToScripts()}>
            前往短影片腳本 →
          </button>
        </div>
      ) : (
        <>
          <SectionCard title={`待上傳 · ${groups.toUpload.length}`}>
            <ScriptRows rows={groups.toUpload} selectedId={selected?._id} onOpen={openScript} empty={loading ? '載入中…' : '沒有待上傳的腳本'} />
          </SectionCard>
          <SectionCard title={`處理中 · ${groups.processing.length}`}>
            <ScriptRows rows={groups.processing} selectedId={selected?._id} onOpen={openScript} empty={loading ? '載入中…' : '沒有處理中的影片'} />
          </SectionCard>
        </>
      )}
      <div style={{ ...MUTED, lineHeight: 1.7 }}>
        待生成、已上架與已否決的腳本不列在這裡；要生成或重新生成腳本，請到「短影片腳本」頁。
      </div>
    </div>
  );

  function renderSummary() {
    if (!version) return null;
    const shots = version.payload?.shots || [];
    return (
      <details className="ss-details">
        <summary className="ss-summary">這一版腳本摘要 · 第 {version.versionNo} 版</summary>
        <div style={{ padding: '0 20px 16px' }}>
          <div style={BODY}>主題：{selected.topic}</div>
          <div style={BODY}>分鏡：{shots.length} 鏡</div>
          <details className="ss-nested-details">
            <summary className="ss-summary">展開完整腳本</summary>
            <textarea
              className="ff-input ss-script-text"
              readOnly
              aria-label="完整腳本（唯讀）"
              value={markdown}
              rows={14}
              onFocus={(event) => event.target.select()}
            />
          </details>
          <button type="button" className="ss-text-btn" onClick={() => goToScripts(selected._id)}>
            在短影片腳本頁開啟（換視覺隱喻、複製腳本）→
          </button>
        </div>
      </details>
    );
  }

  const detailPane = (
    <div className="card ss-detail" style={{ overflow: 'hidden', minWidth: 0 }}>
      {!selected ? (
        <EmptyRow>{compact ? '請先選一份腳本' : '從左側選一份腳本上傳成品'}</EmptyRow>
      ) : (
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
                <StatusPill status={status} />
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
          groups={[['待上傳', groups.toUpload], ['處理中', groups.processing]]}
          selectedId={selected?._id}
          onSelect={(scriptId) => { setSwitchOpen(false); void loadScript(scriptId); }}
          onClose={() => setSwitchOpen(false)}
          returnFocusRef={switchButtonRef}
        />
      )}
    </div>
  );
}
