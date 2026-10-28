import { useCallback, useEffect, useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import useModalDialog from '../hooks/useModalDialog';
import {
  CLEANUP_REASON_LABELS,
  KIND_LABELS,
  QUARANTINE_REASON_LABELS,
  SWITCH_META,
  applyQuarantineItem,
  describeApplyConfirm,
  describeResetConfirm,
  describeSwitch,
  formatBytes,
  formatHistoryValue,
  formatRecoveryResult,
  getCleanupPreview,
  getLifecycleSettings,
  getQuarantineControls,
  listQuarantine,
  lookupQuarantineItem,
  parseYouTubeVideoId,
  prepareSwitchChange,
  quarantineItemKey,
  resetQuarantineItem,
  runRecoveryNow,
  updateLifecycleSwitch,
} from '../services/youtubeLifecycle';
import { OPEN_QUARANTINE_EVENT, consumePendingQuarantineOpen } from '../utils/notificationTarget';

const TITLE = { fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' };
const MUTED = { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.6 };
const SMALL_BTN = { borderRadius: 8, padding: '5px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' };
const GHOST_BTN = { ...SMALL_BTN, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.86)' };
const WARN_BTN = { ...SMALL_BTN, background: 'none', border: '1px solid rgba(251,191,36,0.5)', color: '#fcd34d' };
const DANGER_BTN = { ...SMALL_BTN, background: 'none', border: '1px solid rgba(220,38,38,0.5)', color: '#fca5a5' };
const OK_BTN = { ...SMALL_BTN, background: 'none', border: '1px solid rgba(74,222,128,0.5)', color: '#86efac' };

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('zh-TW', { hour12: false }) : '—';
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('zh-TW') : '—';
}

function Message({ message }) {
  if (!message) return null;
  return (
    <div
      role={message.tone === 'error' ? 'alert' : 'status'}
      style={{ fontSize: 12, lineHeight: 1.6, marginTop: 8, color: message.tone === 'error' ? '#fb923c' : '#86efac' }}
    >
      {message.text}
    </div>
  );
}

// 所有破壞性或對外的動作都經過這個確認視窗；run 失敗時留在視窗內顯示錯誤。
function ConfirmDialog({ action, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useModalDialog(() => { if (!busy) onClose(); });

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      await action.run();
      onClose();
    } catch (e) {
      setError(e.message || '操作失敗，請稍後再試。');
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => { if (!busy) onClose(); }}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="yt-confirm-title"
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#1a0d1e', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 18, padding: 26, width: 'min(520px, 92vw)', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
      >
        <div id="yt-confirm-title" style={{ ...TITLE, fontSize: 15, marginBottom: 10 }}>{action.title}</div>
        {action.summary && (
          <div style={{ fontSize: 13, color: action.danger ? '#fdba74' : 'rgba(255,255,255,0.78)', lineHeight: 1.7, marginBottom: 10 }}>{action.summary}</div>
        )}
        {action.body}
        {error && <div role="alert" style={{ fontSize: 12, color: '#fb923c', marginTop: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10, color: 'rgba(255,255,255,0.82)', padding: '9px 18px', fontSize: 12, cursor: 'pointer' }}>取消</button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            style={{ background: action.danger ? '#dc2626' : '#F14F21', border: 'none', borderRadius: 10, color: '#fff', padding: '9px 20px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
          >
            {busy ? '處理中...' : action.confirmLabel || '確認'}
          </button>
        </div>
      </section>
    </div>
  );
}

function CleanupItemList({ items, emptyText }) {
  if (!items?.length) return <div style={MUTED}>{emptyText}</div>;
  return (
    <div className="ff-tbl-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
      <table className="ff-tbl">
        <thead>
          <tr><th>類型</th><th>名稱</th><th>課程</th><th>大小</th><th>到期</th><th>原因</th></tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={quarantineItemKey(item)}>
              <td><span className="badge bb">{KIND_LABELS[item.kind] || item.kind}</span></td>
              <td style={{ maxWidth: 200, overflowWrap: 'anywhere' }}>{item.title || '未命名'}</td>
              <td style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{item.courseTitle || '—'}</td>
              <td style={{ fontSize: 12 }}>{formatBytes(item.sizeBytes)}</td>
              <td style={{ fontSize: 12 }}>{formatDate(item.eligibleAt)}</td>
              <td style={{ fontSize: 12 }}>{CLEANUP_REASON_LABELS[item.reason] || item.reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminYouTubeLifecycle() {
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState('');
  const [upcoming, setUpcoming] = useState(null);
  const [upcomingError, setUpcomingError] = useState('');
  const [quarantine, setQuarantine] = useState({ items: [], searchable: null });
  const [quarantineLoading, setQuarantineLoading] = useState(true);
  const [quarantineError, setQuarantineError] = useState('');
  const [lookups, setLookups] = useState({});
  const [manualIds, setManualIds] = useState({});
  const [itemMessages, setItemMessages] = useState({});
  const [listMessage, setListMessage] = useState(null);
  const [switchMessage, setSwitchMessage] = useState(null);
  const [recoveryMessage, setRecoveryMessage] = useState(null);
  const [preparing, setPreparing] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const quarantineRef = useRef(null);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    getLifecycleSettings()
      .then((data) => { if (active) { setSettings(data); setSettingsError(''); } })
      .catch((e) => { if (active) { setSettings(null); setSettingsError(e.message || '無法取得開關設定。'); } });
    getCleanupPreview('upcoming')
      .then((data) => { if (active) { setUpcoming(data); setUpcomingError(''); } })
      .catch((e) => { if (active) { setUpcoming(null); setUpcomingError(e.message || '無法取得即將到期清單。'); } });
    listQuarantine()
      .then((data) => { if (active) { setQuarantine(data); setQuarantineError(''); } })
      .catch((e) => { if (active) setQuarantineError(e.message || '無法取得待處理清單。'); })
      .finally(() => { if (active) setQuarantineLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  // 從「YouTube 上傳需要確認」通知進來時捲到待處理清單。
  useEffect(() => {
    const scrollToQuarantine = () => quarantineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (consumePendingQuarantineOpen()) window.setTimeout(scrollToQuarantine, 0);
    const handleOpen = () => {
      consumePendingQuarantineOpen();
      scrollToQuarantine();
    };
    window.addEventListener(OPEN_QUARANTINE_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_QUARANTINE_EVENT, handleOpen);
  }, []);

  const switches = settings?.switches || [];
  const runtime = settings?.runtime || {};
  const recoverySwitch = switches.find((sw) => sw.key === 'recovery');
  const recoveryEffective = Boolean(recoverySwitch?.effective);

  async function handleToggle(sw) {
    setSwitchMessage(null);
    setPreparing(sw.key);
    try {
      const plan = await prepareSwitchChange(sw);
      setConfirmAction({
        title: plan.title,
        summary: plan.summary,
        danger: plan.danger,
        confirmLabel: plan.enabled ? '確認啟用' : '確認停用',
        body: plan.preview ? (
          <CleanupItemList items={plan.preview.items} emptyText="沒有會立即刪除的原片。" />
        ) : null,
        run: async () => {
          const data = await updateLifecycleSwitch(plan.key, plan.enabled);
          if (data?.switches) setSettings(data);
          else refresh();
          setSwitchMessage({ tone: 'ok', text: `已${plan.title}。` });
          if (plan.key === 'cleanup') refresh();
        },
      });
    } catch (e) {
      setSwitchMessage({ tone: 'error', text: e.message || '無法準備切換，請稍後再試。' });
    } finally {
      setPreparing('');
    }
  }

  function handleRunRecovery() {
    setRecoveryMessage(null);
    setConfirmAction({
      title: '立即執行恢復',
      summary: '馬上執行一輪恢復：重新上傳可安全重試的失敗，並隔離卡在上傳中的影片。這會對 YouTube 頻道上傳影片。',
      confirmLabel: '立即執行',
      run: async () => {
        const result = await runRecoveryNow();
        setRecoveryMessage({ tone: 'ok', text: formatRecoveryResult(result) });
        refresh();
      },
    });
  }

  function setItemMessage(item, message) {
    setItemMessages((prev) => ({ ...prev, [quarantineItemKey(item)]: message }));
  }

  function removeQuarantineItem(item) {
    const key = quarantineItemKey(item);
    setQuarantine((prev) => ({ ...prev, items: prev.items.filter((entry) => quarantineItemKey(entry) !== key) }));
  }

  async function handleLookup(item) {
    const key = quarantineItemKey(item);
    setItemMessage(item, null);
    setLookups((prev) => ({ ...prev, [key]: { loading: true } }));
    try {
      const data = await lookupQuarantineItem(item.kind, item.id);
      setLookups((prev) => ({ ...prev, [key]: { loading: false, searchable: data?.searchable, matches: data?.matches || [] } }));
      // 憑證不能讀頻道時，其他項目也查不到，整個清單改為手動輸入。
      if (data?.searchable === false) setQuarantine((prev) => ({ ...prev, searchable: false }));
    } catch (e) {
      setLookups((prev) => ({ ...prev, [key]: { loading: false, error: e.message || '查詢失敗。' } }));
    }
  }

  function confirmApply(item, match) {
    const text = describeApplyConfirm(item, match);
    setConfirmAction({
      title: text.title,
      summary: text.summary,
      body: <div style={{ fontSize: 12.5, color: '#fb923c', overflowWrap: 'anywhere' }}>{text.detail}</div>,
      confirmLabel: '確認套用',
      run: async () => {
        await applyQuarantineItem(item.kind, item.id, match.youtubeVideoId);
        removeQuarantineItem(item);
        setListMessage({ tone: 'ok', text: `「${item.title || '未命名'}」已標成上傳完成，系統會通知上傳的教師。` });
      },
    });
  }

  function handleManualApply(item) {
    const key = quarantineItemKey(item);
    const youtubeVideoId = parseYouTubeVideoId(manualIds[key]);
    if (!youtubeVideoId) {
      setItemMessage(item, { tone: 'error', text: '請輸入 11 碼的 YouTube 影片 ID 或影片網址。' });
      return;
    }
    setItemMessage(item, null);
    confirmApply(item, { youtubeVideoId });
  }

  function confirmReset(item) {
    const text = describeResetConfirm(item);
    setConfirmAction({
      title: text.title,
      summary: text.summary,
      danger: true,
      confirmLabel: '確認重設',
      run: async () => {
        await resetQuarantineItem(item.kind, item.id);
        removeQuarantineItem(item);
        setListMessage({ tone: 'ok', text: `「${item.title || '未命名'}」已重設為可重試，恢復排程會重新上傳。` });
      },
    });
  }

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {confirmAction && <ConfirmDialog action={confirmAction} onClose={() => setConfirmAction(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...TITLE, fontSize: 15 }}>YouTube 上傳管理</div>
        <button className="btn-primary" onClick={refresh} style={{ padding: '9px 20px', fontSize: 12 }}><Ic n="sync" s={13} />重新整理</button>
      </div>

      {/* 兩層開關：環境變數允許 + 執行期設定（#9、#13、#16） */}
      <div className="card" style={{ padding: 22, marginBottom: 12 }}>
        <div style={{ ...TITLE, marginBottom: 4 }}>營運開關</div>
        <div style={{ ...MUTED, marginBottom: 14 }}>環境變數允許且這裡開啟才會生效；切換後下一次檢查就套用，不需重啟。</div>
        {settingsError && <div role="alert" style={{ fontSize: 12, color: '#f87171' }}>{settingsError}</div>}
        {!settingsError && !settings && <div style={MUTED}>讀取中...</div>}
        {switches.map((sw) => {
          const view = describeSwitch(sw);
          return (
            <div key={sw.key} data-switch={sw.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{view.label}</span>
                  <span className={`badge ${view.effective ? 'bg' : 'bb'}`}>{view.effective ? '生效中' : '未生效'}</span>
                  {!view.toggleable && <span className="badge by">環境未允許</span>}
                  {view.toggleable && view.unset && <span className="badge bb">預設值</span>}
                </div>
                <div style={{ ...MUTED, marginTop: 3 }}>{view.description}</div>
                <div style={{ fontSize: 12, color: view.toggleable ? 'rgba(255,255,255,0.68)' : '#facc15', marginTop: 3, lineHeight: 1.6 }}>{view.note}</div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(sw)}
                disabled={!view.toggleable || Boolean(preparing)}
                title={view.toggleable ? '' : view.note}
                style={{ ...(view.nextEnabled ? OK_BTN : DANGER_BTN), opacity: view.toggleable ? 1 : 0.45, cursor: view.toggleable ? 'pointer' : 'not-allowed' }}
              >
                {preparing === sw.key ? '準備中...' : view.nextEnabled ? '啟用' : '停用'}
              </button>
            </div>
          );
        })}
        <Message message={switchMessage} />
        {settings && (
          <div style={{ ...MUTED, marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
            <span>恢復間隔：{runtime.recoveryIntervalMs ? `${Math.round(runtime.recoveryIntervalMs / 60000)} 分鐘` : '只在開機執行'}</span>
            <span>可用空間：{runtime.freeSpaceGb ?? '—'} GB（門檻 {runtime.cleanupMinFreeGb ?? '—'} GB）</span>
            <span>保留期：至少 {runtime.cleanupMinAgeDays ?? '—'} 天、最長 {runtime.cleanupMaxAgeDays ? `${runtime.cleanupMaxAgeDays} 天` : '不限'}</span>
            <span>上次恢復：{formatDateTime(runtime.lastRecoveryAt)}</span>
          </div>
        )}
      </div>

      <div className="ff-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* 立即執行恢復（#15），受兩層開關限制 */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ ...TITLE, marginBottom: 4 }}>立即執行恢復</div>
          <div style={{ ...MUTED, marginBottom: 12 }}>不等下一輪排程，馬上重試可安全重試的失敗並隔離卡住的影片。</div>
          <button
            type="button"
            className="btn-primary"
            onClick={handleRunRecovery}
            disabled={!recoveryEffective}
            style={{ padding: '9px 18px', fontSize: 12, opacity: recoveryEffective ? 1 : 0.45, cursor: recoveryEffective ? 'pointer' : 'not-allowed' }}
          >
            <Ic n="sync" s={13} />立即執行
          </button>
          {settings && !recoveryEffective && <div style={{ ...MUTED, marginTop: 8 }}>「失敗恢復」未生效，無法執行。</div>}
          <Message message={recoveryMessage} />
        </div>

        {/* 7 天內將到期刪除（#27②），只顯示資訊 */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ ...TITLE, marginBottom: 4 }}>7 天內將到期刪除</div>
          {upcomingError && <div role="alert" style={{ fontSize: 12, color: '#f87171' }}>{upcomingError}</div>}
          {!upcomingError && !upcoming && <div style={MUTED}>讀取中...</div>}
          {upcoming && (
            <>
              <div style={{ ...MUTED, marginBottom: 10 }}>
                共 {upcoming.count || 0} 支（{formatBytes(upcoming.totalBytes)}）。需要保留原片的影片，請在到期前重新處理或另存原檔。
              </div>
              <CleanupItemList items={upcoming.items} emptyText="7 天內沒有將到期的原片。" />
            </>
          )}
        </div>
      </div>

      {/* 待處理清單（#17）：不確定 YouTube 是否已收到的影片與短片 */}
      <div ref={quarantineRef} id="youtube-quarantine" className="card" style={{ padding: 22, marginBottom: 12, scrollMarginTop: 12 }}>
        <div style={{ ...TITLE, marginBottom: 4 }}>待處理（需要管理員處理的 YouTube 上傳）</div>
        <div style={{ ...MUTED, marginBottom: 12 }}>
          {quarantine.searchable === false
            ? '「需確認 YouTube」：目前的憑證無法讀取頻道上傳清單，請向頻道擁有者取得影片 ID 後手動輸入。'
            : '「需確認 YouTube」：先「查詢 YouTube」比對頻道上傳清單；找到就確認套用，確定沒有上傳才重設為可重試。'}
          {' '}「已達重試上限」：YouTube 上沒有這支，排除原因後重設重試次數。
        </div>
        <Message message={listMessage} />
        {quarantineError && <div role="alert" style={{ fontSize: 12, color: '#f87171' }}>{quarantineError}</div>}
        {quarantineLoading && <div style={MUTED}>讀取中...</div>}
        {!quarantineLoading && !quarantineError && quarantine.items.length === 0 && (
          <div style={MUTED}>目前沒有待處理的項目。</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {quarantine.items.map((item) => {
            const key = quarantineItemKey(item);
            const lookup = lookups[key];
            const retryLimit = item.reason === 'retry_limit';
            const controls = getQuarantineControls({ searchable: quarantine.searchable, lookup, reason: item.reason });
            return (
              <div key={key} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="badge bb">{KIND_LABELS[item.kind] || item.kind}</span>
                      <span className={`badge ${retryLimit ? 'by' : 'br'}`}>
                        {QUARANTINE_REASON_LABELS[item.reason] || QUARANTINE_REASON_LABELS.quarantined}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflowWrap: 'anywhere' }}>{item.title || '未命名'}</span>
                    </div>
                    <div style={{ ...MUTED, marginTop: 4 }}>
                      {item.courseTitle || '—'} · 上傳者 {item.uploadedBy?.name || '—'} · 失敗於 {formatDateTime(item.failedAt)} · 已嘗試 {item.attemptCount ?? 0} 次
                    </div>
                    {item.error && <div style={{ fontSize: 12, color: '#fdba74', marginTop: 3, overflowWrap: 'anywhere' }}>{item.error}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {controls.showLookup && (
                      <button type="button" onClick={() => handleLookup(item)} disabled={lookup?.loading} style={GHOST_BTN}>
                        <Ic n="search" s={11} /> {lookup?.loading ? '查詢中...' : '查詢 YouTube'}
                      </button>
                    )}
                    <button type="button" onClick={() => confirmReset(item)} style={WARN_BTN}>{retryLimit ? '重設重試次數' : '重設為可重試'}</button>
                  </div>
                </div>

                {lookup?.error && <div role="alert" style={{ fontSize: 12, color: '#fb923c', marginTop: 8 }}>{lookup.error}</div>}
                {controls.matches.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>頻道上找到 {controls.matches.length} 支描述相符的影片：</div>
                    {controls.matches.map((match) => (
                      <div key={match.youtubeVideoId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0, fontSize: 12, color: 'rgba(255,255,255,0.85)', overflowWrap: 'anywhere' }}>
                          {match.title || '（無標題）'}
                          <span style={{ color: 'rgba(255,255,255,0.45)' }}> · {match.youtubeVideoId} · {formatDateTime(match.publishedAt)} · {match.privacyStatus || '—'}</span>
                        </div>
                        <button type="button" onClick={() => confirmApply(item, match)} style={OK_BTN}>確認套用</button>
                      </div>
                    ))}
                  </div>
                )}
                {lookup && !lookup.loading && !lookup.error && lookup.searchable !== false && controls.matches.length === 0 && (
                  <div style={{ ...MUTED, marginTop: 8 }}>頻道上找不到這支{KIND_LABELS[item.kind] || '項目'}。若確定沒有上傳，可重設為可重試。</div>
                )}
                {controls.showManualInput && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <input
                      className="ff-input"
                      aria-label={`${item.title || '項目'}的 YouTube 影片 ID`}
                      placeholder="YouTube 影片 ID 或網址"
                      value={manualIds[key] || ''}
                      onChange={(e) => setManualIds((prev) => ({ ...prev, [key]: e.target.value }))}
                      style={{ flex: '1 1 220px', padding: '8px 12px', fontSize: 12 }}
                    />
                    <button type="button" onClick={() => handleManualApply(item)} style={OK_BTN}>確認套用</button>
                  </div>
                )}
                <Message message={itemMessages[key]} />
              </div>
            );
          })}
        </div>
      </div>

      {/* 修改紀錄（#12），後端保留最近 50 筆 */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ ...TITLE, padding: '18px 22px 6px' }}>修改紀錄</div>
        {!settings?.history?.length ? (
          <div style={{ ...MUTED, padding: '8px 22px 18px' }}>尚無修改紀錄。</div>
        ) : (
          <div className="ff-tbl-wrap">
            <table className="ff-tbl">
              <thead>
                <tr><th>時間</th><th>開關</th><th>變更</th><th>修改者</th></tr>
              </thead>
              <tbody>
                {settings.history.map((entry, index) => (
                  <tr key={`${entry.changedAt}-${entry.key}-${index}`}>
                    <td style={{ fontSize: 12 }}>{formatDateTime(entry.changedAt)}</td>
                    <td>{SWITCH_META[entry.key]?.label || entry.key}</td>
                    <td style={{ fontSize: 12 }}>{formatHistoryValue(entry.from)} → {formatHistoryValue(entry.to)}</td>
                    <td style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{entry.changedBy?.name || entry.changedBy?.email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
