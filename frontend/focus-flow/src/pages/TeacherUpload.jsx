import { useState } from 'react';
import { Ic } from '../components/Icons';

export default function TeacherUpload() {
  const [drag, setDrag] = useState(false);
  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Upload Video</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 900 }}>
        {/* Left: drop zone + pipeline */}
        <div>
          <div
            className="upload-z"
            style={{ minHeight: 220 }}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); }}
          >
            <div style={{ color: '#F14F21' }}><Ic n="up" s={36} /></div>
            <div style={{ fontSize: 15, fontWeight: 600, color: drag ? '#fff' : 'rgba(255,255,255,0.7)' }}>拖曳影片至此</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>或點擊選取檔案</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>支援 MP4, MOV, MKV · 最大 5 GB</div>
          </div>

          <div className="card-sm" style={{ padding: '16px 18px', marginTop: 14 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '.08em', marginBottom: 12 }}>PROCESSING PIPELINE</div>
            {[
              ['01', '上傳影片',        '存入後端並同步推送至 YouTube（私人）'],
              ['02', 'YouTube Embed',  '系統取得嵌入連結供學生播放'],
              ['03', 'Whisper STT',    '語音轉逐字稿（背景非同步）'],
              ['04', 'LLM + Embedding','切段 + 向量索引寫入 MongoDB'],
              ['05', 'Ready',          '學生可觀看並透過 Line Bot 提問'],
            ].map(([n, t, d]) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(241,79,33,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#F14F21', flexShrink: 0, fontFamily: "'Space Grotesk',sans-serif" }}>{n}</div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{t}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>{d}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: form */}
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="ff-label">COURSE</label>
              <select className="ff-input">
                <option>ML 導論</option>
                <option>資料結構</option>
                <option>Python 程式設計</option>
              </select>
            </div>
            <div>
              <label className="ff-label">VIDEO TITLE</label>
              <input className="ff-input" placeholder="e.g. 第三講：邏輯迴歸" />
            </div>
            <div>
              <label className="ff-label">DESCRIPTION（選填）</label>
              <input className="ff-input" placeholder="課程說明…" />
            </div>
            <div>
              <label className="ff-label">LECTURE DATE</label>
              <input className="ff-input" type="date" style={{ colorScheme: 'dark' }} />
            </div>
          </div>
          <button className="btn-primary" style={{ width: '100%', marginTop: 20, padding: '15px' }}>
            <Ic n="up" s={16} /> 開始上傳並建立 AI 索引
          </button>
          <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(241,79,33,0.08)', border: '1px solid rgba(241,79,33,0.18)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.8 }}>
              上傳完成後系統非同步執行索引建立<br />
              <span style={{ color: '#F14F21' }}>不阻塞 UX</span>，可繼續其他操作
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
