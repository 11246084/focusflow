import { Ic } from '../components/Icons';

export default function StudentLineBot() {
  return (
    <div className="fu" style={{ padding: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div className="card" style={{ maxWidth: 500, width: '100%', padding: 44, textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(6,199,85,0.15)', border: '1px solid rgba(6,199,85,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 22px', color: '#4ade80' }}>
          <Ic n="chat" s={30} />
        </div>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Line Bot Q&amp;A</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.48)', lineHeight: 1.8, marginBottom: 30 }}>
          連結 Line Bot，用自然語言提問，AI 自動找到最相關片段並秒回重點摘要與短影音
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 30, textAlign: 'left' }}>
          {[
            { step: '01', t: '輸入問題',    d: '用中文或英文自由提問' },
            { step: '02', t: '向量語意檢索', d: 'Atlas Vector Search 找最相關片段' },
            { step: '03', t: 'AI 生成摘要',  d: 'GPT-4o 萃取重點 + FFmpeg 剪輯短影音' },
            { step: '04', t: 'Line 推播回覆', d: '短影音 + 重點列表 + 原始影片時間戳' },
          ].map(({ step, t, d }) => (
            <div key={step} style={{ display: 'flex', gap: 14, padding: '12px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 12 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(241,79,33,0.2)', border: '1px solid rgba(241,79,33,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#F14F21', flexShrink: 0, fontFamily: "'Space Grotesk',sans-serif" }}>{step}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{t}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{d}</div>
              </div>
            </div>
          ))}
        </div>
        <button className="btn-primary" style={{ width: '100%', padding: '15px', background: '#06C755', fontSize: 15 }}>
          開啟 Line Bot →
        </button>
        <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>首次使用請先綁定帳號（帶 courseId 跳轉）</div>
      </div>
    </div>
  );
}
