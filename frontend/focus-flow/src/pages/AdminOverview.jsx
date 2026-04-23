import { Ic } from '../components/Icons';

export default function AdminOverview({ onNav }) {
  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        {[
          ['6',   '用戶總數', 'TOTAL USERS',   '4 students, 2 teachers'],
          ['47',  '影片總量', 'TOTAL VIDEOS',  'all courses'],
          ['318', '索引片段', 'SEGMENTS',      'vector search ready'],
          ['124', '系統提問', 'TOTAL QUERIES', 'this semester'],
        ].map(([v, lz, le, sub]) => (
          <div key={le} className="stat-card">
            <div className="stat-lbl">{le}</div>
            <div className="stat-val">{v}</div>
            <div className="stat-sub">{lz} · {sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* User Distribution */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>User Distribution</div>
            <span onClick={() => onNav('users')} style={{ fontSize: 11, color: '#F14F21', cursor: 'pointer' }}>MANAGE →</span>
          </div>
          {[['學生 Student', 4, '#a5b4fc'], ['教師 Teacher', 2, '#4ade80']].map(([label, count, col]) => (
            <div key={label} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{label}</span>
                <span style={{ fontSize: 13, color: col, fontWeight: 700 }}>{count}</span>
              </div>
              <div className="prog-track"><div className="prog-fill" style={{ width: `${count / 6 * 100}%`, background: col }} /></div>
            </div>
          ))}
          <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>LINE BOT BINDING RATE</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="prog-track" style={{ flex: 1, marginRight: 10 }}><div className="prog-fill" style={{ width: '75%', background: '#4ade80' }} /></div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', fontFamily: "'Space Grotesk',sans-serif" }}>75%</span>
            </div>
          </div>
        </div>

        {/* System Health */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 18 }}>System Health</div>
          {[
            ['MongoDB Atlas',       'online'],
            ['Whisper STT API',     'online'],
            ['OpenAI Embedding',    'online'],
            ['Line Messaging API',  'online'],
            ['FFmpeg Worker',       'busy'],
            ['S3 Storage',          'online'],
          ].map(([svc, st]) => (
            <div key={svc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ color: st === 'online' ? '#4ade80' : '#facc15' }} className={st === 'busy' ? 'pls' : ''}>
                  <Ic n="dot" s={8} />
                </div>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{svc}</span>
              </div>
              <span className={`badge ${st === 'online' ? 'bg' : 'by'}`}>{st === 'online' ? '正常' : '忙碌'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Events */}
      <div className="card" style={{ marginTop: 12, padding: '14px 20px' }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Recent Events (usage_logs)</div>
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto' }}>
          {[
            { ev: 'ask',       u: '王小明', c: 'Deep Learning', t: '10m' },
            { ev: 'clip_view', u: '張雅婷', c: 'ML 導論',       t: '15m' },
            { ev: 'watch',     u: '林美玲', c: 'Python',        t: '32m' },
            { ev: 'login',     u: '黃俊傑', c: '—',            t: '1h'  },
            { ev: 'ask',       u: '張雅婷', c: '演算法',        t: '2h'  },
          ].map((r, i) => (
            <div key={i} style={{ flexShrink: 0, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, minWidth: 140 }}>
              <span className={`badge ${r.ev === 'ask' ? 'br' : r.ev === 'clip_view' ? 'by' : r.ev === 'watch' ? 'bg' : 'bb'}`}>{r.ev}</span>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 8 }}>{r.u}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{r.c} · {r.t} ago</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
