import { useState } from 'react';
import { apiFetch, setToken, setUser } from '../api';

function Sparkle({ x, y, s = 1, op = 0.3 }) {
  return (
    <svg
      style={{ position: 'absolute', left: x, top: y, opacity: op, pointerEvents: 'none' }}
      width={16 * s} height={16 * s} viewBox="0 0 16 16" fill="none"
    >
      <path d="M8 0 L9 7 L16 8 L9 9 L8 16 L7 9 L0 8 L7 7 Z" fill="white" />
    </svg>
  );
}

export default function AdminLoginPage({ onLogin, error: externalError }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    if (!email || !pw) { setError('請輸入 Email 與密碼'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pw, role: 'admin' }),
      });
      setToken(res.data.token);
      setUser(res.data.user);
      onLogin(res.data.user);
    } catch (e) {
      setError(
        e.code === 'ROLE_MISMATCH'
          ? '此帳號不是管理員，請改用一般登入入口。'
          : (e.message || '登入失敗，請確認帳號密碼'),
      );
    } finally {
      setLoading(false);
    }
  };

  const shownError = error || externalError;

  return (
    <div className="login-page">
      {/* Background */}
      <div className="ff-bg" />

      <div className="login-shell">
        {/* ── Left brand panel ── */}
        <div className="login-left">
          {/* Logo */}
          <div className="login-logo">
            <img src="/assets/lockup-white.png" alt="Focus Flow" />
          </div>

          {/* Brand copy */}
          <div className="login-brand-body">
            <div className="login-brand-eyebrow">Admin Console</div>
            <h2 className="login-brand-title">
              管理員<br />
              <span style={{ color: '#F14F21' }}>後台入口</span>
            </h2>
            <p className="login-brand-desc">
              僅供 FocusFlow 系統管理員登入，管理課程、影片、使用者與系統統計資料。
            </p>
          </div>

          {/* Decorative sparkles */}
          <Sparkle x="78%" y="30%" s={1.3} op={0.2} />
          <div className="login-glow-orb" />
        </div>

        {/* ── Divider ── */}
        <div className="login-divider" />

        {/* ── Right form panel ── */}
        <div className="login-right">
          <div className="login-form-card">
            {/* Header */}
            <div className="login-form-header">
              <div className="login-form-title">管理員登入</div>
              <div className="login-form-sub">此入口僅供管理員使用</div>
            </div>

            {/* Form fields */}
            <div className="login-fields">
              <div>
                <label className="ff-label">EMAIL ADDRESS</label>
                <input
                  className="ff-input"
                  type="email"
                  placeholder="admin@focusflow.local"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div>
                <div className="login-pw-header">
                  <label className="ff-label" style={{ marginBottom: 0 }}>PASSWORD</label>
                </div>
                <input
                  className="ff-input"
                  type="password"
                  placeholder="••••••••"
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && go()}
                />
              </div>
            </div>

            {shownError && (
              <div style={{ fontSize: 12, color: '#ff6b6b', padding: '8px 12px', background: 'rgba(255,107,107,0.1)', borderRadius: 8, border: '1px solid rgba(255,107,107,0.2)' }}>
                {shownError}
              </div>
            )}

            {/* Submit */}
            <button className="btn-primary login-submit" onClick={go} disabled={loading}>
              {loading ? '驗證中…' : '登入管理後台'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
