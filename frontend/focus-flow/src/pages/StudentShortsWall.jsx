import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

const CHANNEL_URL = 'https://www.youtube.com/@FocusFlow-ai413';

const GRID_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 14,
};

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return '剛剛';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} 個月前`;
  return `${Math.floor(mo / 12)} 年前`;
}

function SkeletonCard() {
  return (
    <div style={{
      borderRadius: 16, overflow: 'hidden',
      background: 'rgba(38,12,30,0.7)',
      border: '1px solid rgba(255,255,255,0.07)',
    }}>
      <div style={{ paddingTop: '177.78%', background: 'rgba(255,255,255,0.06)', position: 'relative' }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
          animation: 'ff-shimmer 1.5s infinite',
        }} />
      </div>
      <div style={{ padding: '10px 12px 14px' }}>
        <div style={{ height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.08)', marginBottom: 8 }} />
        <div style={{ height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.05)', width: '70%' }} />
      </div>
    </div>
  );
}

function VideoModal({ video, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(360px, 90vw)',
          maxHeight: '80vh',
          aspectRatio: '9/16',
          borderRadius: 18, overflow: 'hidden',
          background: '#000',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        }}
      >
        <button
          onClick={onClose}
          aria-label="關閉"
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 10,
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ✕
        </button>
        <iframe
          src={`https://www.youtube.com/embed/${video.videoId}?autoplay=1`}
          title={video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        />
      </div>
    </div>
  );
}

function VideoCard({ video, onClick }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => onClick(video)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 16, overflow: 'hidden',
        background: 'rgba(38,12,30,0.7)',
        border: '1px solid rgba(255,255,255,0.07)',
        cursor: 'pointer',
        transform: hovered ? 'translateY(-4px)' : 'none',
        boxShadow: hovered ? '0 12px 32px rgba(241,79,33,0.18)' : 'none',
        transition: 'transform .18s, box-shadow .18s',
      }}
    >
      <div style={{ position: 'relative', paddingTop: '177.78%', background: '#1a0a14' }}>
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt={video.title}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 32, opacity: 0.3 }}>▶</span>
          </div>
        )}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: hovered ? 1 : 0,
          transition: 'opacity .18s',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(241,79,33,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </div>
        </div>
      </div>
      <div style={{ padding: '10px 12px 14px' }}>
        <p style={{
          margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: '#fff',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', lineHeight: 1.4,
        }}>
          {video.title}
        </p>
        <p style={{ margin: '0 0 4px', fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
          {video.course.title}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          {relativeTime(video.publishedAt)}
        </p>
      </div>
    </div>
  );
}

export default function StudentShortsWall() {
  const [items, setItems] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);

  const fetchPage = useCallback(async (pageToken = '') => {
    const qs = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
    const body = await apiFetch('/youtube/shorts' + qs);
    return body.data;
  }, []);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPage('');
      setItems(data.items);
      setNextPageToken(data.nextPageToken);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => { loadFirst(); }, [loadFirst]);

  const loadMore = async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(nextPageToken);
      setItems((prev) => [...prev, ...data.items]);
      setNextPageToken(data.nextPageToken);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 4px' }}>
      <style>{`@keyframes ff-shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }`}</style>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 28, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "'Space Grotesk',sans-serif", fontSize: 22, fontWeight: 700, color: '#fff' }}>
            教學短片
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
            FocusFlow 官方頻道 · 精選教學影片
          </p>
        </div>
        <a
          href={CHANNEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 18px', borderRadius: 50,
            background: 'rgba(241,79,33,0.12)',
            border: '1px solid #fff',
            color: '#fff', fontSize: 13, fontWeight: 600,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.75 15.5v-7l6.25 3.5-6.25 3.5z"/>
          </svg>
          前往 YouTube 頻道 ↗
        </a>
      </div>

      {/* Error */}
      {error && !loading && (
        <div style={{
          padding: '28px 24px', borderRadius: 16, textAlign: 'center',
          background: 'rgba(241,79,33,0.08)', border: '1px solid rgba(241,79,33,0.2)',
        }}>
          <p style={{ margin: '0 0 14px', color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>
            ⚠️ {error}
          </p>
          <button
            onClick={loadFirst}
            style={{
              padding: '8px 22px', borderRadius: 50,
              background: '#F14F21', border: 'none', color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            重試
          </button>
        </div>
      )}

      {/* Skeleton */}
      {loading && (
        <div style={GRID_STYLE}>
          {Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
          目前修課尚無教學短片
        </div>
      )}

      {/* Grid */}
      {!loading && items.length > 0 && (
        <div style={GRID_STYLE}>
          {items.map((v) => (
            <VideoCard key={v.videoId} video={v} onClick={setModal} />
          ))}
        </div>
      )}

      {/* Load more */}
      {!loading && nextPageToken && (
        <div style={{ textAlign: 'center', marginTop: 28 }}>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              padding: '10px 32px', borderRadius: 50,
              background: loadingMore ? 'rgba(255,255,255,0.06)' : 'rgba(241,79,33,0.14)',
              border: '1px solid rgba(241,79,33,0.3)',
              color: loadingMore ? 'rgba(255,255,255,0.35)' : '#F14F21',
              fontSize: 13, fontWeight: 600,
              cursor: loadingMore ? 'default' : 'pointer',
              transition: 'all .15s',
            }}
          >
            {loadingMore ? '載入中…' : '載入更多'}
          </button>
        </div>
      )}

      {modal && <VideoModal video={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
