import { useEffect, useState } from 'react';
import { isRestoredFromBackForwardCache, requestLineAuthorizeUrl } from '../utils/lineLogin';

// 開始 LINE Login：按下後導向 LINE 授權畫面，失敗時留在原頁並回報錯誤。
export default function LineLinkButton({ courseId, replaceExisting = false, label = '連結 LINE', style, onError }) {
  const [starting, setStarting] = useState(false);

  // 按瀏覽器返回、頁面從 bfcache 還原時，解除「前往 LINE 中…」的停用狀態。
  useEffect(() => {
    const onPageShow = (event) => { if (isRestoredFromBackForwardCache(event)) setStarting(false); };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  async function start() {
    setStarting(true);
    onError?.(null);
    try {
      window.location.assign(await requestLineAuthorizeUrl({ courseId, replaceExisting }));
    } catch (error) {
      onError?.(error);
      setStarting(false);
    }
  }

  return (
    <button
      type="button"
      className="btn-primary"
      onClick={start}
      disabled={starting}
      style={{ background: '#06C755', ...style }}
    >
      {starting ? '前往 LINE 中…' : label}
    </button>
  );
}
