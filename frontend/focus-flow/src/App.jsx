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

          {/* Staircase SVG — two layers: dark full shape + orange top */}
          <svg
            className="staircase-svg"
            viewBox="0 0 500 700"
            preserveAspectRatio="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Full staircase — dark purple */}
            <path
              d="M 24 0 H 476 Q 500 0 500 24 V 300 Q 500 324 476 324 H 380 A 24 24 0 0 0 356 348 V 476 Q 356 500 332 500 H 240 A 24 24 0 0 0 216 524 V 676 Q 216 700 192 700 H 24 Q 0 700 0 676 V 24 Q 0 0 24 0 Z"
              fill="rgba(18, 6, 38, 0.78)"
            />
            {/* Step 1 orange overlay */}
            <path
              d="M 24 0 H 476 Q 500 0 500 24 V 300 Q 500 324 476 324 H 24 Q 0 324 0 300 V 24 Q 0 0 24 0 Z"
              fill="rgba(210, 62, 16, 0.82)"
            />
          </svg>

          {/* Logo — top-left inside orange area */}
          <div className="logo">
            <img src="/assets/logo.png" alt="Focus Flow" />
          </div>

          {/* Waveform — tall narrow, left side */}
          <img
            className="waveform-img"
            src="/assets/waveform.jpg"
            alt="waveform"
          />

          {/* Phone — transparent cutout, right of waveform */}
          <img
            className="phone-img"
            src="/assets/phone.png"
            alt="phone"
          />

          {/* Stats — inside the lower dark steps */}
          <div className="stat-card stat-98">
            <div className="stat-label">問答準確率</div>
            <div className="stat-value">98%</div>
          </div>
          <div className="stat-card stat-3s">
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
              <Button3D>立 即 開 始</Button3D>

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

            {/* Circuit icon — bottom-right inside hero box */}
            <div className="hero-ai-icon">
              <img src="/assets/circuit-icon.svg" alt="AI" />
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
              <div className="feature-title accent">Line BOT 即時提問</div>
              <div className="feature-desc">秒回重點片段</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
