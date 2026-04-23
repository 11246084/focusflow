import { Ic } from '../components/Icons';

export default function AdminStats() {
  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 18 }}>Usage Statistics</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { ev: 'LOGIN',     lz: '登入次數',  val: 284, col: '#a5b4fc', ic: 'home' },
          { ev: 'WATCH',     lz: '影片觀看',  val: 156, col: '#4ade80', ic: 'play' },
          { ev: 'ASK',       lz: '問答次數',  val: 124, col: '#F14F21', ic: 'chat' },
          { ev: 'CLIP VIEW', lz: '短影音查看', val: 98,  col: '#fb923c', ic: 'film' },
        ].map(s => (
          <div key={s.ev} className="card" style={{ padding: 24, display: 'flex', gap: 20, alignItems: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: `${s.col}18`, border: `1px solid ${s.col}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.col, flexShrink: 0 }}>
              <Ic n={s.ic} s={22} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', letterSpacing: '.08em', marginBottom: 4 }}>{s.ev}（本月）</div>
              <div style={{ fontSize: 38, fontWeight: 900, color: s.col, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{s.lz}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12, padding: 22 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 14 }}>Event Log</div>
        <table className="ff-tbl">
          <thead>
            <tr><th>EVENT</th><th>USER</th><th>COURSE</th><th>DURATION</th><th>TIME</th></tr>
          </thead>
          <tbody>
            {[
              { ev: 'ask',       u: '王小明', c: 'Deep Learning', dur: '—',      t: '10 mins ago' },
              { ev: 'clip_view', u: '張雅婷', c: 'ML 導論',       dur: '2m 30s', t: '15 mins ago' },
              { ev: 'watch',     u: '林美玲', c: 'Python',        dur: '18 mins',t: '32 mins ago' },
              { ev: 'login',     u: '黃俊傑', c: '—',            dur: '—',      t: '1 hr ago'    },
              { ev: 'ask',       u: '張雅婷', c: '演算法',        dur: '—',      t: '2 hrs ago'   },
            ].map((r, i) => (
              <tr key={i}>
                <td><span className={`badge ${r.ev === 'ask' ? 'br' : r.ev === 'clip_view' ? 'by' : r.ev === 'watch' ? 'bg' : 'bb'}`}>{r.ev}</span></td>
                <td>{r.u}</td>
                <td style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12 }}>{r.c}</td>
                <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>{r.dur}</td>
                <td style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{r.t}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
