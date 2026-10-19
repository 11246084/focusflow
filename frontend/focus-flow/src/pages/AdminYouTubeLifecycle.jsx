import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import useModalDialog from '../hooks/useModalDialog';
import {
  SWITCH_META,
  describeSwitch,
  formatHistoryValue,
  getLifecycleSettings,
  prepareSwitchChange,
  updateLifecycleSwitch,
} from '../services/youtubeLifecycle';

const TITLE = { fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' };
const MUTED = { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.6 };
const SMALL_BTN = { borderRadius: 8, padding: '5px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' };
const DANGER_BTN = { ...SMALL_BTN, background: 'none', border: '1px solid rgba(220,38,38,0.5)', color: '#fca5a5' };
const OK_BTN = { ...SMALL_BTN, background: 'none', border: '1px solid rgba(74,222,128,0.5)', color: '#86efac' };

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('zh-TW', { hour12: false }) : '—';
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

export default function AdminYouTubeLifecycle() {
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState('');
  const [switchMessage, setSwitchMessage] = useState(null);
  const [preparing, setPreparing] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    getLifecycleSettings()
      .then((data) => { if (active) { setSettings(data); setSettingsError(''); } })
      .catch((e) => { if (active) setSettingsError(e.message || '無法取得開關設定。'); });
    return () => { active = false; };
  }, [refreshKey]);

  const switches = settings?.switches || [];
  const runtime = settings?.runtime || {};

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
