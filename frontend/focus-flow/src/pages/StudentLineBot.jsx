import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

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
  const [copied, setCopied]   = useState(false);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  const [unbindError, setUnbindError] = useState('');

  useEffect(() => {
    apiFetch('/auth/me')
      .then((r) => {
        const currentUser = r.data?.user || null;
        setUser(currentUser);
        // 已綁定就不需要綁定碼，避免每次開頁都產生一筆新的綁定碼。
        if (!currentUser?.isLineBound) void getBindToken();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function getBindToken() {
    setTokenLoading(true);
    setTokenError('');
    try {
      const r = await apiFetch('/line/bind-token', { method: 'POST' });
      setToken(r.data?.token || r.data?.bindToken || '');
    } catch (e) {
      setToken('');
      setTokenError(`無法取得綁定碼：${e.message || '請稍後再試'}`);
    } finally {
      setTokenLoading(false);
    }
  }

  async function copyToken() {
    if (!bindToken) return;
    await navigator.clipboard.writeText(bindToken).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function unbind() {
    setUnbinding(true);
    setUnbindError('');
    try {
      await apiFetch('/line/binding', { method: 'DELETE' });
      setUser((current) => ({ ...current, isLineBound: false, lineBindAt: null }));
      setConfirmUnbind(false);
      void getBindToken();
    } catch (e) {
      setUnbindError(e.message || '解除綁定失敗，請稍後再試。');
    } finally {
      setUnbinding(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 26, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>載入中…</div>;
  }

  const isBound = user?.isLineBound;
  const lineOpenUrl = bindToken ? lineMessageUrl(bindToken) : LINE_BOT_URL;

  return (
    <div className="fu scrl" style={{ padding: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="card" style={{ maxWidth: 720, width: '100%', padding: 40 }}>

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
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>加入 LINE 官方帳號並完成綁定，就能直接在 LINE 提問</div>
            )}
          </div>
        </div>

        {/* Body: 左文字區 + 右 QR code */}
        <div className="ff-grid-auto" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 36, alignItems: 'start' }}>

          {/* 左側 */}
          <div>
            {isBound ? (
              <>
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.9 }}>
                  你的 LINE 帳號已成功綁定。<br />
                  直接在 LINE 輸入問題，AI 會找到最相關的影片片段並回答。<br /><br />
                  也可以在課程頁面點選「詢問助教」按鈕，LINE 會自動切換到對應課程。
                </div>

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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                  {[
                    ['01', '加入 LINE 官方帳號', '用手機掃 QR code，或在手機上直接點「在手機上開啟 LINE」'],
                    ['02', '取得綁定碼', '進入此頁會自動產生一次性綁定碼（10 分鐘內有效）'],
                    ['03', '傳送綁定碼', '在 LINE 聊天室貼上綁定碼送出；用手機開啟時會自動帶入'],
                  ].map(([step, t, d]) => (
                    <div key={step} style={{ display: 'flex', gap: 12, padding: '11px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 12 }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(241,79,33,0.2)', border: '1px solid rgba(241,79,33,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#F14F21', flexShrink: 0 }}>{step}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{t}</div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>{d}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {bindToken ? (
                  <div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>你的綁定碼（傳送到 LINE 聊天室）：</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontFamily: 'monospace', color: '#F14F21', letterSpacing: '.06em', wordBreak: 'break-all' }}>{bindToken}</div>
                      <button type="button" onClick={copyToken} className="btn-primary" style={{ padding: '10px 16px', fontSize: 12, flexShrink: 0 }}>
                        {copied ? '已複製' : '複製'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {tokenError && <div style={{ fontSize: 12, color: '#ff6b6b', marginBottom: 10 }}>{tokenError}</div>}
                    <button type="button" className="btn-primary" style={{ width: '100%', padding: '13px', fontSize: 14 }} onClick={getBindToken} disabled={tokenLoading}>
                      {tokenLoading ? '產生中…' : '取得綁定碼'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          {/* 右側 QR code；手機無法掃自己螢幕，另提供直接開啟 LINE 的按鈕 */}
          {lineOpenUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ padding: 14, background: '#fff', borderRadius: 16 }}>
                <QRCodeSVG value={lineOpenUrl} size={150} bgColor="#ffffff" fgColor="#000000" />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
                用手機 LINE 掃描
              </div>
              <a
                href={lineOpenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
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
