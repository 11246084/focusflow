import { useEffect, useState } from 'react';
import {
  LINE_LOGIN_CANCELLED,
  LINE_LOGIN_INVALID_CALLBACK,
  LINE_PAGE_PATH,
  completeLineLogin,
  describeLineLoginFailure,
  describeLineLoginSuccess,
  readLineCallback,
  requestLineAuthorizeUrl,
} from '../utils/lineLogin';

const LINE_BOT_URL = import.meta.env.VITE_LINE_BOT_URL || '';

function initialResult(callback) {
  if (callback.kind === 'cancelled') return LINE_LOGIN_CANCELLED;
  if (callback.kind === 'invalid') return LINE_LOGIN_INVALID_CALLBACK;
  return null;
}

// LINE 授權完導回這一頁。SameSite=Strict 的 cookie 不會隨導回請求送出，
// 所以由這一頁載入後再以同來源請求完成綁定。
export default function LineCallback() {
  const [callback] = useState(() => readLineCallback(window.location.search));
  const [result, setResult] = useState(() => initialResult(callback));
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState('');

  useEffect(() => {
    // 授權碼不留在網址與瀏覽紀錄，重新整理也不會再送一次。
    window.history.replaceState(null, '', window.location.pathname);
    if (callback.kind !== 'authorized') return undefined;

    let active = true;
    completeLineLogin(callback)
      .then((data) => { if (active) setResult(describeLineLoginSuccess(data)); })
      .catch((error) => { if (active) setResult(describeLineLoginFailure(error)); });
    return () => { active = false; };
  }, [callback]);

  async function restart({ replaceExisting = false } = {}) {
    setRestarting(true);
    setRestartError('');
    try {
      window.location.assign(await requestLineAuthorizeUrl({ replaceExisting }));
    } catch (error) {
      setRestartError(error.message || '無法開始連結 LINE，請稍後再試。');
      setRestarting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="ff-bg" />
      <div className="login-right">
        <div className="login-form-card" role="status" aria-live="polite">
          {!result ? (
            <p>正在完成 LINE 連結…</p>
          ) : (
            <>
              <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{result.heading}</h1>
              <p style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 20 }}>{result.message}</p>
              {restartError && <p role="alert" style={{ fontSize: 13, color: '#ff6b6b', marginBottom: 12 }}>{restartError}</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {result.needsFriend && LINE_BOT_URL && (
                  <a href={LINE_BOT_URL} target="_blank" rel="noopener noreferrer" className="btn-primary login-submit" style={{ background: '#06C755', color: '#fff', textAlign: 'center', textDecoration: 'none' }}>
                    加入官方帳號
                  </a>
                )}
                {result.canReplace && (
                  <button type="button" className="btn-primary login-submit" disabled={restarting} onClick={() => restart({ replaceExisting: true })}>
                    {restarting ? '前往 LINE 中…' : '確定取代並重新連結'}
                  </button>
                )}
                {result.canRetry && (
                  <button type="button" className="btn-primary login-submit" disabled={restarting} onClick={() => restart()}>
                    {restarting ? '前往 LINE 中…' : '重新連結'}
                  </button>
                )}
                <a href={LINE_PAGE_PATH} style={{ color: 'inherit', textAlign: 'center', fontSize: 13 }}>回到 LINE 提問頁</a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
