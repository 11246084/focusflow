import { useEffect, useRef, useState } from 'react';
import { apiFetch, setPendingFlowActive } from '../api';

export default function PendingVerification({ initialFlow, allowTrust = false, onDone, onCancel }) {
  const [flow, setFlow] = useState(initialFlow);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [pauseSeconds, setPauseSeconds] = useState(0);
  const busyRef = useRef(false);
  const codeRef = useRef(null);
  const passwordRef = useRef(null);
  const passwordStep = flow.purpose === 'first_login' && flow.codeVerified;

  useEffect(() => { setPendingFlowActive(true); return () => setPendingFlowActive(false); }, []);
  useEffect(() => { if (!busy) (passwordStep ? passwordRef : codeRef).current?.focus(); }, [passwordStep, busy]);
  useEffect(() => {
    if (pauseSeconds <= 0) return;
    const timer = setTimeout(() => setPauseSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [pauseSeconds]);

  async function perform(action, body) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(action); setError('');
    try {
      const response = await apiFetch(`/auth/pending${action === 'cancel' ? '' : `/${action}`}`, {
        method: action === 'cancel' ? 'DELETE' : 'POST',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
        sessionFailure: false,
      });
      if (action === 'cancel') onCancel();
      else if (response.data?.requiresVerification) {
        setFlow(response.data);
        if (action === 'resend') { setCode(''); codeRef.current?.focus(); }
      } else if (response.data?.user) onDone(response.data.user);
      else throw new Error('驗證結果不完整，請重新登入。');
    } catch (err) {
      if (err.code === 'VERIFICATION_MAIL_PAUSED') {
        setFlow((current) => ({ ...current, remainingResends: 0 }));
        setPauseSeconds(err.details?.retryAfterSec || 600);
      }
      if (err.code !== 'STALE_AUTH_RESPONSE') setError(err.code === 'PENDING_INVALID'
        ? '驗證碼錯誤、已過期或驗證流程已更新，請確認後重試；必要時返回登入。' : err.message);
    } finally { busyRef.current = false; setBusy(''); }
  }
  function verify(value = code) {
    if (!/^\d{6}$/.test(value)) return;
    void perform('verify', { code: value, trustDevice });
  }
  function savePassword(event) {
    event.preventDefault();
    if (password.length < 8 || !/[A-Za-z]/.test(password)) return setError('新密碼至少 8 碼，並包含至少一個英文字母。');
    if (password !== confirmPassword) return setError('兩次輸入的新密碼不一致。');
    void perform('password', { newPassword: password, trustDevice });
  }

  return <div className="login-page">
    <div className="ff-bg" />
    <div className="login-shell">
      <div className="login-left">
        <div className="login-logo"><img src="/assets/lockup-white.png" alt="Focus Flow" /></div>
        <div className="login-brand-body">
          <div className="login-brand-eyebrow">保護你的帳號</div>
          <h2 className="login-brand-title">完成驗證<br /><span style={{ color: '#F14F21' }}>安心使用</span></h2>
          <p className="login-brand-desc">完成信箱驗證及必要的密碼更新後，就能進入系統。</p>
        </div>
      </div>
      <div className="login-divider" />
      <section className="login-right" aria-busy={Boolean(busy)}>
        <form className="login-form-card" onSubmit={(event) => { if (passwordStep) savePassword(event); else { event.preventDefault(); verify(); } }}>
          <div className="login-form-header">
            <h1 className="login-form-title">{passwordStep ? '設定新的登入密碼' : '驗證你的信箱'}</h1>
            <p className="login-form-sub">{passwordStep ? '請使用和目前不同的密碼，至少 8 碼並包含英文字母。' : `驗證碼已寄至 ${flow.maskedEmail}，10 分鐘內有效。`}</p>
          </div>
          {allowTrust && <label className="auth-trust-device"><input type="checkbox" checked={trustDevice} onChange={(event) => setTrustDevice(event.target.checked)} disabled={Boolean(busy)} />信任這台裝置 7 天</label>}
          {passwordStep ? <div className="login-fields">
            <label className="ff-label" htmlFor="first-login-password">新密碼</label>
            <input id="first-login-password" ref={passwordRef} className="ff-input" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={Boolean(busy)} minLength={8} />
            <label className="ff-label" htmlFor="first-login-confirm">再次輸入新密碼</label>
            <input id="first-login-confirm" className="ff-input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={Boolean(busy)} />
          </div> : <div className="login-fields">
            <label className="ff-label" htmlFor="pending-code">6 位數驗證碼</label>
            <input id="pending-code" ref={codeRef} className="ff-input verification-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={Boolean(busy)} onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, '').slice(0, 6); setCode(digits);
              if (digits.length === 6) verify(digits);
            }} />
          </div>}
          {error && <div role="alert" className="auth-message auth-error">{error}</div>}
          <button type="submit" className="btn-primary login-submit" disabled={Boolean(busy) || (!passwordStep && code.length !== 6)}>
            {busy && <span className="auth-spinner" aria-hidden="true" />}{busy ? '處理中…' : passwordStep ? '更新密碼並登入' : '驗證並繼續'}
          </button>
          {!passwordStep && <>
            <p className="auth-help">收不到嗎？請檢查垃圾郵件匣</p>
            <button className="login-back-btn" type="button" disabled={Boolean(busy) || pauseSeconds > 0 || flow.remainingResends <= 0} onClick={() => void perform('resend')}>
              {busy === 'resend' && <span className="auth-spinner" aria-hidden="true" />}
              {busy === 'resend' ? '寄送中…' : `重新寄送（剩餘 ${flow.remainingResends ?? 5} 次）`}
            </button>
            {flow.remainingResends === 0 && <p role="status" className="auth-help">暫停寄信 10 分鐘；已收到且未過期的驗證碼仍可使用。{pauseSeconds > 0 ? `請於 ${Math.ceil(pauseSeconds / 60)} 分鐘後再試。` : ''}</p>}
          </>}
          <button type="button" className="login-back-btn" disabled={Boolean(busy)} onClick={() => void perform('cancel')}>返回登入</button>
        </form>
      </section>
    </div>
  </div>;
}
