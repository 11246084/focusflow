import { useState } from 'react';
import { apiFetch, setToken, setUser } from '../api';

export default function RegisterPage({ onRegistered, onBack }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim()) { setError('請輸入姓名'); return; }
    if (!email.trim()) { setError('請輸入 Email'); return; }
    if (pw.length < 8) { setError('密碼至少 8 個字元'); return; }
    if (pw !== pw2) { setError('兩次輸入的密碼不一致'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 只開放學生自行註冊；教師帳號由管理員建立。
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password: pw, role: 'student' }),
      });
      setToken(res.data.token);
      setUser(res.data.user);
      onRegistered(res.data.user.role);
    } catch (e) {
      setError(e.message || '註冊失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="ff-bg" />

      <div className="login-shell">
        <div className="login-left">
          <div className="login-logo">
            <img src="/assets/lockup-white.png" alt="Focus Flow" />
          </div>

          <div className="login-brand-body">
            <div className="login-brand-eyebrow">建立學生帳號</div>
            <h2 className="login-brand-title">
              加入<br />
              <span style={{ color: '#F14F21' }}>Focus Flow</span><br />
              開啟智慧學習
            </h2>
            <p className="login-brand-desc">
              註冊後即可觀看課程影片、向 AI 提問，也能在 LINE 上提問。教師帳號請洽系統管理員建立。
            </p>
          </div>

          <div className="login-glow-orb" />
        </div>

        <div className="login-divider" />

        <div className="login-right">
          <div className="login-form-card">
            <div className="login-form-header">
              <div className="login-form-title">建立學生帳號</div>
              <div className="login-form-sub">填寫資料完成註冊</div>
            </div>

            <div className="login-fields">
              <div>
                <label className="ff-label">姓名</label>
                <input
                  className="ff-input"
                  type="text"
                  placeholder="王小明"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="ff-label">Email</label>
                <input
                  className="ff-input"
                  type="email"
                  placeholder="your@school.edu"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="ff-label">密碼</label>
                <input
                  className="ff-input"
                  type="password"
                  placeholder="至少 8 個字元"
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                />
              </div>
              <div>
                <label className="ff-label">確認密碼</label>
                <input
                  className="ff-input"
                  type="password"
                  placeholder="再次輸入密碼"
                  value={pw2}
                  onChange={e => setPw2(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                />
              </div>
            </div>

            {error && (
              <div style={{ fontSize: 12, color: '#ff6b6b', padding: '8px 12px', background: 'rgba(255,107,107,0.1)', borderRadius: 8, border: '1px solid rgba(255,107,107,0.2)' }}>
                {error}
              </div>
            )}

            <button className="btn-primary login-submit" onClick={submit} disabled={loading}>
              {loading ? '建立帳號中…' : '建立帳號'}
            </button>

            <div className="login-no-account">
              已經有帳號了？
              <span
                className="login-contact"
                style={{ cursor: 'pointer', textDecoration: 'underline' }}
                onClick={onBack}
              >
                返回登入
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}