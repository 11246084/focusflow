import { Ic } from '../components/Icons';

const vids = [
  { name: '第一講：機器學習概論.mp4',  size: '1.2 GB', status: 'done',       date: '2024-03-15', segs: 24,   course: 'ML 導論' },
  { name: '第二講：線性迴歸.mp4',      size: '980 MB', status: 'processing', date: '2024-03-18', segs: null, course: 'ML 導論' },
  { name: '演算法基礎 — 排序.mp4',     size: '760 MB', status: 'done',       date: '2024-03-10', segs: 18,   course: '資料結構' },
  { name: 'Python 入門 #1.mp4',       size: '540 MB', status: 'done',       date: '2024-03-08', segs: 12,   course: 'Python' },
  { name: 'Deep Learning Part 3.mp4', size: '1.5 GB', status: 'queue',      date: '2024-03-20', segs: null, course: 'Deep Learning' },
];

export default function TeacherDashboard({ onNav }) {
  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        {[
          ['4',   '課程數量', 'COURSES',        'active'],
          ['47',  '上傳影片', 'VIDEOS',         'uploaded'],
          ['318', '索引片段', 'SEGMENTS',       'vector indexed'],
          ['124', '學生提問', 'STUDENT QUERIES','this semester'],
        ].map(([v, lz, le, sub]) => (
          <div key={le} className="stat-card">
            <div className="stat-lbl">{le}</div>
            <div className="stat-val">{v}</div>
            <div className="stat-sub">{lz} · {sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Recent Videos */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>Recent Videos</div>
            <span onClick={() => onNav('courses')} style={{ fontSize: 11, color: '#F14F21', cursor: 'pointer' }}>VIEW ALL →</span>
          </div>
          {vids.slice(0, 4).map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 11, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
              <div style={{ color: '#F14F21', flexShrink: 0 }}><Ic n="film" s={14} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.33)', marginTop: 2 }}>{v.course} · {v.size}</div>
              </div>
              <span className={`badge ${v.status === 'done' ? 'bg' : v.status === 'processing' ? 'by' : 'bb'}`}>
                {v.status === 'done' ? '完成' : v.status === 'processing' ? '處理中' : '排隊'}
              </span>
            </div>
          ))}
        </div>

        {/* Top Queried Segments */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 18 }}>Top Queried Segments</div>
          {[
            { seg: '反向傳播演算法推導',         vid: 'Deep Learning P3', hits: 18 },
            { seg: 'Attention Mechanism 介紹',  vid: 'ML 導論 L7',       hits: 14 },
            { seg: '快速排序 vs 合併排序',        vid: '演算法 L4',        hits: 11 },
            { seg: 'Python List Comprehension', vid: 'Python #3',        hits: 9 },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)' }}>{item.seg}</div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.33)', marginTop: 2 }}>{item.vid}</div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#F14F21', fontFamily: "'Space Grotesk',sans-serif" }}>{item.hits}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Upload CTA */}
      <div className="card" style={{ marginTop: 12, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }} onClick={() => onNav('upload')}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(241,79,33,0.15)', border: '1px solid rgba(241,79,33,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F14F21', flexShrink: 0 }}>
          <Ic n="up" s={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>Upload New Video</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>上傳後自動執行 Whisper STT + embedding 建立索引</div>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.4)' }}><Ic n="link" s={16} /></div>
      </div>
    </div>
  );
}
