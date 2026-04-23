import { Ic } from '../components/Icons';

const vids = [
  { name: '第一講：機器學習概論.mp4',  size: '1.2 GB', status: 'done',       date: '2024-03-15', segs: 24,   course: 'ML 導論' },
  { name: '第二講：線性迴歸.mp4',      size: '980 MB', status: 'processing', date: '2024-03-18', segs: null, course: 'ML 導論' },
  { name: '演算法基礎 — 排序.mp4',     size: '760 MB', status: 'done',       date: '2024-03-10', segs: 18,   course: '資料結構' },
  { name: 'Python 入門 #1.mp4',       size: '540 MB', status: 'done',       date: '2024-03-08', segs: 12,   course: 'Python' },
  { name: 'Deep Learning Part 3.mp4', size: '1.5 GB', status: 'queue',      date: '2024-03-20', segs: null, course: 'Deep Learning' },
];

export default function TeacherCourses() {
  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 18 }}>Course Videos</div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="ff-tbl">
          <thead>
            <tr><th>FILENAME</th><th>COURSE</th><th>SIZE</th><th>STATUS</th><th>SEGMENTS</th><th>DATE</th></tr>
          </thead>
          <tbody>
            {vids.map((v, i) => (
              <tr key={i}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ color: '#F14F21' }}><Ic n="film" s={14} /></div>
                    <span>{v.name}</span>
                  </div>
                </td>
                <td><span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{v.course}</span></td>
                <td>{v.size}</td>
                <td>
                  <span className={`badge ${v.status === 'done' ? 'bg' : v.status === 'processing' ? 'by' : 'bb'}`}>
                    {v.status === 'done' ? '完成' : v.status === 'processing' ? '處理中' : '排隊中'}
                  </span>
                </td>
                <td>{v.segs ? `${v.segs} 段` : '—'}</td>
                <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>{v.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
