import { useState } from 'react';
import { Ic } from '../components/Icons';

const courses = [
  { name: 'Machine Learning 導論', teacher: '林教授', prog: 72, vids: 12, col: '#a5b4fc' },
  { name: '資料結構與演算法',       teacher: '陳教授', prog: 45, vids: 8,  col: '#4ade80' },
  { name: 'Python 程式設計',       teacher: '王教授', prog: 91, vids: 15, col: '#F14F21' },
  { name: 'Deep Learning 實務',    teacher: '張教授', prog: 23, vids: 10, col: '#fb923c' },
];

const courseVideos = {
  0: [
    { title: 'Lecture 01 — ML 簡介與應用',  dur: '32:14', ytId: 'aircAruvnKk', date: '2024-02-20' },
    { title: 'Lecture 02 — 線性迴歸',       dur: '41:08', ytId: 'nk2XZDKm_Ps', date: '2024-02-27' },
    { title: 'Lecture 03 — 邏輯迴歸',       dur: '38:55', ytId: 'hjrYrynGWGA', date: '2024-03-05' },
  ],
  1: [
    { title: 'Week 01 — 陣列與鏈結串列',    dur: '28:40', ytId: 'aircAruvnKk', date: '2024-02-18' },
    { title: 'Week 02 — Stack & Queue',    dur: '35:22', ytId: 'nk2XZDKm_Ps', date: '2024-02-25' },
  ],
  2: [
    { title: 'Py #01 — 環境設置 & 基礎語法', dur: '24:10', ytId: 'aircAruvnKk', date: '2024-02-15' },
    { title: 'Py #02 — 函式與模組',          dur: '31:05', ytId: 'nk2XZDKm_Ps', date: '2024-02-22' },
    { title: 'Py #03 — List Comprehension', dur: '19:48', ytId: 'hjrYrynGWGA', date: '2024-03-01' },
  ],
  3: [
    { title: 'DL Part 01 — Neural Network 基礎', dur: '52:18', ytId: 'aircAruvnKk', date: '2024-03-10' },
    { title: 'DL Part 02 — Backpropagation',     dur: '48:33', ytId: 'nk2XZDKm_Ps', date: '2024-03-17' },
  ],
};

function QRModal({ course, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card" style={{ maxWidth: 360, width: '90%', padding: 36, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#fff' }}>詢問助教</div>
          <div onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>✕</div>
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>{course.name}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 22 }}>掃描 QR Code 加入助教 Line Bot，系統自動帶入課程 ID</div>
        <div style={{ background: '#fff', borderRadius: 16, padding: 16, display: 'inline-block', marginBottom: 20 }}>
          <svg width="160" height="160" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="10" width="50" height="50" rx="6" fill="none" stroke="#000" strokeWidth="6"/>
            <rect x="20" y="20" width="30" height="30" rx="3" fill="#000"/>
            <rect x="100" y="10" width="50" height="50" rx="6" fill="none" stroke="#000" strokeWidth="6"/>
            <rect x="110" y="20" width="30" height="30" rx="3" fill="#000"/>
            <rect x="10" y="100" width="50" height="50" rx="6" fill="none" stroke="#000" strokeWidth="6"/>
            <rect x="20" y="110" width="30" height="30" rx="3" fill="#000"/>
            {[70,76,82,88,94].map((x,i)=>[70,76,82,88,94].map((y,j)=>(
              (i+j)%2===0 ? <rect key={`a${i}${j}`} x={x} y={y} width="4" height="4" fill="#000"/> : null
            )))}
            {[10,16,22,28,34,40,46].map((x,i)=>[70,76,82,88,94,100].map((y,j)=>(
              (i*3+j)%3!==1 ? <rect key={`b${i}${j}`} x={x} y={y} width="4" height="4" fill="#000"/> : null
            )))}
            {[70,76,82,88,94,100,106,112,118,124,130,136,142].map((x,i)=>[10,16,22,28,34,40,46].map((y,j)=>(
              (i+j*2)%3!==0 ? <rect key={`c${i}${j}`} x={x} y={y} width="4" height="4" fill="#000"/> : null
            )))}
            <rect x="68" y="68" width="24" height="24" rx="4" fill="#F14F21"/>
            <polygon points="80,72 75,80 79,80 77,88 85,76 80,76" fill="white"/>
          </svg>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 18 }}>或點擊下方按鈕直接開啟</div>
        <button className="btn-primary" style={{ width: '100%', background: '#06C755', padding: '13px', fontSize: 14 }}>
          <Ic n="chat" s={16} />
          開啟 Line Bot（自動帶入課程）
        </button>
      </div>
    </div>
  );
}

