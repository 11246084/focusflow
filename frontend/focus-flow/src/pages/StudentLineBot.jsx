import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Ic } from '../components/Icons';
import LineLinkButton from '../components/LineLinkButton';
import { apiFetch, getUser, setUser as storeUser } from '../api';
import { claimLineAutoStart, describeFriendStatus, isRestoredFromBackForwardCache, requestLineAuthorizeUrl } from '../utils/lineLogin';

const LINE_BOT_URL = import.meta.env.VITE_LINE_BOT_URL || '';

function lineMessageUrl(text) {
  if (!text) return LINE_BOT_URL || '';
  if (!LINE_BOT_URL) return text;
  const base = LINE_BOT_URL.replace('/ti/p/', '/oaMessage/');
  return `${base}/?${encodeURIComponent(text)}`;
}

export default function StudentLineBot() {
  const [user, setUser]       = useState(null);
  const [bindToken, setToken] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  const [unbindError, setUnbindError] = useState('');
  const [showFallback, setShowFallback] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const [autoStarting, setAutoStarting] = useState(false);

  useEffect(() => {
    apiFetch('/auth/me')
      .then((r) => {
        const currentUser = r.data?.user || null;
        setUser(currentUser);
        // 學生進這頁就是要連 LINE，不用再多按一次按鈕。
        if (currentUser && !currentUser.isLineBound && claimLineAutoStart()) void autoStartLink();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 按瀏覽器返回、頁面從 bfcache 還原時，不能停在「前往 LINE 中…」。
  useEffect(() => {
    const onPageShow = (event) => { if (isRestoredFromBackForwardCache(event)) setAutoStarting(false); };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  async function autoStartLink() {
    setAutoStarting(true);
    try {
      window.location.assign(await requestLineAuthorizeUrl());
    } catch (error) {
      handleLinkError(error);
      setAutoStarting(false);
    }
  }

  function handleLinkError(error) {
    setLinkError(error);
    if (error?.code === 'LINE_LOGIN_NOT_CONFIGURED') openFallback();
  }

  // 只有 LINE Login 不可用時才走綁定碼（正式環境的退回方式），平常學生只看到一顆按鈕。
  function openFallback() {
    setShowFallback(true);
    if (!bindToken) void getBindToken();
  }

  async function getBindToken() {
    setTokenLoading(true);
    setTokenError('');
    try {
      const r = await apiFetch('/line/bind-token', { method: 'POST' });
      setToken(r.data?.token || r.data?.bindToken || '');
    } catch (e) {
      setToken('');
      setTokenError(e.message || '請稍後再試');
    } finally {
      setTokenLoading(false);
    }
  }

  async function unbind() {
    setUnbinding(true);
    setUnbindError('');
    try {
      await apiFetch('/line/binding', { method: 'DELETE' });
      setUser((current) => ({ ...current, isLineBound: false, lineBindAt: null, lineFriendStatus: null }));
      // 課程頁的「詢問助教」讀這份快取判斷要不要顯示「連結 LINE」。
      const cachedUser = getUser();
      if (cachedUser) storeUser({ ...cachedUser, isLineBound: false });
      // 剛解除綁定的學生不該被自動帶去重新連結。
      claimLineAutoStart();
      setConfirmUnbind(false);
    } catch (e) {
      setUnbindError(e.message || '解除綁定失敗，請稍後再試。');
    } finally {
      setUnbinding(false);
    }
  }

  if (loading || autoStarting) {
    return <div style={{ padding: 26, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>{autoStarting ? '前往 LINE 中…' : '載入中…'}</div>;
  }

  const isBound = user?.isLineBound;
  const lineOpenUrl = bindToken ? lineMessageUrl(bindToken) : LINE_BOT_URL;
  const canOpenLine = Boolean(bindToken && LINE_BOT_URL);
  const showLineQr = lineOpenUrl && (isBound || canOpenLine);

  return (
    // 卡片用 margin:auto 置中：內容比畫面矮時置中，比畫面高時從頂端排列、可完整捲動。
    <div className="fu scrl" style={{ padding: 26, display: 'flex', height: '100%' }}>
      <div className="card linebot-card" style={{ maxWidth: 720, width: '100%', margin: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: isBound ? 'rgba(34,197,94,0.15)' : 'rgba(6,199,85,0.12)', border: `1px solid ${isBound ? 'rgba(34,197,94,0.4)' : 'rgba(6,199,85,0.25)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', flexShrink: 0 }}>
            <Ic n="chat" s={24} />
          </div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, color: '#fff' }}>LINE 提問</div>
            {isBound ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 50, padding: '2px 10px', marginTop: 4, fontSize: 12, color: '#4ade80', fontWeight: 600 }}>
                <span>✓</span> 已綁定 LINE 帳號
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>連結 LINE 帳號，就能直接在 LINE 提問</div>
            )}
          </div>
        </div>

        {/* Body: 左文字區 + 右 QR code */}
        <div className="ff-grid-auto" style={{ display: 'grid', gridTemplateColumns: showLineQr ? '1fr auto' : '1fr', gap: 36, alignItems: 'start' }}>

          {/* 左側 */}
          <div>
            {isBound ? (
              <>
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.9 }}>
                  你的 LINE 帳號已成功綁定。<br />
                  直接在 LINE 輸入問題，AI 會找到最相關的影片片段並回答。<br /><br />
                  也可以在課程頁面點選「詢問助教」按鈕，LINE 會自動切換到對應課程。
                </div>

                {/* 已確認加好友時不多顯示，畫面保持簡單；沒加或無法確認才提示。 */}
                {user?.lineFriendStatus !== 'friend' && (
                  <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: '#fbbf24' }}>{describeFriendStatus(user?.lineFriendStatus)}</span>
                    {LINE_BOT_URL && (
                      <a href={LINE_BOT_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#4ade80' }}>加入官方帳號</a>
                    )}
                  </div>
                )}

                <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  {confirmUnbind ? (
                    <div>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, marginBottom: 12 }}>
                        解除後，這個 LINE 帳號就不能再用你的身分提問，需要重新綁定才能使用。確定要解除嗎？
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="btn-primary" onClick={unbind} disabled={unbinding} style={{ padding: '9px 16px', fontSize: 12, background: '#dc2626' }}>
                          {unbinding ? '解除中…' : '確定解除'}
                        </button>
                        <button type="button" onClick={() => { setConfirmUnbind(false); setUnbindError(''); }} disabled={unbinding} style={{ padding: '9px 16px', fontSize: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.8)', cursor: 'pointer' }}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmUnbind(true)} style={{ padding: '9px 16px', fontSize: 12, borderRadius: 10, border: '1px solid rgba(255,107,107,0.4)', background: 'transparent', color: '#ff8b8b', cursor: 'pointer' }}>
                      解除 LINE 綁定
                    </button>
                  )}
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.38)', marginTop: 10, lineHeight: 1.6 }}>
                    換手機或想改用另一個 LINE 帳號時，先解除綁定再重新綁定。
                  </div>
                  {unbindError && <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 8 }}>{unbindError}</div>}
                </div>
              </>
            ) : (
              <>
                {showFallback ? (
                  // LINE Login 不可用時的備援：不用複製，開啟 LINE 後送出已填好的訊息即可。
                  <div className="linebot-fallback-text">
                    <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.9 }}>
                      {canOpenLine
                        ? <>開啟 LINE 後，按送出已經填好的訊息，<wbr />就完成綁定了。</>
                        : tokenLoading ? '準備中…' : '暫時無法連結 LINE，請稍後再試。'}
                      {canOpenLine && (
                        <div className="linebot-desktop-only">
                          綁定後直接在 LINE 輸入問題，AI 會找到最相關的影片片段並回答。<br /><br />
                          之後想換 LINE 或不再使用，回到這一頁就能解除綁定。
                        </div>
                      )}
                    </div>
                    {tokenError && (
                      <button type="button" className="btn-primary" style={{ width: '100%', padding: '13px', fontSize: 14, marginTop: 16 }} onClick={getBindToken} disabled={tokenLoading}>
                        重試
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.9, marginBottom: 16 }}>
                      按下按鈕，在 LINE 按「許可」並加入官方帳號就完成了，不用複製任何東西。
                    </div>
                    <LineLinkButton
                      onError={handleLinkError}
                      style={{ width: '100%', padding: '13px', fontSize: 14 }}
                    />
                    {linkError && linkError.code !== 'LINE_LOGIN_NOT_CONFIGURED' && (
                      <div role="alert" style={{ fontSize: 12, color: '#ff6b6b', marginTop: 10 }}>{linkError.message}</div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* 右側 QR code；手機無法掃自己螢幕，另提供直接開啟 LINE 的按鈕。備援畫面在手機上只留按鈕。 */}
          {showLineQr && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div className={isBound ? undefined : 'linebot-desktop-only'} style={{ padding: 14, background: '#fff', borderRadius: 16 }}>
                <QRCodeSVG value={lineOpenUrl} size={150} bgColor="#ffffff" fgColor="#000000" />
              </div>
              <div className={isBound ? undefined : 'linebot-desktop-only'} style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
                用手機 LINE 掃描
              </div>
              <a
                href={lineOpenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={isBound ? 'btn-primary' : 'btn-primary linebot-fallback-open'}
                style={{ background: '#06C755', padding: '9px 16px', fontSize: 12, textDecoration: 'none', color: '#fff', textAlign: 'center' }}
              >
                在手機上開啟 LINE
              </a>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
