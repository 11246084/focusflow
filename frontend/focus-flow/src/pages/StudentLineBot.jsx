import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

const LINE_BOT_URL = import.meta.env.VITE_LINE_BOT_URL || '';

export default function StudentLineBot() {
  const [user, setUser]       = useState(null);
  const [bindToken, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    apiFetch('/auth/me')
      .then(r => setUser(r.data?.user || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function getBindToken() {
    setTokenLoading(true);
    try {
      const r = await apiFetch('/line/bind-token', { method: 'POST' });
      setToken(r.data?.token || r.data?.bindToken || '');
    } catch (e) {
      setToken('（無法取得 Token：' + (e.message || '錯誤') + '）');
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

  if (loading) {
    return <div style={{ padding: 26, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>載入中…</div>;
  }

  const isBound = user?.isLineBound;

  return (
    <div className="fu scrl" style={{ padding: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="card" style={{ maxWidth: 720, width: '100%', padding: 40 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: isBound ? 'rgba(34,197,94,0.15)' : 'rgba(6,199,85,0.12)', border: `1px solid ${isBound ? 'rgba(34,197,94,0.4)' : 'rgba(6,199,85,0.25)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', flexShrink: 0 }}>
            <Ic n="chat" s={24} />
          </div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, color: '#fff' }}>Line Bot Q&amp;A</div>
            {isBound ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 50, padding: '2px 10px', marginTop: 4, fontSize: 12, color: '#4ade80', fontWeight: 600 }}>
                <span>✓</span> 已綁定 LINE 帳號
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>掃碼加入 Bot，綁定後即可直接提問</div>
            )}
          </div>
        </div>

        {/* Body: 左文字區 + 右 QR code */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 36, alignItems: 'start' }}>

          {/* 左側 */}
          <div>
            {isBound ? (
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.9 }}>
                你的 LINE 帳號已成功綁定。<br />
                直接在 LINE Bot 輸入問題，AI 會自動找到最相關的影片片段並回答。<br /><br />
                也可以在課程頁面點選「詢問助教」按鈕，Bot 會自動切換到對應課程。
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                  {[
                    ['01', '掃碼加入 Bot', '使用手機 LINE 掃右側 QR code'],
                    ['02', '取得綁定碼',   '點擊下方按鈕產生一次性驗證碼'],
                    ['03', '傳送綁定碼',   '在 Bot 聊天室貼上驗證碼送出'],
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
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>你的綁定碼（傳送給 Line Bot）：</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontFamily: 'monospace', color: '#F14F21', letterSpacing: '.06em', wordBreak: 'break-all' }}>{bindToken}</div>
                      <button onClick={copyToken} className="btn-primary" style={{ padding: '10px 16px', fontSize: 12, flexShrink: 0 }}>
                        {copied ? '✓' : '複製'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="btn-primary" style={{ width: '100%', padding: '13px', fontSize: 14 }} onClick={getBindToken} disabled={tokenLoading}>
                    {tokenLoading ? '產生中…' : '取得綁定碼'}
                  </button>
                )}
              </>
            )}
          </div>

          {/* 右側 QR code */}
          {LINE_BOT_URL && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ padding: 14, background: '#fff', borderRadius: 16 }}>
                <QRCodeSVG value={LINE_BOT_URL} size={150} bgColor="#ffffff" fgColor="#000000" />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
                手機掃碼<br />加入 LINE Bot
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
