import { Ic } from './Icons';

export default function Topbar({ title, sub }) {
  return (
    <div className="topbar">
      <div>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '.02em' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="btn-icon"><Ic n="search" s={15} /></div>
        <div className="btn-icon" style={{ position: 'relative' }}>
          <Ic n="bell" s={15} />
          <div style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#F14F21', border: '1.5px solid #381230' }} />
        </div>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#F14F21,#a01a50)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: '#fff', cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif" }}>王</div>
      </div>
    </div>
  );
}
