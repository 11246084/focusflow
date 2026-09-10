import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import {
  ASSET_REVIEW_LABELS,
  ASSET_UPLOAD_LABELS,
  FEEDBACK_TYPES,
  STATUS_LABELS,
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
  retryAssetUpload,
  reviewScript,
  uploadAsset,
} from '../services/shortScript';
import { renderScriptMarkdown } from '../services/shortScriptTemplate';
import { formatFileSize } from './teacherUploadUtils';

// 版面照專案既有頁面的寫法（TeacherCourses.jsx / TeacherVideoReview.jsx）：
// 頁面容器 padding 26、標題列用 Space Grotesk、主體是 .card 大卡片、
// 列與列之間用 1px 分隔線而不是各自成塊，強調色 #F14F21。
// .card / .card-sm 只給背景與圓角，padding 一律由各頁 inline 指定。
const PAGE_STYLE = { padding: 26, height: '100%', overflowX: 'hidden' };
const HEADING = { fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' };
const SECTION_LABEL = {
  color: 'rgba(255,255,255,0.35)',
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
};
const MUTED = { color: 'rgba(255,255,255,0.42)', fontSize: 12 };
const BODY = { color: 'rgba(255,255,255,0.78)', fontSize: 13, lineHeight: 1.7 };
const DIVIDER = '1px solid rgba(255,255,255,0.05)';
const ACCENT = '#F14F21';

const RETRY_BUSY_PREFIX = 'retry:';

const SMALL_BTN = { padding: '9px 16px', fontSize: 12 };
const GHOST_BTN = {
  ...SMALL_BTN,
  background: 'rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.86)',
  border: '1px solid rgba(255,255,255,0.16)',
};

// apiFetch 在回應不是 JSON 時只給 'Request failed'（例如 nginx 回 502 的 HTML），
// 光看這句話無法分辨是權限、路由不存在還是後端掛了。把狀態碼與錯誤碼一起顯示。
function describeError(error) {
  const parts = [error.status, error.code].filter(Boolean).join(' ');
  return parts ? `${error.message}（${parts}）` : error.message;
}

const ARC_LABELS = {
  hook: '鉤子',
  context: '交代',
  reveal: '給正解',
  deepen: '加深',
  evidence: '證據',
  climax: '高潮',
  conclusion: '結論',
  ending: '收尾',
};

const STATUS_TONE = {
  evidence_ready: { color: '#a5b4fc', background: 'rgba(165,180,252,0.12)', border: 'rgba(165,180,252,0.22)' },
  generated: { color: '#fbbf24', background: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.22)' },
  changes_requested: { color: '#fb923c', background: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.24)' },
  approved: { color: '#4ade80', background: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.22)' },
  dismissed: { color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.14)' },
};

function StatusPill({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.dismissed;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 50,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color: tone.color,
        background: tone.background,
        border: `1px solid ${tone.border}`,
      }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

// 成品的審核狀態。上架與否看 upload.status，這裡只表示教師審過沒有。
const ASSET_REVIEW_TONE = {
  pending: { color: '#fbbf24', background: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.22)' },
  approved: { color: '#4ade80', background: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.22)' },
  rejected: { color: '#fb923c', background: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.24)' },
};

function AssetPill({ reviewStatus }) {
  const tone = ASSET_REVIEW_TONE[reviewStatus] || ASSET_REVIEW_TONE.pending;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 50,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color: tone.color,
        background: tone.background,
        border: `1px solid ${tone.border}`,
      }}
    >
      {ASSET_REVIEW_LABELS[reviewStatus] || reviewStatus}
    </span>
  );
}

