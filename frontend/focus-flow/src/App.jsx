import { useEffect, useRef, useState } from 'react';
import './index.css';
import LiquidGradientBg from './components/LiquidGradientBg';
import Button3D          from './components/Button3D';
import BubbleScene       from './components/BubbleScene';
import LoginPage         from './components/LoginPage';
import RegisterPage      from './components/RegisterPage';
import DashboardApp      from './components/DashboardApp';
import { clearToken, clearUser } from './api';

function Cursor() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const move = (e) => {
      el.style.left = e.clientX + 'px';
      el.style.top  = e.clientY + 'px';
    };
    document.addEventListener('mousemove', move);
    return () => document.removeEventListener('mousemove', move);
  }, []);
  return <div ref={ref} className="custom-cursor" />;
}

export default function App() {
  const [page, setPage] = useState('landing');
  const [role, setRole] = useState('student');
  const [sub,  setSub]  = useState('home');

  const handleLogin = (r) => { setRole(r); setSub('home'); setPage('app'); };
  const handleLogout = () => { clearToken(); clearUser(); setPage('login'); };

  if (page === 'login') {
    return (
      <LoginPage
        onBack={() => setPage('landing')}
        onLogin={handleLogin}
        onGoRegister={() => setPage('register')}
      />
    );
  }

  if (page === 'register') {
    return (
      <RegisterPage
        onBack={() => setPage('login')}
        onRegistered={handleLogin}
      />
    );
  }

  if (page === 'app') {
    return <DashboardApp role={role} sub={sub} onNav={setSub} onLogout={handleLogout} />;
  }

  return (
    <div className="page">
      <LiquidGradientBg />
      <div className="noise-overlay" />
      <Cursor />

      <div className="layout">

        {/* ══════════════ LEFT PANEL ══════════════ */}
        <div className="left-panel">

          <svg className="orangebox" width="456" height="376" viewBox="0 0 456 376" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
            <path d="M380 188C406.602 188 419.904 188 430.064 192.269C439.002 196.024 446.269 202.016 450.823 209.385C456 217.764 456 228.731 456 250.667L456 313.333C456 335.269 456 346.236 450.823 354.615C446.269 361.984 439.002 367.976 430.064 371.731C419.904 376 406.602 376 380 376L304 376C277.397 376 264.096 376 253.935 371.731C244.998 367.976 237.731 361.984 233.177 354.615C228 346.236 228 335.269 228 313.333L228 250.667C228 228.731 228 217.764 233.177 209.385C237.731 202.016 244.998 196.024 253.935 192.269C264.096 188 277.397 188 304 188L380 188Z" fill="#F14F21"/>
            <path d="M152 1.25195e-05C178.602 1.34784e-05 191.904 1.39578e-05 202.065 4.26893C211.002 8.02397 218.269 14.0157 222.823 21.3854C228 29.7636 228 40.7313 228 62.6667L228 125.333C228 147.269 228 158.236 222.823 166.615C218.269 173.984 211.002 179.976 202.065 183.731C191.904 188 178.602 188 152 188L76 188C49.3975 188 36.0963 188 25.9355 183.731C16.9978 179.976 9.73118 173.984 5.17719 166.615C6.87041e-06 158.236 7.45183e-06 147.269 8.61466e-06 125.333L1.19367e-05 62.6667C1.30996e-05 40.7313 1.3681e-05 29.7636 5.1772 21.3854C9.73119 14.0157 16.9978 8.02396 25.9355 4.26892C36.0963 8.34205e-06 49.3975 8.82147e-06 76 9.78029e-06L152 1.25195e-05Z" fill="#F14F21"/>
            <path d="M228 138C228 138 228.222 165.556 241.721 176.686C255.219 187.817 288.638 188 288.638 188C288.638 188 256.052 188.87 242.553 200C229.055 211.13 228 238 228 238C228 238 227.778 210.444 214.279 199.314C200.781 188.183 167.362 188 167.362 188C167.362 188 199.342 186.63 212.84 175.5C226.339 164.37 228 138 228 138Z" fill="#F14F21"/>
            <rect x="274" y="202" width="138" height="150" fill="url(#pattern0_9_16)"/>
            <defs>
              <pattern id="pattern0_9_16" patternContentUnits="objectBoundingBox" width="1" height="1">
              <use xlink:href="#image0_9_16" transform="matrix(0.00205339 0 0 0.00188829 0 -0.00117631)"/>
              </pattern>
              
            </defs>
          </svg>



          <svg className="purplebox" width="456" height="376" viewBox="0 0 456 376" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M228 313.333C228 335.269 228 346.236 222.823 354.615C218.269 361.984 211.002 367.976 202.065 371.731C191.904 376 178.602 376 152 376L76 376C49.3975 376 36.0963 376 25.9355 371.731C16.9978 367.976 9.73118 361.984 5.17719 354.615C4.37217e-06 346.236 3.27002e-06 335.269 5.59569e-06 313.333L1.22398e-05 250.667C1.45655e-05 228.731 1.79933e-05 217.764 5.17721 209.385C9.73119 202.016 16.9978 196.024 25.9355 192.269C36.0963 188 49.3975 188 76 188L152 188C178.602 188 191.904 188 202.065 192.269C211.002 196.024 218.269 202.016 222.823 209.385C228 217.764 228 228.731 228 250.667L228 313.333Z" fill="#3E1B33"/>
            <path d="M456 125.333C456 147.269 456 158.236 450.823 166.615C446.269 173.984 439.002 179.976 430.065 183.731C419.904 188 406.602 188 380 188L304 188C277.397 188 264.096 188 253.935 183.731C244.998 179.976 237.731 173.984 233.177 166.615C228 158.236 228 147.269 228 125.333L228 62.6667C228 40.7313 228 29.7636 233.177 21.3854C237.731 14.0157 244.998 8.02395 253.935 4.26891C264.096 -8.16711e-07 277.398 -1.6235e-06 304 4.98163e-07L380 6.55948e-06C406.602 8.68113e-06 419.904 1.16096e-05 430.065 4.26892C439.002 8.02397 446.269 14.0157 450.823 21.3854C456 29.7636 456 40.7313 456 62.6667L456 125.333Z" fill="#3E1B33"/>
            <path d="M288.638 188C288.638 188 255.219 188.183 241.721 199.314C228.222 210.444 228 238 228 238C228 238 226.945 211.13 213.447 200C199.948 188.87 167.362 188 167.362 188C167.362 188 200.781 187.817 214.279 176.686C227.778 165.556 228 138 228 138C228 138 229.661 164.37 243.16 175.5C256.658 186.63 288.638 188 288.638 188Z" fill="#3E1B33"/>
          </svg>


          {/* Logo — top-left of step 1 */}
          <div className="logo">
            <img src="/assets/lockup-ink-mono.png" alt="Focus Flow" />
          </div>

          {/* Waveform — tall narrow, inside step 1 */}
          <img className="waveform-img" src="/assets/waveform.jpg" alt="waveform" />

          {/* Phone — right side of step 1 */}
          <img className="phone-img" src="/assets/phone.png" alt="phone" />

          {/* Step 2 stats — no card background, text directly on dark block */}
          <div className="block-2">
            <div className="stat-label">問答準確率</div>
            <div className="stat-value">98%</div>
          </div>

          {/* Step 3 stats — no card background */}
          <div className="block-3">
            <div className="stat-label">平均回應時間</div>
            <div className="stat-value">&lt;&nbsp;3s</div>
          </div>

        </div>

        {/* ══════════════ RIGHT PANEL ══════════════ */}
        <div className="right-panel">

          {/* Hero box — rounded border card */}
          <div className="hero-box">
            <div className="hero-eyebrow">FOCUS FLOW</div>
            <h1 className="hero-title">
              AI 驅動的教學影片語意檢索系統
            </h1>
            <p className="hero-desc">
              整合語音轉文字、向量檢索與生成式 AI 技術自動建立影片語意索引
              並精準定位知識片段提升學習效率與資訊存取準確性
            </p>

            <div className="hero-actions">
              <Button3D onClick={() => setPage('login')}>立 即 開 始</Button3D>

              {/* Two overlapping circles: Group 11 + Group 12 */}
              <div className="circles-pair">
                <div className="circle circle-1">
                  <img src="/assets/icon1.png" alt="" />
                </div>
                <div className="circle circle-2">
                  <img src="/assets/icon2.png" alt="" />
                </div>
              </div>
            </div>
          </div>

          {/* Middle: headline + mascot */}
          <div className="middle-section">
            <div className="middle-text">
              <div className="middle-label">重新定義你理解知識的方式</div>
              <div className="middle-headline">
                讓 影 片 不 只 是 播 放 ，&nbsp;而 是 回 應<br />
                現 在 就 開 始 與 知 識 互 動
              </div>
            </div>
            <BubbleScene />
          </div>

          {/* Features row — no border on items, separator at top */}
          <div className="features-row">
            <div className="feature-item">
              <div className="feature-title">個人學習儀表板</div>
              <div className="feature-desc">追蹤進度</div>
            </div>
            <div className="feature-item">
              <div className="feature-title">上傳影片</div>
              <div className="feature-desc">自動建立知識索引</div>
            </div>
            <div className="feature-item">
              <div className="feature-title">Line BOT 即時提問</div>
              <div className="feature-desc">秒回重點片段</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
