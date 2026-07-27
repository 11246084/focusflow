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

export default function LoginPage({ onLogin, onBack, onGoRegister }) {
  const [role, setRole] = useState('student');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    if (!email || !pw) { setError('請輸入 Email 與密碼'); return; }
    setLoading(true);
    setError('');
    try {
      // Role is part of the auth contract so a valid account cannot enter through another role's portal.
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pw, role }),
      });
      setToken(res.data.token);
      setUser(res.data.user);
      onLogin(res.data.user.role);
    } catch (e) {
      setError(
        e.code === 'ROLE_MISMATCH'
          ? '所選身分與此帳號類型不符，請切換正確身分後再登入。'
          : (e.message || '登入失敗，請確認帳號密碼'),
      );
    } finally {
      setLoading(false);
    }
  };

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
            <div className="login-brand-eyebrow">AI-Powered Learning Platform</div>
            <h2 className="login-brand-title">
              讓學習<br />
              <span style={{ color: '#F14F21' }}>智慧化</span><br />
              從這裡開始
            </h2>
            <p className="login-brand-desc">
              整合語音轉文字、向量檢索與生成式 AI 技術，自動建立影片語意索引，精準定位知識片段。
            </p>
          </div>

          {/* Stat pills */}
          <div className="login-stats">
            {[['98%', '問答準確率'], ['< 3s', '平均回應時間'], ['Vector', '語意索引']].map(([v, l]) => (
              <div key={l} className="login-stat-pill">
                <div className="login-stat-val">{v}</div>
                <div className="login-stat-lbl">{l}</div>
              </div>
            ))}
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
              <div className="login-form-title">Welcome Back</div>
              <div className="login-form-sub">選擇身份後登入系統</div>
            </div>

            {/* Role selector */}
            <div className="login-role-tabs">
              {[['student', '學生'], ['teacher', '教師'], ['admin', '管理員']].map(([r, lb]) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`login-role-btn${role === r ? ' active' : ''}`}
                >
                  {lb}
                </button>
              ))}
            </div>

            {/* Form fields */}
            <div className="login-fields">
              <div>
                <label className="ff-label">EMAIL ADDRESS</label>
                <input
                  className="ff-input"
                  type="email"
                  placeholder="your@school.edu"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div>
                <div className="login-pw-header">
                  <label className="ff-label" style={{ marginBottom: 0 }}>PASSWORD</label>
                  <span className="login-forgot">忘記密碼？</span>
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

            {error && (
              <div style={{ fontSize: 12, color: '#ff6b6b', padding: '8px 12px', background: 'rgba(255,107,107,0.1)', borderRadius: 8, border: '1px solid rgba(255,107,107,0.2)' }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button className="btn-primary login-submit" onClick={go} disabled={loading}>
              {loading ? '驗證中…' : '登入系統'}
            </button>

            <div className="login-no-account">
              沒有帳號？
              <button
                type="button"
                className="login-contact"
                onClick={onGoRegister}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  marginLeft: 4,
                  color: 'inherit',
                  font: 'inherit',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                立即註冊
              </button>
            </div>

            {/* Back link */}
            {onBack && (
              <button className="login-back-btn" onClick={onBack}>
                ← 返回首頁
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
