import { useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';
import { describeSwitch, formatBytes, KIND_LABELS, CLEANUP_REASON_LABELS } from '../services/youtubeLifecycle';

// function timeAgo(ts) {
//   const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
//   if (diff < 60) return `${diff}s`;
//   if (diff < 3600) return `${Math.floor(diff / 60)}m`;
//   if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
//   return `${Math.floor(diff / 86400)}d`;
// }

// 後端 /admin/system-status 的 status 值對應畫面顯示
const SERVICE_STATUS = {
  ok: { label: '正常', badge: 'bg', color: '#4ade80' },
  degraded: { label: '降級', badge: 'by', color: '#facc15' },
  down: { label: '異常', badge: 'br', color: '#f87171' },
  not_enabled: { label: '未啟用', badge: 'bb', color: 'rgba(255,255,255,0.3)' },
  unknown: { label: '未知', badge: 'bb', color: 'rgba(255,255,255,0.3)' },
};

export default function AdminOverview({ onNav }) {
  const [stats, setStats] = useState(null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [systemStatusError, setSystemStatusError] = useState(false);
  // const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/admin/stats')
      .then(s => setStats(s.data))
      .catch(() => {})
      .finally(() => setLoading(false));
    apiFetch('/admin/system-status')
      .then(res => setSystemStatus(res.data))
      .catch(() => setSystemStatusError(true));
    // Promise.all([
    //   apiFetch('/admin/stats'),
    //   apiFetch('/admin/events?limit=8'),
    // ]).then(([s, e]) => {
    //   setStats(s.data);
    //   setEvents(e.data.events);
    // }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // const evBadge = ev => ev === 'ask' ? 'br' : ev === 'clip_view' ? 'by' : ev === 'watch' ? 'bg' : 'bb';

  if (loading) return (
    <div className="fu" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
      Loading...
    </div>
  );

  const s = stats || {};
  const total = s.totalUsers || 0;

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div className="ff-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        {[
          [String(s.totalUsers ?? '—'), '使用者總數', 'users', `學生 ${s.studentCount ?? 0}・教師 ${s.teacherCount ?? 0}・管理員 ${s.adminCount ?? 0}`],
          [String(s.totalVideos ?? '—'), '影片總數', 'videos', '所有課程'],
          [String(s.totalSegments ?? '—'), '索引片段', 'segments', '可供 AI 搜尋'],
          [String(s.totalQueries ?? '—'), '提問總數', 'queries', '累計'],
        ].map(([v, lz, key, sub]) => (
          <div key={key} className="stat-card">
            <div className="stat-lbl">{lz}</div>
            <div className="stat-val">{v}</div>
            <div className="stat-sub">{sub}</div>
          </div>
        ))}
      </div>

      <div className="ff-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* User Distribution */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>使用者分布</div>
            <button type="button" onClick={() => onNav('users')} style={{ fontSize: 11, color: '#F14F21', cursor: 'pointer', background: 'none', border: 0, padding: 0 }}>管理 →</button>
          </div>
          {[['學生', s.studentCount ?? 0, '#a5b4fc'], ['教師', s.teacherCount ?? 0, '#4ade80'], ['管理員', s.adminCount ?? 0, '#F14F21']].map(([label, count, col]) => (
            <div key={label} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{label}</span>
                <span style={{ fontSize: 13, color: col, fontWeight: 700 }}>{count}</span>
              </div>
              <div className="prog-track"><div className="prog-fill" style={{ width: total > 0 ? `${count / total * 100}%` : '0%', background: col }} /></div>
            </div>
          ))}
          <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>LINE 綁定率</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="prog-track" style={{ flex: 1, marginRight: 10 }}><div className="prog-fill" style={{ width: `${s.lineBindRate ?? 0}%`, background: '#4ade80' }} /></div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', fontFamily: "'Space Grotesk',sans-serif" }}>{s.lineBindRate ?? 0}%</span>
            </div>
          </div>
        </div>

        {/* System Health — 來自後端 /admin/system-status，依設定與執行狀態判斷，不主動呼叫外部 API */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>系統服務</div>
            {systemStatus?.checkedAt && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                檢查於 {new Date(systemStatus.checkedAt).toLocaleTimeString('zh-TW')}
              </span>
            )}
          </div>
          {systemStatusError && (
            <div style={{ fontSize: 12, color: '#f87171' }}>無法取得服務狀態，請稍後重新整理。</div>
          )}
          {!systemStatusError && !systemStatus && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>讀取中...</div>
          )}
          {systemStatus?.services.map(({ key, name, status, detail }) => {
            const st = SERVICE_STATUS[status] || SERVICE_STATUS.unknown;
            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <div style={{ color: st.color, flexShrink: 0 }}>
                    <Ic n="dot" s={8} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{name}</div>
                    {detail && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2, overflowWrap: 'anywhere' }}>{detail}</div>
                    )}
                  </div>
                </div>
                <span className={`badge ${st.badge}`} style={{ flexShrink: 0 }}>{st.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <section className="card" aria-labelledby="youtube-preview-title" style={{ padding: 20, marginTop: 12 }}>
        <h2 id="youtube-preview-title" style={{ fontSize: 15, margin: '0 0 12px', color: '#fff' }}>YouTube 開關與 7 天內到期原片</h2>
        {!systemStatus && !systemStatusError && <p>讀取中...</p>}
        {(systemStatusError || systemStatus?.youtubeLifecycle?.error) && <p role="alert">無法讀取 YouTube 設定與清理預告，請稍後重新整理。狀態未知。</p>}
        {systemStatus?.youtubeLifecycle?.switches?.map(sw => {
          const state = describeSwitch(sw);
          return <p key={sw.key} data-overview-switch={sw.key} style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
            <strong>{state.label}：{state.effective ? '已啟用' : '未啟用'}</strong> · {state.note}
          </p>;
        })}
        {systemStatus?.youtubeLifecycle && !systemStatus.youtubeLifecycle.error && (
          <>
            <p style={{ fontSize: 13 }}>7 天內到期原片 {systemStatus.youtubeLifecycle.upcomingCleanupCount} 支（共 {formatBytes(systemStatus.youtubeLifecycle.upcomingCleanupBytes)}）。清單是目前估算，實際清理仍會重新檢查。</p>
            {systemStatus.youtubeLifecycle.upcomingCleanupItems?.length ? (
              <div className="ff-tbl-wrap"><table className="ff-tbl" aria-label="7 天內到期清理清單">
                <thead><tr><th>名稱／課程</th><th>類型</th><th>容量</th><th>到期時間</th><th>原因</th></tr></thead>
                <tbody>{systemStatus.youtubeLifecycle.upcomingCleanupItems.map(item => <tr key={`${item.kind}:${item.id}`}>
                  <td>{item.title}<div>{item.courseTitle || '—'}</div></td><td>{KIND_LABELS[item.kind] || item.kind}</td>
                  <td>{formatBytes(item.sizeBytes)}</td><td>{item.eligibleAt ? new Date(item.eligibleAt).toLocaleString('zh-TW', { hour12: false }) : '—'}</td>
                  <td>{CLEANUP_REASON_LABELS[item.reason] || item.reason}</td>
                </tr>)}</tbody>
              </table></div>
            ) : <p>7 天內沒有到期的原片。</p>}
          </>
        )}
      </section>

      {/* Recent Events — 暫時隱藏
      <div className="card" style={{ marginTop: 12, padding: '14px 20px' }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Recent Events (usage_logs)</div>
        {events.length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>尚無事件記錄</div>
        ) : (
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto' }}>
            {events.map((r) => (
              <div key={r.id} style={{ flexShrink: 0, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, minWidth: 140 }}>
                <span className={`badge ${evBadge(r.event)}`}>{r.event}</span>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 8 }}>{r.user}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{r.course} · {timeAgo(r.timestamp)} ago</div>
              </div>
            ))}
          </div>
        )}
      </div>
      */}
    </div>
  );
}
