import { Ic } from '../components/Icons';

const courses = [
  { name: 'Machine Learning 導論', teacher: '林教授', prog: 72, vids: 12, col: '#a5b4fc' },
  { name: '資料結構與演算法',       teacher: '陳教授', prog: 45, vids: 8,  col: '#4ade80' },
  { name: 'Python 程式設計',       teacher: '王教授', prog: 91, vids: 15, col: '#F14F21' },
  { name: 'Deep Learning 實務',    teacher: '張教授', prog: 23, vids: 10, col: '#fb923c' },
];

export default function StudentDashboard({ onNav }) {
  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        {[
          ['4.2 h', '本週學習時間',  'WEEKLY STUDY',   '+0.8h vs last week'],
          ['58%',   '平均完成進度',  'AVG PROGRESS',   '4 courses'],
          ['31',    '累計提問次數',  'TOTAL QUERIES',  'this semester'],
          ['87%',   '快取命中率',   'CACHE HIT RATE', 'no re-render'],
        ].map(([v, lz, le, sub]) => (
          <div key={le} className="stat-card">
            <div className="stat-lbl">{le}</div>
            <div className="stat-val">{v}</div>
            <div className="stat-sub">{lz} · {sub}</div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Course progress */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>Course Progress</div>
            <span onClick={() => onNav('courses')} style={{ fontSize: 11, color: '#F14F21', cursor: 'pointer', letterSpacing: '.04em' }}>VIEW ALL →</span>
          </div>
          {courses.map((c, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{c.name}</span>
                <span style={{ fontSize: 12, color: c.col, fontWeight: 700 }}>{c.prog}%</span>
              </div>
              <div className="prog-track"><div className="prog-fill" style={{ width: `${c.prog}%`, background: c.col }} /></div>
            </div>
          ))}
        </div>

        {/* Recent queries */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 18 }}>Recent Queries</div>
          {[
            { q: '反向傳播的梯度計算如何推導？', course: 'Deep Learning', t: '2 hrs ago', hit: true },
            { q: '什麼是 Attention Mechanism？',  course: 'ML 導論',       t: 'Yesterday', hit: true },
            { q: '快速排序法的最壞情況複雜度',     course: '演算法',        t: '3 days',    hit: false },
            { q: 'LSTM 與 GRU 的核心差異',       course: 'Deep Learning', t: '4 days',    hit: true },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 11, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
              <div style={{ color: '#F14F21', flexShrink: 0 }}><Ic n="play" s={13} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.q}</div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.33)', marginTop: 2 }}>{item.course} · {item.t}</div>
              </div>
              <span className={`badge ${item.hit ? 'bg' : 'by'}`}>{item.hit ? '快取' : '新建'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Line Bot CTA */}
      <div className="card" style={{ marginTop: 12, padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 20, background: 'linear-gradient(135deg,rgba(6,199,85,0.1),rgba(38,12,30,0.72))' }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, background: 'rgba(6,199,85,0.2)', border: '1px solid rgba(6,199,85,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', flexShrink: 0 }}>
          <Ic n="chat" s={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>Line Bot 即時提問</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>輸入問題 → AI 向量檢索 → 秒回重點短影音</div>
        </div>
        <button onClick={() => onNav('linebot')} className="btn-primary" style={{ background: '#06C755', padding: '10px 22px', fontSize: 13, flexShrink: 0 }}>開啟 Line Bot</button>
      </div>
    </div>
  );
}
