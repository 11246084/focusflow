import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import useModalDialog from '../hooks/useModalDialog';

const SWIPE_CLOSE_PX = 80;

// 手機版底部抽屜：只在開啟時掛載（同 useModalDialog 的前提）。
// Esc、點背景、從標題列往下滑都會關閉；焦點限制在抽屜內，關閉後回到 returnFocusRef。
export default function BottomSheet({ title, onClose, returnFocusRef, children }) {
  const titleId = useId();
  const dialogRef = useModalDialog(onClose);
  const dragRef = useRef(null);

  // 宣告在 useModalDialog 之後，清理時比它晚執行：觸控點擊不一定讓按鈕取得焦點，
  // 所以明確把焦點送回觸發按鈕，而不是只還原開啟前的 activeElement。
  useEffect(() => {
    const target = returnFocusRef;
    return () => { target?.current?.focus(); };
  }, [returnFocusRef]);

  function handlePointerDown(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    dragRef.current = { id: event.pointerId, startY: event.clientY, dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    drag.dy = Math.max(0, event.clientY - drag.startY);
    if (dialogRef.current) dialogRef.current.style.transform = `translateY(${drag.dy}px)`;
  }
  function handlePointerEnd(event) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragRef.current = null;
    if (drag.dy > SWIPE_CLOSE_PX) { onClose(); return; }
    if (dialogRef.current) dialogRef.current.style.transform = '';
  }

  return createPortal(
    // preventDefault：點背景的 mousedown 預設會把焦點移到 body，蓋掉關閉後還原到觸發按鈕的焦點。
    <div className="bottom-sheet-overlay" role="presentation" onMouseDown={(event) => { event.preventDefault(); onClose(); }}>
      <section
        ref={dialogRef}
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header
          className="bottom-sheet-header"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <span className="bottom-sheet-handle" aria-hidden="true" />
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="bottom-sheet-close" aria-label={`關閉${title}`} onClick={onClose}>×</button>
        </header>
        <div className="bottom-sheet-body scrl">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
