import { useEffect, useState } from 'react';
import { Ic } from '../components/Icons';
import { apiFetch } from '../api';

const COLORS = ['#a5b4fc', '#4ade80', '#F14F21', '#fb923c', '#38bdf8', '#f472b6'];

function formatRelativeTime(value) {
  if (!value) return '未知時間';

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '未知時間';

  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return '剛剛';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分鐘前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小時前`;
  return `${Math.floor(diffMs / day)} 天前`;
}

export default function StudentDashboard({ onNav }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/stats/student')
      .then((res) => setStats(res.data))
      .catch((err) => setError(err.message || '載入 dashboard 失敗'))
      .finally(() => setLoading(false));
  }, []);

  const courses = stats?.courseList || [];
  const recentQueries = stats?.recentQueries || [];
  const cards = [
    [stats?.weeklyQueries ?? '-', '本週提問次數', 'WEEKLY QUERIES', '最近 7 天 · 網頁 + LINE',
      '以「最近 7 天」滾動計算（不是從週一起算），來源包含網頁 AI 問答與 LINE Bot。'],
    // The backend now scopes course counts/progress to active enrollments; keep
    // the explanatory tooltip aligned with that authorization rule.
    [`${stats?.avgProgress ?? 0}%`, '平均完成進度', 'AVG PROGRESS', `${stats?.coursesCount ?? 0} 門課程平均`,
      '目前已修課且已發布課程的觀看進度平均，尚未開始的課程以 0% 列入計算。'],
    [stats?.totalQueries ?? '-', '累計提問次數', 'TOTAL QUERIES', '開始使用至今 · 網頁 + LINE',
      '從開始使用至今的所有提問（網頁 + LINE），所以會大於等於「本週提問次數」。'],
    [`${stats?.answerRate ?? 0}%`, '回答命中率', 'ANSWER RATE', '成功回答 ÷ 累計提問',
      '成功產生答案的提問數除以累計提問數。'],
  ];

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div className="ff-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 8 }}>
        {cards.map(([value, label, title, sub, tooltip]) => (
          <div key={title} className="stat-card" title={tooltip}>
            <div className="stat-lbl">{title}</div>
            <div className="stat-val">{loading ? '-' : value}</div>
            <div className="stat-sub">{label} · {sub}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)', marginBottom: 18, lineHeight: 1.6 }}>
        「本週」為最近 7 天的滾動區間，「累計」為開始使用至今的總數，兩者統計範圍不同；將滑鼠移到卡片上可看完整說明。
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.12)', color: '#fca5a5', fontSize: 12 }}>
          {error}
        </div>
      )}

      <div className="ff-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>Course Progress</div>
            <span onClick={() => onNav('courses')} style={{ fontSize: 11, color: '#F14F21', cursor: 'pointer', letterSpacing: '.04em' }}>VIEW ALL</span>
          </div>

          {loading ? (
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, padding: '12px 0' }}>載入中...</div>
          ) : courses.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, padding: '12px 0' }}>尚無課程資料</div>
          ) : (
            courses.map((course, index) => {
              const color = COLORS[index % COLORS.length];

              return (
                <div key={course.id || course.title} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 7 }}>
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{course.title}</span>
                    <span style={{ fontSize: 12, color, fontWeight: 700 }}>{course.progress}%</span>
                  </div>
                  <div className="prog-track">
                    <div className="prog-fill" style={{ width: `${course.progress}%`, background: color }} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 18 }}>Recent Queries</div>

          {loading ? (
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, padding: '12px 0' }}>載入中...</div>
          ) : recentQueries.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, padding: '12px 0' }}>尚無提問紀錄</div>
          ) : (
            recentQueries.map((item, index) => (
              <div key={item.id || index} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 11, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
                <div style={{ color: '#F14F21', flexShrink: 0 }}><Ic n="play" s={13} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.86)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.question}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.52)', marginTop: 2 }}>
                    {item.courseName} · {formatRelativeTime(item.timestamp)}
                  </div>
                </div>
                {item.contentMissing ? (
                  <span className="badge bb" title="當時提問成功，但對應影片之後已被移除">內容已下架</span>
                ) : (
                  <span className={`badge ${item.matched ? 'bg' : 'by'}`}>{item.matched ? '命中' : '未命中'}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12, padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 20, background: 'linear-gradient(135deg,rgba(6,199,85,0.1),rgba(38,12,30,0.72))' }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, background: 'rgba(6,199,85,0.2)', border: '1px solid rgba(6,199,85,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', flexShrink: 0 }}>
          <Ic n="chat" s={22} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' }}>Line Bot 即時提問</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.58)', marginTop: 3 }}>輸入問題、搜尋課程內容，快速回到重點片段</div>
        </div>
        <button onClick={() => onNav('linebot')} className="btn-primary" style={{ background: '#06C755', padding: '10px 22px', fontSize: 13, flexShrink: 0 }}>開啟 Line Bot</button>
      </div>
    </div>
  );
}
