import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useModalDialog from '../hooks/useModalDialog';
import BottomSheet from '../components/BottomSheet';
import { Ic } from '../components/Icons';
import { DIVIDER } from './shortScriptStyles';

// 短影片腳本頁、上傳短片頁共用的小元件；樣式常數在 shortScriptStyles.js。

const TONES = {
  indigo: { color: '#a5b4fc', background: 'rgba(165,180,252,0.12)', border: 'rgba(165,180,252,0.22)' },
  amber: { color: '#fbbf24', background: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.22)' },
  orange: { color: '#fb923c', background: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.24)' },
  green: { color: '#4ade80', background: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.22)' },
  grey: { color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.14)' },
};

// 顏色只是輔助，標籤文字本身就說明狀態。
const DISPLAY_TONE = {
  to_generate: 'indigo',
  to_film: 'orange',
  changes_requested: 'orange',
  upload_failed: 'orange',
  asset_rejected: 'orange',
  uploading: 'amber',
  upload_needs_admin: 'amber',
  in_review: 'amber',
  approved_waiting_upload: 'amber',
  published: 'green',
  dismissed: 'grey',
};

// 狀態圖示：讓狀態不只靠顏色辨識（灰階也分得出來）。
const STATUS_ICON = {
  to_generate: 'spark',
  to_film: 'camera',
  changes_requested: 'edit',
  asset_rejected: 'edit',
  upload_failed: 'warning',
  uploading: 'clock',
  upload_needs_admin: 'info',
  in_review: 'hourglass',
  approved_waiting_upload: 'up',
  published: 'checkCircle',
  dismissed: 'ban',
};

export function Pill({ tone = 'grey', children }) {
  const style = TONES[tone] || TONES.grey;
  return (
    <span
      className="ss-pill"
      style={{ color: style.color, background: style.background, border: `1px solid ${style.border}` }}
    >
      {children}
    </span>
  );
}

export function StatusIcon({ statusKey }) {
  const name = STATUS_ICON[statusKey];
  if (!name) return null;
  return <span className="ss-icon" aria-hidden="true"><Ic n={name} s={12} /></span>;
}

export function StatusPill({ status }) {
  return <Pill tone={DISPLAY_TONE[status.key]}><StatusIcon statusKey={status.key} />{status.label}</Pill>;
}

// 「需要你處理」列右側的下一步動作（上傳、重試…）。整列是一個按鈕，這裡只是標示。
function CueChip({ children }) {
  return <span className="ss-row-cue">{children} <span aria-hidden="true">→</span></span>;
}

// 腳本清單的一列：標題（最多兩行）、下一步、狀態。row 來自 groupScripts() 或 groupUploadScripts()。
// variant：action＝右側顯示下一步動作；waiting＝副標改成正在等什麼。
export function ScriptRow({ row, active, onOpen, last, variant }) {
  const waiting = variant === 'waiting' && row.cue;
  return (
    <button
      type="button"
      className={`ss-row${active ? ' active' : ''}`}
      aria-current={active ? 'true' : undefined}
      data-script-id={row.script._id}
      style={{ borderBottom: last ? 'none' : DIVIDER }}
      onClick={() => onOpen(row.script._id)}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="ss-row-title">{row.script.topic}</span>
        {waiting ? (
          <span className="ss-row-next ss-row-wait"><StatusIcon statusKey={row.status.key} />{row.cue}</span>
        ) : row.status.next && <span className="ss-row-next">下一步：{row.status.next}</span>}
      </span>
      {variant === 'action' && row.cue ? (
        <span className="ss-row-aside">
          <StatusPill status={row.status} />
          <CueChip>{row.cue}</CueChip>
        </span>
      ) : <StatusPill status={row.status} />}
    </button>
  );
}

export function ScriptRows({ rows, selectedId, onOpen, empty, variant }) {
  if (!rows.length) return <EmptyRow>{empty}</EmptyRow>;
  return rows.map((row, index) => (
    <ScriptRow key={row.script._id} row={row} variant={variant} active={selectedId === row.script._id} onOpen={onOpen} last={index === rows.length - 1} />
  ));
}

