import { useId } from 'react';
import { createPortal } from 'react-dom';
import useModalDialog from '../hooks/useModalDialog';
import BottomSheet from '../components/BottomSheet';
import { DIVIDER, SECTION_LABEL } from './shortScriptStyles';

// 短影片腳本頁、成品上傳頁共用的小元件；樣式常數在 shortScriptStyles.js。

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

export function StatusPill({ status }) {
  return <Pill tone={DISPLAY_TONE[status.key]}>{status.label}</Pill>;
}

// 腳本清單的一列：標題（最多兩行）、下一步、狀態。row 來自 groupScripts()。
export function ScriptRow({ row, active, onOpen, last }) {
  return (
    <button
      type="button"
      className={`ss-row${active ? ' active' : ''}`}
      aria-current={active ? 'true' : undefined}
      style={{ borderBottom: last ? 'none' : DIVIDER }}
      onClick={() => onOpen(row.script._id)}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="ss-row-title">{row.script.topic}</span>
        {row.status.next && <span className="ss-row-next">下一步：{row.status.next}</span>}
      </span>
      <StatusPill status={row.status} />
    </button>
  );
}

export function ScriptRows({ rows, selectedId, onOpen, empty }) {
  if (!rows.length) return <EmptyRow>{empty}</EmptyRow>;
  return rows.map((row, index) => (
    <ScriptRow key={row.script._id} row={row} active={selectedId === row.script._id} onOpen={onOpen} last={index === rows.length - 1} />
  ));
}

export function CollapseToggle({ open, onClick, controls, label }) {
  return (
    <button type="button" className="ss-collapse-btn" aria-expanded={open} aria-controls={controls} onClick={onClick}>
      {open ? '收合' : '展開'}{label ? ` ${label}` : ''} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
  );
}

// 手機詳情頂部的「切換腳本」抽屜：依分組列出腳本與狀態，選完直接切換，不用先回清單。
// groups：[[分組標題, rows], ...]
export function ScriptSwitchSheet({ groups, selectedId, onSelect, onClose, returnFocusRef }) {
  return (
    <BottomSheet title="切換腳本" onClose={onClose} returnFocusRef={returnFocusRef}>
      {groups.map(([title, rows]) => (
        <div key={title} style={{ marginBottom: 12 }}>
          <div style={{ ...SECTION_LABEL, padding: '6px 4px' }}>{title} · {rows.length}</div>
          <div className="sheet-list">
            {rows.length ? rows.map((row) => (
              <button
                key={row.script._id}
                type="button"
                className={`sheet-row${selectedId === row.script._id ? ' active' : ''}`}
                aria-current={selectedId === row.script._id ? 'true' : undefined}
                onClick={() => onSelect(row.script._id)}
              >
                <span className="sheet-row-title">{row.script.topic}</span>
                <span className="sheet-row-meta">{row.status.label}</span>
              </button>
            )) : <div className="sheet-empty">沒有腳本</div>}
          </div>
        </div>
      ))}
    </BottomSheet>
  );
}

export function SectionCard({ title, action, children, style }) {
  return (
    <section className="card" style={{ overflow: 'hidden', ...style }}>
      <div className="ss-section-head">
        <div style={SECTION_LABEL}>{title}</div>
        {action}
      </div>
      {children}
    </section>
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
