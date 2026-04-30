import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Ic } from '../components/Icons';
import { apiFetch, BACKEND_ORIGIN } from '../api';

const LINE_BOT_URL = import.meta.env.VITE_LINE_BOT_URL || '';

// 將 add-friend URL 轉為 oaMessage URL 並預填訊息
// line.me/R/ti/p/@id -> line.me/R/oaMessage/@id/?{message}
function lineMessageUrl(text) {
  if (!LINE_BOT_URL || !text) return LINE_BOT_URL;
  const base = LINE_BOT_URL.replace('/ti/p/', '/oaMessage/');
  return `${base}/?${encodeURIComponent(text)}`;
}

// 點擊後在頁面內展開 QR code 小卡，不開新分頁
// 使用 fixed 定位避免被父容器 overflow 裁切
function AskTAButton({ courseId, courseName, variant = 'list' }) {
  const [pos, setPos] = useState(null); // null = closed, {top,right} = open
  const [url, setUrl] = useState(LINE_BOT_URL);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const btnRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!pos) return;
    const handler = (e) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        cardRef.current && !cardRef.current.contains(e.target)
      ) setPos(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pos]);

  if (!LINE_BOT_URL) return null;

  const isDetail = variant === 'detail';

  async function buildCourseBindUrl() {
    if (!courseId) return LINE_BOT_URL;

    try {
      setLoadingUrl(true);
      const res = await apiFetch('/line/bind-token', { method: 'POST' });
      const token = res.data?.token || res.data?.bindToken || '';
      return token ? lineMessageUrl(`BIND:${token}:COURSE:${courseId}`) : lineMessageUrl(`COURSE:${courseId}`);
    } catch {
      return lineMessageUrl(`COURSE:${courseId}`);
    } finally {
      setLoadingUrl(false);
    }
  }

  async function handleClick(e) {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const rect = btnRef.current.getBoundingClientRect();
    setUrl(await buildCourseBindUrl());
    setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleClick}
        className={isDetail ? 'btn-primary' : 'btn-ask-ta'}
        style={isDetail ? { background: '#06C755', padding: '10px 20px', fontSize: 13, flexShrink: 0 } : { flexShrink: 0 }}
      >
        <Ic n="chat" s={isDetail ? 14 : 13} /> 詢問助教
      </button>

      {pos && (
        <div
          ref={cardRef}
          style={{ position: 'fixed', zIndex: 1000, top: pos.top, right: pos.right, background: 'rgba(22,8,18,0.97)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          <div style={{ padding: 10, background: '#fff', borderRadius: 12 }}>
            <QRCodeSVG value={url} size={148} bgColor="#ffffff" fgColor="#000000" />
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 1.6 }}>
            {loadingUrl ? 'Building QR code' : 'Scan and send LINE message'}<br />
            <span style={{ color: '#F14F21' }}>{courseName}</span>
          </div>
        </div>
      )}
    </>
  );
}

const COLORS = ['#a5b4fc', '#4ade80', '#F14F21', '#fb923c', '#38bdf8', '#f472b6'];

