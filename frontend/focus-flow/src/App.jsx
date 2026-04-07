import { useEffect, useRef } from 'react';
import './index.css';
import LiquidGradientBg from './components/LiquidGradientBg';
import Button3D          from './components/Button3D';
import BubbleScene       from './components/BubbleScene';

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
  return (
    <div className="page">
      <LiquidGradientBg />
      <div className="noise-overlay" />
      <Cursor />

      <div className="layout">
        {/* ══════════════ LEFT PANEL ══════════════ */}
        <div className="left-panel">

          {/* Logo */}
          <div className="logo">
            <img src="/assets/logo.png" alt="Focus Flow" />
          </div>

          {/* Decorative shapes: dark purple behind, orange offset on top */}
          <div className="shapes-stack">
            <img src="/assets/shape2.svg" alt="" style={{ opacity: 0.92 }} />
            <img src="/assets/shape1.svg" alt="" style={{ opacity: 0.95, transform: 'translate(-6px,-6px)' }} />
          </div>

          {/* Media cards */}
          <div className="media-row">
            <div className="waveform-card">
              <img src="/assets/waveform.jpg" alt="waveform" />
            </div>
            <div className="phone-card">
              <img src="/assets/phone.png" alt="phone mockup" />
            </div>
          </div>

          {/* Stat cards */}
          <div className="stats-area">
            <div className="stat-card">
              <div className="stat-label">問答準確率</div>
              <div className="stat-value">98%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">平均回應時間</div>
              <div className="stat-value">&lt;&nbsp;3s</div>
            </div>
          </div>
        </div>

        {/* ══════════════ RIGHT PANEL ══════════════ */}
        <div className="right-panel">

          {/* Hero box — border only, no fill */}
          <div className="hero-box">
            <div className="hero-eyebrow">FOCUS FLOW</div>
            <div className="hero-title">
              AI 驅動的教學影片語意檢索系統
            </div>
            <div className="hero-desc">
              整合語音轉文字、向量檢索與生成式 AI 技術自動建立影片語意索引
              並精準定位知識片段提升學習效率與資訊存取準確性
            </div>

            <div className="hero-actions">
              <Button3D>立 即 開 始</Button3D>

              {/* Two parallel overlapping circles */}
              <div className="circles-pair">
                <div className="circle">
                  <img src="/assets/icon1.png" alt="" />
                </div>
                <div className="circle">
                  <img src="/assets/icon2.png" alt="" />
                </div>
              </div>
            </div>

            {/* AI circuit icon — bottom right corner of box */}
            <div className="hero-ai-icon">
              <img src="/assets/circuit-icon.svg" alt="AI" />
            </div>
          </div>

          {/* Middle: large headline + Tinky blob */}
          <div className="middle-section">
            <div className="middle-text">
              <div className="middle-label">重新定義你理解知識的方式</div>
              <div className="middle-headline">
                讓 影 片 不 只 是 播 放 ，&nbsp;而 是 回 應<br />
                現 在 就 開 始 與 知 識 互 動
              </div>
            </div>

            {/* Pop-the-bubbles Tinky — transparent canvas */}
            <BubbleScene />
          </div>

          {/* Features — NO border, NO background */}
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
              <div className="feature-title accent">Line BOT 即時提問</div>
              <div className="feature-desc">秒回重點片段</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