// 狀態分頁：圖示＋名稱＋數量徽章，取代分組卡片與統計卡。方向鍵、Home、End 切換，只有選中的分頁在 Tab 順序裡。
// tabs：[{ key, label, icon, count, hint? }]；children 是選中分頁的內容。「需要你處理」有資料時徽章用強調色實心。
export function StatusTabs({ tabs, active, onChange, label, children }) {
  const baseId = useId();
  const tabRefs = useRef({});
  const tabId = (key) => `${baseId}-tab-${key}`;
  const panelId = `${baseId}-panel`;
  const current = tabs.find((tab) => tab.key === active);

  function handleKeyDown(event, index) {
    const last = tabs.length - 1;
    const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(tabs[next].key);
    tabRefs.current[tabs[next].key]?.focus();
  }

  return (
    <>
      <div className="ss-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(node) => { tabRefs.current[tab.key] = node; }}
              type="button"
              role="tab"
              id={tabId(tab.key)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              className={`ss-tab${selected ? ' active' : ''}`}
              onClick={() => onChange(tab.key)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className="ss-tab-icon" aria-hidden="true"><Ic n={tab.icon} s={15} /></span>
              {tab.label}
              <span className={`ss-tab-count${tab.key === 'action' && tab.count > 0 ? ' strong' : ''}`}>{tab.count}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(active)} className="ss-tab-panel">
        {current?.hint && <div className="ss-tab-hint">{current.hint}</div>}
        {children}
      </div>
    </>
  );
}

// 分頁列橫跨整個面板、與下方清單分開排版時用這一組：StatusTabList 只畫 tablist（放在課程選擇那一列下方），
// StatusTabPanel 畫說明文字＋內容（放在左欄清單頂端）。兩者用同一個 idBase 讓 aria-controls／aria-labelledby 對得上。
export function StatusTabList({ idBase, tabs, active, onChange, label }) {
  const tabRefs = useRef({});
  const tabId = (key) => `${idBase}-tab-${key}`;
  const panelId = `${idBase}-panel`;

  function handleKeyDown(event, index) {
    const last = tabs.length - 1;
    const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(tabs[next].key);
    tabRefs.current[tabs[next].key]?.focus();
  }

  return (
    <div className="ss-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            ref={(node) => { tabRefs.current[tab.key] = node; }}
            type="button"
            role="tab"
            id={tabId(tab.key)}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            className={`ss-tab${selected ? ' active' : ''}`}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="ss-tab-icon" aria-hidden="true"><Ic n={tab.icon} s={15} /></span>
            {tab.label}
            <span className={`ss-tab-count${tab.key === 'action' && tab.count > 0 ? ' strong' : ''}`}>{tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function StatusTabPanel({ idBase, tab, children }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${tab.key}`} className="ss-tab-panel">
      {tab.hint && <div className="ss-tab-hint">{tab.hint}</div>}
      {children}
    </div>
  );
}

// 可收合的區塊：預設收起，整列標題都可以點；右側寫「點開／收合」加箭頭，標題旁顯示內容數量。
// 傳 open／onToggle 時由外部控制（例如待生成時的「點開核對證據」）。
export function Disclosure({ title, count, open: controlledOpen, onToggle, id, nested = false, children }) {
  const bodyId = useId();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  function toggle() {
    if (onToggle) onToggle(!open);
    else setInnerOpen(!open);
  }
  return (
    <div id={id} className={`ss-disclosure${nested ? ' nested' : ''}`}>
      <button type="button" className="ss-disclosure-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <span className="ss-disclosure-title">
          {title}
          {count != null && count !== '' && <span className="ss-disclosure-count"> · {count}</span>}
        </span>
        <span className="ss-disclosure-hint">{open ? '收合' : '點開'} <span aria-hidden="true">{open ? '▴' : '▾'}</span></span>
      </button>
      <div id={bodyId} className="ss-disclosure-body" hidden={!open}>{children}</div>
    </div>
  );
}

// 手機詳情頂部的「切換腳本」抽屜：用和清單一樣的分頁列出腳本與狀態，選完直接切換，不用先回清單。
// tabs 同 StatusTabs，另帶 rows 與 variant；抽屜自己記目前分頁，初始值是清單選中的分頁。
export function ScriptSwitchSheet({ tabs, initialTab, selectedId, onSelect, onClose, returnFocusRef }) {
  const [active, setActive] = useState(initialTab);
  const current = tabs.find((tab) => tab.key === active) || tabs[0];
  return (
    <BottomSheet title="切換腳本" onClose={onClose} returnFocusRef={returnFocusRef}>
      <StatusTabs tabs={tabs} active={current.key} onChange={setActive} label="腳本狀態">
        <div className="sheet-list ss-sheet-list">
          {current.rows.length ? current.rows.map((row) => (
            <button
              key={row.script._id}
              type="button"
              className={`sheet-row${selectedId === row.script._id ? ' active' : ''}`}
              aria-current={selectedId === row.script._id ? 'true' : undefined}
              onClick={() => onSelect(row.script._id)}
            >
              <span className="sheet-row-title">{row.script.topic}</span>
              <span className="sheet-row-meta ss-sheet-meta">
                <StatusIcon statusKey={row.status.key} />
                {current.variant === 'waiting' && row.cue ? row.cue : row.status.label}
                {current.variant === 'action' && row.cue && <CueChip>{row.cue}</CueChip>}
              </span>
            </button>
          )) : <div className="sheet-empty">這個分頁沒有腳本</div>}
        </div>
      </StatusTabs>
    </BottomSheet>
  );
}

export function EmptyRow({ children }) {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
      {children}
    </div>
  );
}

export function ErrorBanner({ children, style }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      style={{
        fontSize: 13,
        color: '#ff8b72',
        padding: '11px 16px',
        background: 'rgba(255,107,107,0.08)',
        borderRadius: 12,
        border: '1px solid rgba(255,107,107,0.22)',
        overflowWrap: 'anywhere',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// 二次確認視窗：沿用回報問題對話框的樣式（手機版按鈕上下排列、主要操作在上）。
// 只在開啟時掛載；Esc、點背景關閉，焦點限制在視窗內，關閉後回到開啟前的元素。
export function ConfirmDialog({ title, children, confirmLabel, busyLabel, busy = false, danger = false, onConfirm, onCancel }) {
  const titleId = useId();
  const dialogRef = useModalDialog(busy ? () => {} : onCancel);
  return createPortal(
    <div className="issue-report-overlay" role="presentation" onMouseDown={() => { if (!busy) onCancel(); }}>
      <section
        ref={dialogRef}
        className="issue-report-dialog ss-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="ss-confirm-body">{children}</div>
        <div className="issue-report-actions">
          <button type="button" className="btn-outline" disabled={busy} onClick={onCancel}>取消</button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            style={danger ? { background: '#dc2626' } : undefined}
            onClick={onConfirm}
          >
            {busy ? busyLabel || '處理中…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
