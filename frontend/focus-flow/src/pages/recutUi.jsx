import { useEffect, useId, useRef } from 'react';
import { Ic } from '../components/Icons';
import { MAX_DURATION_SEC, MIN_DURATION_SEC, STEPS, durationStatus, meterPercent } from '../services/recutFlow.js';

// recut 工作區共用的小元件：流程列、狀態色塊、時長尺、處理中狀態卡、確認對話框。

const TONE_ICON = { mine: 'alert', waiting: 'hourglass', done: 'checkCircle', error: 'warning' };

export function StateChip({ tone, children }) {
  return (
    <span className="rc-chip" data-tone={tone}>
      <span aria-hidden="true"><Ic n={TONE_ICON[tone] || 'dot'} s={12} /></span>
      {children}
    </span>
  );
}

// step：0 確認講稿、1 製作短片、2 確認成品、3 全部完成。
export function FlowStrip({ step, steps = STEPS }) {
  return (
    <ol className="rc-flow" aria-label="短影片進度">
      {steps.map((name, index) => {
        const state = index < step ? 'done' : index === step ? 'current' : 'todo';
        const status = state === 'done' ? '已完成' : state === 'current' ? '目前步驟' : '還沒到';
        return (
          <li key={name} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="rc-flow-mark" aria-hidden="true" />
            {name}
            <span className="rc-visually-hidden">（{status}）</span>
          </li>
        );
      })}
    </ol>
  );
}

export function DurationMeter({ seconds }) {
  const status = durationStatus(seconds);
  const from = meterPercent(MIN_DURATION_SEC);
  const to = meterPercent(MAX_DURATION_SEC);
  return (
    <div className="rc-duration" data-valid={status.valid}>
      <p className="rc-duration-value" aria-live="polite">
        <strong>{status.sec}</strong> 秒
        {!status.valid && <span className="rc-error">{status.message}</span>}
      </p>
      <div>
        <div className="rc-meter" role="img" aria-label={`總長 ${status.sec} 秒，可用範圍 ${MIN_DURATION_SEC} 到 ${MAX_DURATION_SEC} 秒`}>
          <span className="rc-meter-range" style={{ left: `${from}%`, width: `${to - from}%` }} />
          <span className="rc-meter-fill" style={{ width: `${meterPercent(seconds)}%` }} />
        </div>
        <div className="rc-meter-scale" aria-hidden="true">
          {[0, MIN_DURATION_SEC, MAX_DURATION_SEC].map((value) => (
            <span key={value} style={{ left: `${meterPercent(value)}%` }}>{value}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatusCard({ title, children, action }) {
  return (
    <section className="rc-panel rc-status" role="status">
      <h2>{title}</h2>
      <progress aria-label={title} />
      {children}
      {action}
    </section>
  );
}

// 原生 <dialog>：瀏覽器負責焦點、背景不可操作、Esc 關閉與返回焦點。
// open 改為 true 時以 showModal() 開啟；關閉（含 Esc）一律回呼 onClose。
export function ConfirmDialog({ open, title, children, confirmLabel, danger = false, busy = false, onConfirm, onClose }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="rc-dialog rc" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>{title}</h2>
      {children}
      <div className="rc-dialog-actions">
        <button type="button" className="rc-btn rc-btn-outline" autoFocus onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className={`rc-btn ${danger ? 'rc-btn-danger' : 'rc-btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? '處理中…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

// 停用的主要按鈕旁只留一句原因。
// hint：按下後會發生、老師需要先知道的一句後果（只用在核准這類關鍵動作），可按時才顯示。
export function PrimaryAction({ label, onClick, disabled = false, reason = '', hint = '', busy = false }) {
  const noteId = useId();
  const note = disabled ? reason : hint;
  return (
    <div className="rc-actions">
      <button type="button" className="rc-btn rc-btn-primary rc-btn-block" onClick={onClick}
        disabled={disabled || busy} aria-describedby={note ? noteId : undefined}>
        {busy ? '處理中…' : label}
      </button>
      {note && <p id={noteId} className="rc-reason">{note}</p>}
    </div>
  );
}

// 手機的底部面板：原生 <dialog> 由瀏覽器負責焦點、背景不可操作與 Esc／返回手勢關閉。
// 退回原因、重新產生原因這類「點了按鈕才要選」的內容放這裡，選項與送出按鈕都在拇指範圍內。
export function SheetDialog({ open, title, onClose, action, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="rc-sheet rc" aria-labelledby={titleId} onClose={onClose} {...{ closedby: 'any' }}>
      <div className="rc-sheet-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="rc-btn-text" onClick={onClose}>取消</button>
      </div>
      {children}
      <div className="rc-sheet-action">{action}</div>
    </dialog>
  );
}