function QAPanel({ courseId, videoRef, videos = [], onJumpToVideo }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState('');

  async function ask() {
    if (!question.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await apiFetch('/qa/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, question: question.trim() }),
      });
      setResult(res.data);
    } catch (e) {
      setError(e.message || '問答失敗');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 14, padding: '16px 18px', background: 'rgba(241,79,33,0.06)', border: '1px solid rgba(241,79,33,0.18)', borderRadius: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#F14F21', letterSpacing: '.06em', marginBottom: 10 }}>AI 問答</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="ff-input"
          style={{ flex: 1, margin: 0 }}
          placeholder="輸入問題…"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && ask()}
          disabled={loading}
        />
        <button className="btn-primary" style={{ padding: '10px 18px', flexShrink: 0 }} onClick={ask} disabled={loading || !question.trim()}>
          {loading ? '…' : '問'}
        </button>
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: '#ff6b6b' }}>{error}</div>}
      {result && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.7, marginBottom: 10 }}>{result.answer}</div>
          {(result.matches || result.segments || []).length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.42)', letterSpacing: '.06em', marginBottom: 6 }}>
              命中片段
            </div>
          )}
          {(result.segments || result.matches || []).slice(0, 3).map((seg, i) => {
            const start = seg.startSec ?? seg.start_sec ?? 0;
            const end = seg.endSec ?? seg.end_sec ?? start;
            const text  = seg.transcript || seg.text || seg.content || '';
            const score = typeof seg.score === 'number' ? seg.score : null;
            const matchedIndex = videos.findIndex((video) => (
              String(video._id || video.id || '') === String(seg.videoId || '')
              || String(video.videoId || video.externalVideoId || '') === String(seg.videoId || '')
            ));
            const matchedVideo = matchedIndex >= 0 ? videos[matchedIndex] : null;
            const videoTitle = formatVideoLabel(seg, matchedVideo);
            return (
              <div
                key={i}
                style={{ display: 'flex', gap: 10, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, marginBottom: 6, cursor: videoRef.current ? 'pointer' : 'default' }}
                onClick={() => {
                  if (matchedIndex >= 0 && onJumpToVideo) {
                    onJumpToVideo(matchedIndex, start);
                    return;
                  }
                  if (videoRef.current) {
                    videoRef.current.currentTime = start;
                    videoRef.current.play();
                  }
                }}
              >
                <span style={{ fontSize: 11, color: '#F14F21', fontWeight: 700, flexShrink: 0, fontFamily: 'monospace' }}>{formatTime(start)}-{formatTime(end)}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                  <span style={{ color: 'rgba(255,255,255,0.78)', fontWeight: 700 }}>{videoTitle}</span>
                  {' · '}
                  {text.slice(0, 160)}{text.length > 160 ? '…' : ''}
                  {score !== null && <span style={{ color: 'rgba(255,255,255,0.32)' }}> · score {score.toFixed(4)}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTime(sec) {
  const m = Math.floor((sec || 0) / 60);
  const s = Math.floor((sec || 0) % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatVideoLabel(segment, video = null) {
  const title = segment.videoTitle || segment.title || segment.fileName;

  if (title) {
    return title;
  }

  const videoTitle = video?.title || video?.fileName || video?.videoId || video?.externalVideoId;

  if (videoTitle) {
    return videoTitle;
  }

  const id = String(segment.videoId || '');
  return id.length > 12 ? `影片 ${id.slice(-6)}` : (id || '影片');
}

export default function StudentCourses() {
  const [courses, setCourses]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selectedCourse, setSelected]   = useState(null);
  const [videos, setVideos]             = useState([]);
  const [vLoading, setVLoading]         = useState(false);
  const [playingVid, setPlayingVid]     = useState(null);
  const videoRef = useRef(null);

  useEffect(() => {
    apiFetch('/courses')
      .then(r => { setCourses(r.data?.courses || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function openCourse(course) {
    setSelected(course);
    setPlayingVid(null);
    setVideos([]);
    setVLoading(true);
    try {
      const r = await apiFetch(`/courses/${course._id}/videos`);
      setVideos(r.data?.videos || []);
    } catch { /* ignore */ }
    finally { setVLoading(false); }
  }

  function jumpToVideo(index, startSec) {
    setPlayingVid(index);
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = startSec || 0;
        videoRef.current.play();
      }
    }, 0);
  }

  // Course detail view
  if (selectedCourse) {
    const playing = playingVid !== null ? videos[playingVid] : null;
    const videoUrl = playing?.sourceUrl ? `${BACKEND_ORIGIN}${playing.sourceUrl}` : null;

    return (
      <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <div onClick={() => { setSelected(null); setPlayingVid(null); }} style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#fff' }}>{selectedCourse.title}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>{videos.length} 部影片</div>
          </div>
          <AskTAButton courseId={selectedCourse._id} courseName={selectedCourse.title} variant="detail" />
        </div>

        <div className="course-detail-grid">
          {/* Left: video player + QA */}
          <div>
            <div style={{ borderRadius: 16, overflow: 'hidden', background: '#000', aspectRatio: '16/9', position: 'relative' }}>
              {videoUrl ? (
                <video
                  ref={videoRef}
                  key={videoUrl}
                  src={videoUrl}
                  controls
                  style={{ width: '100%', height: '100%', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'rgba(255,255,255,0.3)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  <div style={{ fontSize: 13 }}>選擇右側影片開始播放</div>
                </div>
              )}
            </div>
            {playing && (
              <div style={{ marginTop: 14, padding: '14px 18px', background: 'rgba(38,12,30,0.72)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{playing.title}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>
                  {playing.processing?.status === 'completed' ? '✓ 可提問' : `處理狀態：${playing.processing?.status || '—'}`}
                </div>
              </div>
            )}
            {playing?.processing?.status === 'completed' && (
              <QAPanel courseId={selectedCourse._id} videoRef={videoRef} videos={videos} onJumpToVideo={jumpToVideo} />
            )}
          </div>

          {/* Right: video list */}
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '.08em', marginBottom: 12 }}>LECTURES</div>
            {vLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '20px 0' }}>載入中…</div>
            ) : videos.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '20px 0' }}>此課程尚無影片</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {videos.map((v, i) => (
                  <div key={v.id || v._id || i} className={`vid-row${playingVid === i ? ' playing' : ''}`} onClick={() => setPlayingVid(i)}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: playingVid === i ? 'rgba(241,79,33,0.25)' : 'rgba(255,255,255,0.06)', border: `1px solid ${playingVid === i ? 'rgba(241,79,33,0.5)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: playingVid === i ? '#F14F21' : 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: playingVid === i ? '#fff' : 'rgba(255,255,255,0.78)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.title || v.file_name || '未命名'}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.33)', marginTop: 2 }}>
                        <span className={`badge ${v.processing?.status === 'completed' ? 'bg' : v.processing?.status === 'processing' ? 'by' : 'bb'}`} style={{ fontSize: 10 }}>
                          {v.processing?.status === 'completed' ? '可提問' : v.processing?.status === 'processing' ? '處理中' : v.processing?.status || '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Course list view
  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 20 }}>My Courses</div>
      {loading ? (
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>載入中…</div>
      ) : courses.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>目前沒有可用課程</div>
      ) : (
        <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
          {courses.map((c, i) => {
            const col = COLORS[i % COLORS.length];
            return (
              <div key={c._id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderBottom: i < courses.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ width: 46, height: 46, borderRadius: 13, background: `${col}18`, border: `1px solid ${col}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: col, flexShrink: 0 }}>
                  <Ic n="book" s={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => openCourse(c)}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 3 }}>{c.title}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>{c.description || '點擊進入課程'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <AskTAButton courseId={c._id} courseName={c.title} variant="list" />
                  <button onClick={() => openCourse(c)} className="btn-enter-course">進入課程 →</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
