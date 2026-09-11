import { useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../api';

// Two-step forgot-password dialog: request a 6-digit code by email, then set a
// new password with it. The backend answers identically for unknown emails.

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.68)', padding: 18,
  },
  box: {
    width: 'min(420px, 94vw)', padding: 26, borderRadius: 18, background: '#1a0d1e',
    border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
    display: 'grid', gap: 14,
  },
  hint: { fontSize: 12.5, color: 'rgba(255,255,255,0.62)', lineHeight: 1.7, margin: 0 },
};

function describeError(error) {
  switch (error?.code) {
    case 'PASSWORD_RESET_UNAVAILABLE':
      return '系統尚未開啟寄信功能，請聯絡授課老師協助重設密碼。';
    case 'PASSWORD_RESET_EMAIL_FAILED':
      return '驗證信寄送失敗，請稍後再試，或聯絡授課老師。';
    case 'PASSWORD_RESET_CODE_INVALID':
      return '驗證碼錯誤或已過期，請重新確認，或重新寄送驗證碼。';
    default:
      return error?.message || '操作失敗，請稍後再試。';
  }
}

export default function ForgotPasswordModal({ initialEmail = '', onClose }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendCode() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('請輸入有效的 Email。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiFetch('/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setStep('code');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!/^\d{6}$/.test(code.trim())) return setError('請輸入信中的 6 位數驗證碼。');
    if (password.length < 8) return setError('新密碼至少需要 8 個字元。');
    if (password !== confirmPassword) return setError('兩次輸入的新密碼不一致。');

    setBusy(true);
    setError('');
    try {
      await apiFetch('/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword: password }),
      });
      setStep('done');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  return createPortal(
    <div style={styles.overlay} onClick={onClose} role="presentation">
      <section style={styles.box} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="forgot-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id="forgot-title" style={{ margin: 0, color: '#fff', fontSize: 17 }}>忘記密碼</h2>
          <button type="button" onClick={onClose} aria-label="關閉" style={{ border: 0, background: 'transparent', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        {step === 'email' && (
          <>
            <p style={styles.hint}>輸入登入用的 Email，我們會寄一組 6 位數驗證碼給你，10 分鐘內有效。</p>
            <input
              className="ff-input"
              type="email"
              placeholder="your@school.edu"
              value={email}
              autoFocus
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && sendCode()}
            />
            <button type="button" className="btn-primary" onClick={sendCode} disabled={busy}>
              {busy ? '寄送中…' : '寄送驗證碼'}
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            <p style={styles.hint}>
              如果 {email.trim()} 已註冊，驗證碼已寄出。請到信箱查看（找不到請看垃圾信件匣），並設定新密碼。
            </p>
            <input className="ff-input" inputMode="numeric" maxLength={6} placeholder="6 位數驗證碼" value={code} disabled={busy} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
            <input className="ff-input" type="password" autoComplete="new-password" placeholder="新密碼（至少 8 碼）" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
            <input className="ff-input" type="password" autoComplete="new-password" placeholder="再輸入一次新密碼" value={confirmPassword} disabled={busy} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && resetPassword()} />
            <button type="button" className="btn-primary" onClick={resetPassword} disabled={busy}>
              {busy ? '更新中…' : '設定新密碼'}
            </button>
            <button type="button" onClick={() => { setStep('email'); setCode(''); setError(''); }} disabled={busy} style={{ background: 'none', border: 0, color: 'rgba(255,255,255,0.55)', cursor: 'pointer', fontSize: 12 }}>
              沒收到？重新寄送（需間隔 1 分鐘）
            </button>
          </>
        )}

        {step === 'done' && (
          <>
            <p style={{ ...styles.hint, color: '#86efac' }}>密碼已更新，請用新密碼登入。</p>
            <button type="button" className="btn-primary" onClick={onClose}>回到登入</button>
          </>
        )}

        {error && (
          <div role="alert" style={{ fontSize: 12, color: '#ff6b6b', padding: '8px 12px', background: 'rgba(255,107,107,0.1)', borderRadius: 8, border: '1px solid rgba(255,107,107,0.2)' }}>
            {error}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
