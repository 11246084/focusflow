import { useEffect, useRef } from 'react';

// 定時輪詢，但分頁切到背景時暫停；回到分頁時先立刻刷新一次，再照原本間隔繼續。
// 老師開著分頁去做別的事時，不會一直替背景頁面打 API。
export default function useVisiblePolling(callback, intervalMs, enabled = true) {
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; });

  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const tick = () => { callbackRef.current?.(); };
    const start = () => { if (timer === null) timer = setInterval(tick, intervalMs); };
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      tick();
      start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs]);
}
