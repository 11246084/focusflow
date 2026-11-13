import { useEffect, useId, useRef } from 'react';
import { REJECTION_REASONS } from '../constants/videoReviewReasons';
import { Ic } from '../components/Icons';
import { MAX_DURATION_SEC, MIN_DURATION_SEC, STEPS, durationStatus, meterPercent } from '../services/recutFlow.js';

// recut 工作區共用的小元件：流程列、狀態色塊、時長尺、處理中狀態卡、確認對話框。

const TONE_ICON = { mine: 'alert', waiting: 'hourglass', done: 'checkCircle', error: 'warning', edit: 'edit' };

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
        <button type="button" className={`rc-btn ${danger ? 'rc-btn-danger' : 'rc-btn-primary'}`} onClick={busy ? undefined : onConfirm}
          aria-disabled={busy || undefined} aria-busy={busy || undefined}>
          <BusyLabel busy={busy}>{confirmLabel}</BusyLabel>
        </button>
      </div>
    </dialog>
  );
}

// 處理中：原文字隱藏但保留寬度，疊上「處理中…」，按鈕不跳寬。
function BusyLabel({ busy, children }) {
  return (
    <>
      <span style={busy ? { visibility: 'hidden' } : undefined}>{children}</span>
      {busy && <span className="rc-btn-busy">處理中…</span>}
    </>
  );
}

// 主要按鈕：後果（hint）放在按鈕上方，先讀到再按；停用原因放在按鈕下方。
// 停用時不設 disabled，改用 aria-disabled：按鈕留在 Tab 順序裡，「跳到主要動作」與螢幕報讀都找得到它和原因。
export function PrimaryAction({ label, onClick, disabled = false, reason = '', hint = '', busy = false }) {
  const noteId = useId();
  const note = disabled ? reason : hint;
  const blocked = disabled || busy;
  return (
    <div className="rc-actions">
      {!disabled && hint && <p id={noteId} className="rc-hint">{hint}</p>}
      <button type="button" className="rc-btn rc-btn-primary rc-btn-block" data-rc-primary
        data-disabled={disabled || undefined} onClick={blocked ? undefined : onClick}
        aria-disabled={blocked || undefined} aria-busy={busy || undefined}
        aria-describedby={note ? noteId : undefined}>
        <BusyLabel busy={busy}>{label}</BusyLabel>
      </button>
      {disabled && reason && <p id={noteId} className="rc-reason">{reason}</p>}
    </div>
  );
}

// 選原因的面板：原生 <dialog> 由瀏覽器負責焦點、背景不可操作與 Esc／返回手勢關閉。
// 退回原因、重新產生原因這類「點了按鈕才要選」的內容一律放這裡：手機從底部升起、電腦置中，兩邊操作一樣。
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

// 退回原因：6 項分成「內容」「影音」兩組加「其他」，一眼只要掃兩三個選項。可複選，選「其他」才要寫原因。
const REJECT_GROUPS = [
  { title: '內容', codes: ['contentIncorrect', 'incomplete'] },
  { title: '聲音、畫面、字幕', codes: ['audioIssue', 'visualQuality', 'subtitleIssue'] },
  { title: '', codes: ['other'] },
];
const REASON_BY_CODE = new Map(REJECTION_REASONS.map((reason) => [reason.code, reason]));

export function RejectReasonFields({ codes, onCodesChange, note, onNoteChange, noteTouched, onNoteTouched }) {
  const errorId = useId();
  const toggle = (code, checked) => {
    const next = new Set(codes);
    if (checked) next.add(code); else next.delete(code);
    onCodesChange(next);
  };
  const noteMissing = noteTouched && !note.trim();
  return (
    <>
      {REJECT_GROUPS.map((group) => (
        <fieldset key={group.codes[0]} className="rc-reason-group">
          {group.title ? <legend className="rc-field-label">{group.title}</legend> : <legend className="rc-visually-hidden">其他</legend>}
          <div className="rc-pills">
            {group.codes.map((code) => (
              <label key={code} className="rc-pill">
                <input type="checkbox" checked={codes.has(code)} onChange={(event) => toggle(code, event.target.checked)} />
                {REASON_BY_CODE.get(code)?.label || code}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {codes.has('other') && (
        <label style={{ display: 'block', marginTop: 12 }}>
          <span className="rc-field-label">其他原因</span>
          <textarea className="rc-textarea" value={note} maxLength={500} required
            aria-invalid={noteMissing ? 'true' : undefined} aria-describedby={noteMissing ? errorId : undefined}
            onBlur={() => onNoteTouched(true)} onChange={(event) => onNoteChange(event.target.value)} />
          {noteMissing && <p id={errorId} className="rc-error" style={{ marginTop: 6 }}>請寫下其他原因</p>}
        </label>
      )}
    </>
  );
}

// 需要時才看的說明：預設收起，按「怎麼看」才展開（原生 popover，Esc 或點外面關閉）。
export function HelpTip({ label = '怎麼看', title, children }) {
  const id = useId();
  return (
    <>
      <button type="button" className="rc-btn-text rc-help-btn" popoverTarget={id} aria-haspopup="dialog">
        <span aria-hidden="true"><Ic n="info" s={13} /></span>{label}
      </button>
      <div id={id} popover="auto" className="rc-help" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </>
  );
}
