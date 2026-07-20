import { useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

const EVENT_BADGE = { ask: 'br', clip_view: 'by', watch: 'bg', login: 'bb' };

function fmtDuration(sec) {
  if (!sec) return '—';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

export default function AdminStats() {
  const [eventStats, setEventStats] = useState({});
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch('/admin/event-stats'),
      apiFetch('/admin/events?limit=30'),
    ]).then(([es, ev]) => {
      setEventStats(es.data);
      setEvents(ev.data.events);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const statCards = [
    { ev: 'LOGIN',     lz: '登入次數',  key: 'login',     col: '#a5b4fc', ic: 'home' },
    { ev: 'WATCH',     lz: '影片觀看',  key: 'watch',     col: '#4ade80', ic: 'play' },
    { ev: 'ASK',       lz: '問答次數',  key: 'ask',       col: '#F14F21', ic: 'chat' },
    { ev: 'CLIP VIEW', lz: '短影音查看', key: 'clip_view', col: '#fb923c', ic: 'film' },
  ];

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 18 }}>Usage Statistics</div>

      <div className="ff-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {statCards.map(s => (
          <div key={s.ev} className="card" style={{ padding: 24, display: 'flex', gap: 20, alignItems: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: `${s.col}18`, border: `1px solid ${s.col}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.col, flexShrink: 0 }}>
              <Ic n={s.ic} s={22} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', letterSpacing: '.08em', marginBottom: 4 }}>{s.ev}（本月）</div>
              <div style={{ fontSize: 38, fontWeight: 900, color: loading ? 'rgba(255,255,255,0.2)' : s.col, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>
                {loading ? '—' : (eventStats[s.key] ?? 0)}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{s.lz}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12, padding: 22 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 14 }}>Event Log</div>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13, padding: 20 }}>載入中...</div>
        ) : events.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13, padding: 20 }}>尚無事件記錄</div>
        ) : (
          <div className="ff-tbl-wrap">
          <table className="ff-tbl">
            <thead>
              <tr><th>EVENT</th><th>USER</th><th>COURSE</th><th>DURATION</th><th>TIME</th></tr>
            </thead>
            <tbody>
              {events.map((r) => (
                <tr key={r.id}>
                  <td><span className={`badge ${EVENT_BADGE[r.event] || 'bb'}`}>{r.event}</span></td>
                  <td>{r.user}</td>
                  <td style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12 }}>
                    <span style={{ color: r.courseDeleted ? 'rgba(255,255,255,0.3)' : 'inherit' }}>{r.course}</span>
                    {r.contentMissing && (
                      <span className="badge bb" style={{ marginLeft: 6, fontSize: 10 }} title="此事件指向的影片之後已被刪除">內容已下架</span>
                    )}
                  </td>
                  <td style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>{fmtDuration(r.durationSec)}</td>
                  <td style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{timeAgo(r.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
