import { useEffect, useRef, useState } from 'react';

// 手機單欄的「清單 ↔ 詳情」切換。進詳情時推一筆同網址的歷史紀錄，
// 瀏覽器返回鍵就回到清單，而不是離開這一頁；在詳情裡切換項目不再推紀錄。
// historyKey 讓不同頁面的紀錄互不混用。
export default function useMobileDetailView(compact, historyKey) {
  const [mobileView, setMobileView] = useState('list');
  const viewRef = useRef('list');

  useEffect(() => {
    viewRef.current = mobileView;
  }, [mobileView]);

  useEffect(() => {
    const onPop = () => {
      if (viewRef.current === 'detail') setMobileView('list');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function showDetail() {
    if (!compact) return;
    if (viewRef.current !== 'detail') {
      try { window.history.pushState({ ...(window.history.state || {}), [historyKey]: true }, ''); } catch { /* ignore */ }
    }
    viewRef.current = 'detail';
    setMobileView('detail');
  }

  function backToList() {
    if (window.history.state?.[historyKey]) window.history.back();
    else setMobileView('list');
  }

  return { mobileView, setMobileView, showDetail, backToList };
}
