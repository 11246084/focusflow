import { useState } from 'react';
import { requestLineAuthorizeUrl } from '../utils/lineLogin';

// 開始 LINE Login：按下後導向 LINE 授權畫面，失敗時留在原頁並回報錯誤。
export default function LineLinkButton({ courseId, replaceExisting = false, label = '連結 LINE', style, onError }) {
  const [starting, setStarting] = useState(false);

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