export default function StudentCourses() {
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [qrCourse, setQrCourse] = useState(null);
  const [playingVid, setPlayingVid] = useState(null);

  // Course detail view
  if (selectedCourse !== null) {
    const c = courses[selectedCourse];
    const vlist = courseVideos[selectedCourse] || [];
    const playing = playingVid !== null ? vlist[playingVid] : null;
    return (
      <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
        {qrCourse && <QRModal course={qrCourse} onClose={() => setQrCourse(null)} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <div onClick={() => { setSelectedCourse(null); setPlayingVid(null); }} style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#fff' }}>{c.name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>{c.teacher} · {c.vids} 部影片</div>
          </div>
          <button onClick={() => setQrCourse(c)} className="btn-primary" style={{ background: '#06C755', padding: '10px 20px', fontSize: 13 }}>
            <Ic n="chat" s={14} /> 詢問助教
          </button>
        </div>

        <div className="course-detail-grid">
          {/* Left: YouTube player */}
          <div>
            <div style={{ borderRadius: 16, overflow: 'hidden', background: '#000', aspectRatio: '16/9', position: 'relative' }}>
              {playing ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${playing.ytId}?autoplay=1&rel=0&modestbranding=1`}
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'rgba(20,6,16,0.9)', color: 'rgba(255,255,255,0.3)' }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </div>
                  <div style={{ fontSize: 13 }}>選擇右側影片開始播放</div>
                </div>
              )}
            </div>
            {playing && (
              <div style={{ marginTop: 14, padding: '14px 18px', background: 'rgba(38,12,30,0.72)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{playing.title}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>片長 {playing.dur} · {playing.date}</div>
              </div>
            )}
            <div style={{ marginTop: 14, padding: '14px 18px', background: 'rgba(38,12,30,0.72)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', letterSpacing: '.06em' }}>COURSE PROGRESS</span>
                <span style={{ fontSize: 13, color: c.col, fontWeight: 700 }}>{c.prog}%</span>
              </div>
              <div className="prog-track" style={{ height: 7 }}><div className="prog-fill" style={{ width: `${c.prog}%`, background: c.col }} /></div>
            </div>
          </div>

          {/* Right: video list */}
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '.08em', marginBottom: 12 }}>LECTURES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {vlist.map((v, i) => (
                <div key={i} className={`vid-row${playingVid === i ? ' playing' : ''}`} onClick={() => setPlayingVid(i)}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: playingVid === i ? 'rgba(241,79,33,0.25)' : 'rgba(255,255,255,0.06)', border: `1px solid ${playingVid === i ? 'rgba(241,79,33,0.5)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: playingVid === i ? '#F14F21' : 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: playingVid === i ? '#fff' : 'rgba(255,255,255,0.78)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.title}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.33)', marginTop: 2 }}>{v.date} · {v.dur}</div>
                  </div>
                  {playingVid === i && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F14F21', flexShrink: 0 }} />}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 18, padding: '16px 18px', background: 'linear-gradient(135deg,rgba(6,199,85,0.1),rgba(38,12,30,0.5))', border: '1px solid rgba(6,199,85,0.2)', borderRadius: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>有問題嗎？</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 14, lineHeight: 1.6 }}>掃描 QR Code 加入 Line Bot 群組，AI 助教秒回相關片段</div>
              <button onClick={() => setQrCourse(c)} style={{ width: '100%', background: '#06C755', color: '#fff', border: 'none', borderRadius: 50, padding: '11px', fontFamily: "'Noto Sans TC',sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all .2s' }}>
                <Ic n="chat" s={14} /> 詢問助教 · Ask TA
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Course list view
  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      {qrCourse && <QRModal course={qrCourse} onClose={() => setQrCourse(null)} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff' }}>My Courses</div>
        <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 14px', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}>
          <Ic n="search" s={14} />搜尋課程
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        {courses.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderBottom: i < courses.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', cursor: 'pointer', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: `${c.col}18`, border: `1px solid ${c.col}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.col, flexShrink: 0 }}>
              <Ic n="book" s={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }} onClick={() => setSelectedCourse(i)}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 3 }}>{c.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginBottom: 8 }}>{c.teacher} · {c.vids} 部影片</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="prog-track" style={{ flex: 1 }}><div className="prog-fill" style={{ width: `${c.prog}%`, background: c.col }} /></div>
                <span style={{ fontSize: 11, color: c.col, fontWeight: 700, flexShrink: 0 }}>{c.prog}%</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => setQrCourse(c)} className="btn-ask-ta">
                <Ic n="chat" s={13} /> 詢問助教
              </button>
              <button onClick={() => setSelectedCourse(i)} className="btn-enter-course">
                進入課程 →
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 18px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, fontSize: 12, color: 'rgba(255,255,255,0.38)', lineHeight: 1.7 }}>
        💡 &nbsp;點擊 <span style={{ color: '#4ade80', fontWeight: 600 }}>詢問助教</span> 掃 QR Code 加入課程 Line Bot · 點擊 <span style={{ color: '#F14F21', fontWeight: 600 }}>進入課程</span> 觀看 YouTube 嵌入影片
      </div>
    </div>
  );
}