// 兩個確認框都是必勾：規格書 R-07／附錄 K.5 要求教師明示確認 AI 揭露與書面同意，
// 系統不代為取得也不驗真偽，只記錄確認時間。少勾任何一個後端回 SHORT_ASSET_DISCLOSURE_REQUIRED。
function ConfirmRow({ checked, disabled, onChange, children }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 9,
        marginTop: 9,
        cursor: disabled ? 'default' : 'pointer',
        ...BODY,
        fontSize: 12.5,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ accentColor: ACCENT, width: 14, height: 14, marginTop: 2, flexShrink: 0 }}
      />
      <span>{children}</span>
    </label>
  );
}

function SectionCard({ title, action, children, style }) {
  return (
    <div className="card" style={{ overflow: 'hidden', ...style }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '13px 20px',
          borderBottom: DIVIDER,
        }}
      >
        <div style={SECTION_LABEL}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ children }) {
  return (
    <div style={{ padding: 28, textAlign: 'center', color: 'rgba(255,255,255,0.42)', fontSize: 12.5 }}>
      {children}
    </div>
  );
}

export default function TeacherShortScripts() {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [scripts, setScripts] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [metaphorIndex, setMetaphorIndex] = useState(0);
  // 教師選定要做的候選主題。不選就照 DR-12 的排序自動選第一個通過證據檢查的。
  const [pickedTopicKey, setPickedTopicKey] = useState('');

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  // 「這版不要」面板：不是審核關卡（規格書 2.0），只是重新生成前讓教師講一句哪裡不對。
  // 沒有這句話，模型會在沒有任何指引下重寫，結果多半跟上一版差不多。
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenType, setRegenType] = useState(FEEDBACK_TYPES[0].value);
  const [regenNote, setRegenNote] = useState('');

  // 成品上傳。教師拍完影片回到這一頁上傳，只建立 draft 送審，不直接上架（規格書 R-08）。
  const [assets, setAssets] = useState([]);
  const [assetFile, setAssetFile] = useState(null);
  const [assetTitle, setAssetTitle] = useState('');
  const [assetDescription, setAssetDescription] = useState('');
  const [assetDrag, setAssetDrag] = useState(false);
  const [confirmedAi, setConfirmedAi] = useState(false);
  const [confirmedConsent, setConfirmedConsent] = useState(false);
  const [uploadNotice, setUploadNotice] = useState('');
  const assetInputRef = useRef(null);

  useEffect(() => {
    listCourses()
      .then((list) => {
        setCourses(list);
        if (list.length) setCourseId(list[0]._id);
      })
      .catch((requestError) => setError(`課程清單載入失敗：${describeError(requestError)}`));
  }, []);

  const refresh = useCallback(async () => {
    if (!courseId) return;

    setLoading(true);
    setError('');
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
      if (isFeatureDisabledError(requestError)) {
        setFeatureDisabled(true);
      } else {
        setError(describeError(requestError));
      }
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    setSelected(null);
    setPickedTopicKey('');
    refresh();
  }, [refresh]);

  const version = latestVersion(selected);

  const markdown = useMemo(
    () => (selected && version ? renderScriptMarkdown(selected, version, metaphorIndex) : ''),
    [selected, version, metaphorIndex],
  );

  // 只列這份腳本產出的成品。同一份腳本重拍是同一筆資產的不同代（generationVersion），
  // 不會各自成列，所以這裡通常只有一筆。
  const scriptAssets = useMemo(
    () => (selected ? assets.filter((asset) => asset.sourceScriptId === selected._id) : []),
    [assets, selected],
  );

  async function runAction(label, action) {
    setBusy(label);
    setError('');
    try {
      const result = await action();
      if (result) setSelected(result);
      await refresh();
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setBusy('');
    }
  }

  async function handleCreate() {
    // 教師選了主題就做那一題；沒選就交給排序規則。
    const result = await runAction('create', () => createScript(courseId, pickedTopicKey || null));
    setPickedTopicKey('');
    return result;
  }

  async function handleOpen(scriptId) {
    setError('');
    setCopied(false);
    setMetaphorIndex(0);
    setRegenOpen(false);
    setRegenNote('');
    resetUploadForm();
    try {
      const script = await getScript(scriptId);
      setSelected(script);
      // 標題預填主題，教師想改再改；留空時後端也會退回用主題。
      setAssetTitle(script.topic || '');
    } catch (requestError) {
      setError(describeError(requestError));
    }
  }

  function resetUploadForm() {
    setAssetFile(null);
    setAssetDescription('');
    setConfirmedAi(false);
    setConfirmedConsent(false);
    setUploadNotice('');
    if (assetInputRef.current) assetInputRef.current.value = '';
  }

  function pickAssetFile(files) {
    const file = files?.[0];
    if (!file) return;
    setAssetFile(file);
    setUploadNotice('');
    setError('');
    // 同一個檔案連續選兩次時 change 事件不會再觸發，選完就清掉 input 的值。
    if (assetInputRef.current) assetInputRef.current.value = '';
  }

  async function handleUploadAsset() {
    if (!assetFile) {
      setError('請先選擇成品影片檔。');
      return;
    }
    if (!confirmedAi || !confirmedConsent) {
      setError('請先確認 AI 揭露標示與教師書面同意，兩項都確認才能上傳。');
      return;
    }

    setBusy('upload');
    setError('');
    setUploadNotice('');
    try {
      await uploadAsset(selected._id, {
        file: assetFile,
        title: assetTitle.trim() || selected.topic,
        description: assetDescription.trim(),
        versionNo: version.versionNo,
      });
      resetUploadForm();
      setUploadNotice('已送審。要到「短影片審核」頁審核通過，系統才會自動上架 YouTube。');
      // 上傳可能把同一份腳本既有的待上架成品換代，腳本本身的狀態也可能改變，兩邊都重讀。
      setSelected(await getScript(selected._id));
      await refresh();
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setBusy('');
    }
  }

  async function handleRetryUpload(assetId) {
    setBusy(RETRY_BUSY_PREFIX + assetId);
    setError('');
    try {
      await retryAssetUpload(assetId);
      await refresh();
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setBusy('');
    }
  }

  // generated 狀態的腳本不能直接重生（狀態機沒有 generated → generated），
  // 要先帶著回饋退回再生成；changes_requested 的回饋已經在上一版裡（成品退回時寫入），直接生成即可。
  async function handleRegenerate() {
    if (selected.status === 'changes_requested') {
      return runAction('generate', () => generateVersion(selected._id));
    }

    const note = regenNote.trim();
    if (!note) {
      setError('請先寫一句哪裡不對，重新生成才有依據。');
      return null;
    }

    return runAction('generate', async () => {
      await reviewScript(selected._id, {
        decision: 'request_changes',
        feedback: note,
        feedbackType: regenType,
      });
      const result = await generateVersion(selected._id);
      setRegenOpen(false);
      setRegenNote('');
      return result;
    });
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

  if (featureDisabled) {
    return (
      <div className="fu scrl" style={PAGE_STYLE}>
        <div style={{ ...HEADING, marginBottom: 18 }}>Short Video Scripts</div>
        <div className="card" style={{ padding: 32, maxWidth: 620 }}>
          <div style={{ ...HEADING, fontSize: 14, marginBottom: 10 }}>此功能尚未啟用</div>
          <div style={BODY}>
            後端的 <code>SHORT_SCRIPT_AUTOMATION_ENABLED</code> 為 <code>false</code>，整組短影片腳本路由回 404。
            在後端 <code>.env</code> 設成 <code>true</code> 並重啟後重新整理。
          </div>
          <div style={{ ...MUTED, marginTop: 10, lineHeight: 1.7 }}>
            部署環境的 <code>.env</code> 不進版控，本機可跑不代表伺服器可跑。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fu scrl" style={PAGE_STYLE}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 18,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={HEADING}>Short Video Scripts</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="ff-input"
            aria-label="課程"
            value={courseId}
            style={{ width: 'auto', minWidth: 200, padding: '9px 40px 9px 16px', fontSize: 12, borderRadius: 10 }}
            onChange={(event) => setCourseId(event.target.value)}
          >
            {!courses.length && <option value="">目前沒有可用課程</option>}
            {courses.map((course) => (
              <option key={course._id} value={course._id}>{course.title}</option>
            ))}
          </select>
          <button type="button" className="btn-primary" style={GHOST_BTN} disabled={loading} onClick={refresh}>
            <Ic n="sync" s={13} /> 重新整理
          </button>
          <button
            type="button"
            className="btn-primary"
            style={SMALL_BTN}
            disabled={!courseId || Boolean(busy)}
            onClick={handleCreate}
          >
            <Ic n="plus" s={13} />
            {busy === 'create' ? '建立中…' : (pickedTopicKey ? '用選定主題建立腳本' : '自動選題建立腳本')}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 12.5,
            color: '#ff8b72',
            padding: '11px 16px',
            background: 'rgba(255,107,107,0.08)',
            borderRadius: 12,
            border: '1px solid rgba(255,107,107,0.22)',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {!courses.length && !error && !loading && (
        <div className="card" style={{ padding: 28, textAlign: 'center', ...MUTED }}>
          這個帳號目前沒有可管理的課程。
        </div>
      )}

      <div
        className="ff-grid-2"
        style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: 20, alignItems: 'start' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <SectionCard title={`Scripts · ${scripts.length}`}>
            {!scripts.length ? (
              <EmptyRow>{loading ? '載入中…' : '尚未建立任何腳本'}</EmptyRow>
            ) : (
              scripts.map((script, index) => {
                const active = selected?._id === script._id;
                return (
                  <div
                    key={script._id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpen(script._id)}
                    onKeyDown={(event) => { if (event.key === 'Enter') handleOpen(script._id); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '13px 20px',
                      cursor: 'pointer',
                      transition: 'background .15s',
                      background: active ? 'rgba(241,79,33,0.06)' : 'transparent',
                      borderBottom: index === scripts.length - 1 ? 'none' : DIVIDER,
                      borderLeft: `2px solid ${active ? ACCENT : 'transparent'}`,
                    }}
                    onMouseEnter={(event) => {
                      if (!active) event.currentTarget.style.background = 'rgba(255,255,255,0.025)';
                    }}
                    onMouseLeave={(event) => {
                      if (!active) event.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1.5 }}>
                        {script.topic}
                      </div>
                    </div>
                    <StatusPill status={script.status} />
                  </div>
                );
              })
            )}
          </SectionCard>

          <SectionCard
            title="Topic Candidates"
            action={pickedTopicKey ? (
              <button
                type="button"
                className="btn-primary"
                style={{ ...GHOST_BTN, padding: '6px 12px', fontSize: 11 }}
                onClick={() => setPickedTopicKey('')}
              >
                取消選定
              </button>
            ) : null}
          >
            <div
              style={{
                padding: '12px 20px',
                borderBottom: candidates.length ? DIVIDER : 'none',
                ...MUTED,
                lineHeight: 1.7,
              }}
            >
              點一列指定要做的主題；不指定就依「幾個人問過 → 問過幾次」自動選第一個證據足夠的。
            </div>
            {!candidates.length ? (
              <EmptyRow>{loading ? '載入中…' : '沒有符合條件的候選主題'}</EmptyRow>
            ) : (
              candidates.map((candidate, index) => {
                const picked = pickedTopicKey === candidate.topicKey;
                return (
                  <div
                    key={candidate.topicKey}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPickedTopicKey(picked ? '' : candidate.topicKey)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setPickedTopicKey(picked ? '' : candidate.topicKey);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '13px 20px',
                      cursor: 'pointer',
                      transition: 'background .15s',
                      background: picked ? 'rgba(241,79,33,0.06)' : 'transparent',
                      borderBottom: index === candidates.length - 1 ? 'none' : DIVIDER,
                      borderLeft: `2px solid ${picked ? ACCENT : 'transparent'}`,
                    }}
                    onMouseEnter={(event) => {
                      if (!picked) event.currentTarget.style.background = 'rgba(255,255,255,0.025)';
                    }}
                    onMouseLeave={(event) => {
                      if (!picked) event.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 7,
                        flexShrink: 0,
                        marginTop: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                        color: picked ? '#fff' : 'rgba(255,255,255,0.5)',
                        background: picked ? ACCENT : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${picked ? ACCENT : 'rgba(255,255,255,0.12)'}`,
                      }}
                    >
                      {picked ? <Ic n="check" s={12} /> : index + 1}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#fff', lineHeight: 1.55 }}>{candidate.question}</div>
                      <div style={{ ...MUTED, marginTop: 3 }}>
                        {candidate.uniqueAskerCount} 人問過 · 共 {candidate.totalAskCount} 次
                        · 合併 {candidate.variants?.length || 1} 種問法
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </SectionCard>
        </div>

        <div className="card" style={{ overflow: 'hidden', minWidth: 0 }}>
          {!selected ? (
            <EmptyRow>從左側選一份腳本查看內容</EmptyRow>
          ) : (
            <>
              <div style={{ padding: '16px 20px', borderBottom: DIVIDER }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ ...HEADING, fontSize: 14, lineHeight: 1.5, minWidth: 0 }}>{selected.topic}</div>
                  <StatusPill status={selected.status} />
                </div>
                {selected.selectionReason && (
                  <div style={{ ...MUTED, marginTop: 6 }}>
                    {selected.selectionReason.selectedBy === 'teacher' ? '教師指定' : '系統自動選題'}
                    · 排名第 {selected.selectionReason.rank}
                    · {selected.selectionReason.uniqueAskerCount} 人問過
                    · 共 {selected.selectionReason.totalAskCount} 次
                    · 證據 {selected.selectionReason.evidenceCount} 筆
                  </div>
                )}
              </div>

              {!version && (
                <div style={{ padding: '18px 20px' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    style={SMALL_BTN}
                    disabled={Boolean(busy)}
                    onClick={() => runAction('generate', () => generateVersion(selected._id))}
                  >
                    <Ic n="spark" s={13} />
                    {busy === 'generate' ? '生成中（約 30–45 秒）…' : '生成腳本'}
                  </button>
                </div>
              )}

              {version && (
                <>
                  <div style={{ padding: '16px 20px', borderBottom: DIVIDER }}>
                    <div style={{ ...SECTION_LABEL, marginBottom: 10 }}>視覺隱喻</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {(version.payload.visualMetaphorOptions || []).map((option, index) => {
                        const on = metaphorIndex === index;
                        return (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => { setMetaphorIndex(index); setCopied(false); }}
                            style={{
                              padding: '7px 14px',
                              borderRadius: 50,
                              fontSize: 12,
                              cursor: 'pointer',
                              color: on ? '#fff' : 'rgba(255,255,255,0.7)',
                              background: on ? 'rgba(241,79,33,0.16)' : 'rgba(255,255,255,0.05)',
                              border: `1px solid ${on ? 'rgba(241,79,33,0.5)' : 'rgba(255,255,255,0.12)'}`,
                            }}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ ...MUTED, marginTop: 8 }}>選一組，會寫進複製出的腳本。</div>
                  </div>

                  {/* 規格書 2.1：教師必須看得到證據與 STT 原文才判斷得出引用是否正確，
                      只看口白不夠——口白讀起來通順不代表引用對。 */}
                  <div style={{ padding: '16px 20px', borderBottom: DIVIDER }}>
                    <div style={SECTION_LABEL}>證據對照表 · 未修飾的逐字稿原文</div>
                    {(selected.evidence || []).map((item) => (
                      <div key={item.chunkId} style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: ACCENT, fontSize: 12, fontWeight: 700 }}>[{item.code}]</span>
                          <span style={MUTED}>
                            {formatTimestamp(item.startSec)}–{formatTimestamp(item.endSec)}
                            {item.expandedFrom ? ' · 鄰接擴展' : ' · 檢索命中'}
                          </span>
                        </div>
                        <div style={{ ...BODY, marginTop: 3 }}>{item.rawText}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ padding: '16px 20px', borderBottom: DIVIDER }}>
                    <div style={SECTION_LABEL}>分鏡 · 第 {version.versionNo} 版</div>
                    {version.payload.shots.map((shot) => (
                      <div key={shot.shotNo} style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                            鏡 {String(shot.shotNo).padStart(2, '0')}
                          </span>
                          <span style={MUTED}>
                            {ARC_LABELS[shot.arcRole] || shot.arcRole} · {shot.timeRange}
                          </span>
                        </div>
                        <div style={{ ...BODY, marginTop: 3 }}>{shot.narration}</div>
                        <div style={{ ...MUTED, marginTop: 2 }}>字幕：{shot.subtitle}</div>
                        <div style={MUTED}>
                          依據：{shot.basedOn === 'template' ? 'template' : (shot.basedOn || []).join('、')}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ padding: '16px 20px', borderBottom: DIVIDER }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button type="button" className="btn-primary" style={SMALL_BTN} onClick={handleCopy}>
                        <Ic n="check" s={13} />
                        {copied ? '已複製到剪貼簿' : '複製完整腳本'}
                      </button>
                      {selected.status === 'changes_requested' ? (
                        <button
                          type="button"
                          className="btn-primary"
                          style={GHOST_BTN}
                          disabled={Boolean(busy)}
                          onClick={handleRegenerate}
                        >
                          <Ic n="sync" s={13} />
                          {busy === 'generate' ? '重新生成中…' : '依回饋重新生成'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-primary"
                          style={GHOST_BTN}
                          disabled={Boolean(busy) || selected.status === 'dismissed'}
                          onClick={() => setRegenOpen((open) => !open)}
                        >
                          <Ic n="sync" s={13} /> 這版不要，重新生成
                        </button>
                      )}
                    </div>

                    {selected.status === 'changes_requested' && version.feedback && (
                      <div style={{ ...MUTED, marginTop: 10, lineHeight: 1.7 }}>
                        將依此回饋重新生成（
                        {FEEDBACK_TYPES.find((type) => type.value === version.feedbackType)?.label
                          || version.feedbackType}
                        ）：{version.feedback}
                      </div>
                    )}

                    {regenOpen && selected.status !== 'changes_requested' && (
                      <div
                        className="card-sm"
                        style={{ padding: '14px 16px', marginTop: 12, background: 'rgba(255,255,255,0.03)' }}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {FEEDBACK_TYPES.map((type) => {
                            const on = regenType === type.value;
                            return (
                              <button
                                key={type.value}
                                type="button"
                                onClick={() => setRegenType(type.value)}
                                title={type.hint}
                                style={{
                                  padding: '7px 14px',
                                  borderRadius: 50,
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  color: on ? '#fff' : 'rgba(255,255,255,0.7)',
                                  background: on ? 'rgba(241,79,33,0.16)' : 'rgba(255,255,255,0.05)',
                                  border: `1px solid ${on ? 'rgba(241,79,33,0.5)' : 'rgba(255,255,255,0.12)'}`,
                                }}
                              >
                                {type.label}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ ...MUTED, marginTop: 6 }}>
                          {FEEDBACK_TYPES.find((type) => type.value === regenType)?.hint}
                        </div>
                        <textarea
                          className="ff-input"
                          rows={2}
                          placeholder="一句話：哪裡不對？"
                          value={regenNote}
                          style={{ marginTop: 10, fontSize: 13, padding: '10px 14px', resize: 'vertical' }}
                          onChange={(event) => setRegenNote(event.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn-primary"
                            style={SMALL_BTN}
                            disabled={Boolean(busy)}
                            onClick={handleRegenerate}
                          >
                            {busy === 'generate' ? '重新生成中（約 30–45 秒）…' : '退回並重新生成'}
                          </button>
                          <button
                            type="button"
                            className="btn-primary"
                            style={GHOST_BTN}
                            onClick={() => setRegenOpen(false)}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ padding: '16px 20px', borderBottom: DIVIDER }}>
                    <div style={{ ...SECTION_LABEL, marginBottom: 8 }}>完整腳本 · 可直接複製貼進製作流程</div>
                    <textarea
                      className="ff-input"
                      readOnly
                      value={markdown}
                      rows={18}
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 12,
                        lineHeight: 1.65,
                        padding: '12px 14px',
                        resize: 'vertical',
                      }}
                      onFocus={(event) => event.target.select()}
                    />
                  </div>

                  {selected.status !== 'dismissed' && (
                    <div style={{ padding: '16px 20px', borderBottom: scriptAssets.length ? DIVIDER : 'none' }}>
                      <div style={{ ...SECTION_LABEL, marginBottom: 4 }}>
                        上傳成品 · 依第 {version.versionNo} 版腳本拍出來的影片
                      </div>
                      <div style={{ ...MUTED, lineHeight: 1.7, marginBottom: 12 }}>
                        上傳只會建立待審成品，不會直接對外發布。要到「短影片審核」頁審核通過，
                        系統才會自動上架到 YouTube；退回時理由會寫回第 {version.versionNo} 版腳本。
                      </div>

                      <div
                        className="upload-z"
                        style={{ height: 132, padding: 14, opacity: busy === 'upload' ? 0.6 : 1 }}
                        onDragOver={(event) => { event.preventDefault(); setAssetDrag(true); }}
                        onDragLeave={() => setAssetDrag(false)}
                        onDrop={(event) => {
                          event.preventDefault();
                          setAssetDrag(false);
                          if (busy !== 'upload') pickAssetFile(event.dataTransfer.files);
                        }}
                        onClick={() => { if (busy !== 'upload') assetInputRef.current?.click(); }}
                      >
                        <input
                          ref={assetInputRef}
                          type="file"
                          accept=".mp4,.mov,.mkv,video/mp4,video/quicktime,video/x-matroska"
                          style={{ display: 'none' }}
                          onChange={(event) => pickAssetFile(event.target.files)}
                        />
                        {assetFile ? (
                          <>
                            <div style={{ color: ACCENT }}><Ic n="film" s={24} /></div>
                            <div
                              style={{
                                fontSize: 13,
                                color: '#fff',
                                maxWidth: '90%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {assetFile.name}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>
                              {formatFileSize(assetFile.size)} · 點擊可換一支
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ color: ACCENT }}><Ic n="up" s={26} /></div>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: assetDrag ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                              拖曳成品影片至此
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                              或點擊選擇檔案 · MP4、MOV、MKV，單支最大 500 MB
                            </div>
                          </>
                        )}
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <label className="ff-label">YOUTUBE 標題</label>
                        <input
                          className="ff-input"
                          value={assetTitle}
                          placeholder={selected.topic}
                          disabled={busy === 'upload'}
                          style={{ fontSize: 13, padding: '10px 14px' }}
                          onChange={(event) => setAssetTitle(event.target.value)}
                        />
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <label className="ff-label">YOUTUBE 說明（選填）</label>
                        <textarea
                          className="ff-input"
                          rows={2}
                          value={assetDescription}
                          placeholder="影片說明，會一併帶到 YouTube"
                          disabled={busy === 'upload'}
                          style={{ fontSize: 13, padding: '10px 14px', resize: 'vertical' }}
                          onChange={(event) => setAssetDescription(event.target.value)}
                        />
                      </div>

                      <div
                        className="card-sm"
                        style={{ padding: '12px 16px', marginTop: 12, background: 'rgba(255,255,255,0.03)' }}
                      >
                        <div style={SECTION_LABEL}>上傳前必須確認</div>
                        <ConfirmRow checked={confirmedAi} disabled={busy === 'upload'} onChange={setConfirmedAi}>
                          影片全片都有常駐的 AI 生成揭露標示。
                        </ConfirmRow>
                        <ConfirmRow checked={confirmedConsent} disabled={busy === 'upload'} onChange={setConfirmedConsent}>
                          使用教師數位分身已取得該教師的書面同意。
                        </ConfirmRow>
                        <div style={{ ...MUTED, marginTop: 8, lineHeight: 1.7 }}>
                          系統只記錄你的確認與時間，不會代為檢查或取得同意書。
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn-primary"
                          style={SMALL_BTN}
                          disabled={Boolean(busy) || !assetFile || !confirmedAi || !confirmedConsent}
                          onClick={handleUploadAsset}
                        >
                          <Ic n="up" s={13} />
                          {busy === 'upload' ? '上傳中…' : '上傳成品並送審'}
                        </button>
                        {assetFile && busy !== 'upload' && (
                          <button type="button" className="btn-primary" style={GHOST_BTN} onClick={resetUploadForm}>
                            清除
                          </button>
                        )}
                      </div>

                      {uploadNotice && (
                        <div
                          style={{
                            marginTop: 12,
                            fontSize: 12.5,
                            color: '#86efac',
                            padding: '10px 14px',
                            background: 'rgba(74,222,128,0.08)',
                            border: '1px solid rgba(74,222,128,0.2)',
                            borderRadius: 12,
                          }}
                        >
                          {uploadNotice}
                        </div>
                      )}
                    </div>
                  )}

                  {scriptAssets.length > 0 && (
                    <div style={{ padding: '16px 20px' }}>
                      <div style={{ ...SECTION_LABEL, marginBottom: 4 }}>這份腳本的成品</div>
                      {scriptAssets.map((asset) => (
                        <div key={asset.id} style={{ marginTop: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{asset.title}</span>
                            <AssetPill reviewStatus={asset.reviewStatus} />
                          </div>
                          <div style={{ ...MUTED, marginTop: 3 }}>
                            第 {asset.generationVersion} 代成品 · 依第 {asset.sourceVersionNo ?? '?'} 版腳本
                            {asset.upload.status
                              ? ` · ${ASSET_UPLOAD_LABELS[asset.upload.status] || asset.upload.status}`
                              : ' · 尚未上架'}
                          </div>
                          {asset.youtubeUrl && (
                            <a
                              href={asset.youtubeUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: 12, color: ACCENT, textDecoration: 'none' }}
                            >
                              在 YouTube 開啟 ↗
                            </a>
                          )}
                          {asset.upload.status === 'failed' && (
                            <div style={{ marginTop: 6 }}>
                              <div style={{ fontSize: 12, color: '#ff8b72', lineHeight: 1.7 }}>
                                {asset.upload.error || '上架失敗。'}
                              </div>
                              {asset.upload.retrySafe ? (
                                <button
                                  type="button"
                                  className="btn-primary"
                                  style={{ ...GHOST_BTN, marginTop: 6 }}
                                  disabled={Boolean(busy)}
                                  onClick={() => handleRetryUpload(asset.id)}
                                >
                                  <Ic n="sync" s={13} />
                                  {busy === RETRY_BUSY_PREFIX + asset.id ? '重試中…' : '重試上架'}
                                </button>
                              ) : (
                                <div style={{ ...MUTED, marginTop: 4, lineHeight: 1.7 }}>
                                  這次失敗可能已經送出影片內容，直接重試會在頻道留下重複影片。
                                  請先到 YouTube Studio 確認後再決定。
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
