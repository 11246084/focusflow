import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Ic } from '../components/Icons';
import { apiFetch, BACKEND_ORIGIN } from '../api';
import {
  SOURCE_PREVIEW_COUNT,
  formatConversationDate,
  getRemainingSourceCount,
  getVisibleSources,
  mapConversationMessage,
  scrollConversationMessageIntoView,
  toStudentCitation,
} from './qaConversationUtils';

const LINE_BOT_URL = import.meta.env.VITE_LINE_BOT_URL || '';
let youtubeApiPromise = null;

// 將 add-friend URL 轉為 oaMessage URL 並預填訊息
// line.me/R/ti/p/@id -> line.me/R/oaMessage/@id/?{message}
function lineMessageUrl(text) {
  if (!text) return LINE_BOT_URL || '';
  if (!LINE_BOT_URL) return text;
  const base = LINE_BOT_URL.replace('/ti/p/', '/oaMessage/');
  return `${base}/?${encodeURIComponent(text)}`;
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve) => {
      const previousReady = window.onYouTubeIframeAPIReady;

      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousReady === 'function') previousReady();
        resolve(window.YT);
      };

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.body.appendChild(script);
      }
    });
  }

  return youtubeApiPromise;
}

function extractYouTubeVideoId(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;

  const patterns = [
    /[?&]v=([^&#]+)/,
    /youtu\.be\/([^?&#/]+)/,
    /\/shorts\/([^?&#/]+)/,
    /\/embed\/([^?&#/]+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function resolveVideoPlayback(video) {
  if (!video) return { type: 'none', youtubeId: null, videoUrl: null };

  const sourceType = String(video.sourceType || video.videoSource || video.video_source || '').toLowerCase();
  const youtubeId = (
    extractYouTubeVideoId(video.youtubeVideoId)
    || extractYouTubeVideoId(video.youtube_video_id)
    || extractYouTubeVideoId(video.videoUrl)
    || extractYouTubeVideoId(video.video_url)
    || extractYouTubeVideoId(video.sourceUrl)
  );

  if (youtubeId) {
    return { type: 'youtube', youtubeId, videoUrl: null };
  }

  if (sourceType === 'youtube' || video.metadataOnly || video.qaScopeOnly) {
    return { type: 'unavailable', youtubeId: null, videoUrl: null };
  }

  const sourceUrl = video.sourceUrl || video.videoUrl || video.video_url;
  if (!sourceUrl) return { type: 'none', youtubeId: null, videoUrl: null };

  const textUrl = String(sourceUrl);
  const videoUrl = textUrl.startsWith('/uploads/')
    ? `${BACKEND_ORIGIN}${textUrl}`
    : textUrl;

  return { type: 'upload', youtubeId: null, videoUrl };
}

function YouTubePlayer({ videoId, seekRequest, onWatched }) {
  const wrapperRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const seekRequestRef = useRef(seekRequest);
  const onWatchedRef = useRef(onWatched);
  const watchedFiredRef = useRef(false);
  const progressTimerRef = useRef(null);

  useEffect(() => {
    seekRequestRef.current = seekRequest;
  }, [seekRequest]);

  useEffect(() => {
    onWatchedRef.current = onWatched;
  }, [onWatched]);

  useEffect(() => {
    let cancelled = false;
    // Capture this effect's host so cleanup never mutates a newer render's DOM node.
    const wrapperElement = wrapperRef.current;
    readyRef.current = false;
    watchedFiredRef.current = false;

    loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !wrapperElement) return;

      wrapperElement.replaceChildren();
      const playerHost = document.createElement('div');
      wrapperElement.appendChild(playerHost);

      const fireWatched = () => {
        if (watchedFiredRef.current) return;
        watchedFiredRef.current = true;
        if (typeof onWatchedRef.current === 'function') onWatchedRef.current();
      };

      playerRef.current = new YT.Player(playerHost, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: {
          enablejsapi: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: (event) => {
            readyRef.current = true;
            const pendingSeek = seekRequestRef.current;
            if (pendingSeek?.startSec != null) {
              event.target.seekTo(Math.max(0, Number(pendingSeek.startSec) || 0), true);
              event.target.playVideo();
            }
          },
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.ENDED) {
              fireWatched();
              return;
            }
            if (event.data === YT.PlayerState.PLAYING && !progressTimerRef.current) {
              progressTimerRef.current = setInterval(() => {
                try {
                  const cur = playerRef.current?.getCurrentTime?.() || 0;
                  const dur = playerRef.current?.getDuration?.() || 0;
                  if (dur > 0 && cur / dur >= 0.8) fireWatched();
                } catch { /* ignore */ }
              }, 5000);
            }
            if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
              if (progressTimerRef.current) {
                clearInterval(progressTimerRef.current);
                progressTimerRef.current = null;
              }
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      try {
        if (playerRef.current?.destroy) {
          playerRef.current.destroy();
        }
      } catch {
        // YouTube mutates its own iframe during teardown; keep React's wrapper stable.
      } finally {
        playerRef.current = null;
        if (wrapperElement) {
          wrapperElement.replaceChildren();
        }
      }
    };
  }, [videoId]);

  useEffect(() => {
    if (!readyRef.current || !playerRef.current || seekRequest?.startSec == null) return;

    playerRef.current.seekTo(Math.max(0, Number(seekRequest.startSec) || 0), true);
    playerRef.current.playVideo();
  }, [seekRequest]);

  return <div ref={wrapperRef} style={{ width: '100%', height: '100%' }} />;
}

// 點擊後在頁面內展開 QR code 小卡，不開新分頁
// 使用 fixed 定位避免被父容器 overflow 裁切
function AskTAButton({ courseId, courseName, variant = 'list' }) {
  const [pos, setPos] = useState(null); // null = closed, {top,right} = open
  const [url, setUrl] = useState(LINE_BOT_URL || '');
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

  const isDetail = variant === 'detail';

  async function buildCourseBindUrl() {
    if (!courseId) return LINE_BOT_URL || '';

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
            {loadingUrl ? '產生 QR code 中…' : '用手機 LINE 掃描後送出訊息'}<br />
            <span style={{ color: '#F14F21' }}>{courseName}</span>
          </div>
          {/* 手機上無法用同一支手機掃 QR code，直接開啟 LINE 並帶入訊息 */}
          {url && !loadingUrl && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
              style={{ background: '#06C755', padding: '8px 16px', fontSize: 12, textDecoration: 'none', color: '#fff' }}
            >
              在手機上開啟 LINE
            </a>
          )}
        </div>
      )}
    </>
  );
}

const COLORS = ['#a5b4fc', '#4ade80', '#F14F21', '#fb923c', '#38bdf8', '#f472b6'];

// 命中片段預設顯示筆數。backend 回傳筆數由 QA_MATCH_LIMIT 決定（2026-07-25 起為 15），
// 全列會洗掉整個問答面板，因此預設只列前幾筆、可展開。
// 展開能力是必要的：答案結尾的「依據」可能引用超過這個數量的片段，
// 學生要能點到每一個被引用的時間戳。
const SEGMENT_PREVIEW_COUNT = SOURCE_PREVIEW_COUNT;

function normalizeAnswerLines(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    // AI responses sometimes place numbered or bulleted items in one paragraph.
    .replace(/([^\n])\s+(?=(?:\d+[.)、](?:\s|\*\*)|[一二三四五六七八九十]+[、.．](?:\s|\*\*)|[-•]\s+))/g, '$1\n')
    .split('\n');
}

function renderAnswerInline(text, lineIndex) {
  const parts = String(text).split(/(\*\*[^*\n]+\*\*)/g);

  return parts.map((part, partIndex) => {
    const key = `${lineIndex}-${partIndex}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    // Never leak incomplete Markdown bold delimiters into the visible answer.
    return <span key={key}>{part.replaceAll('**', '')}</span>;
  });
}

function getAnswerBlocks(answer) {
  const blocks = [];
  let paragraph = [];
  let list = null;

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  }

  function flushList() {
    if (list) {
      blocks.push(list);
      list = null;
    }
  }

  normalizeAnswerLines(answer).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', text: heading[1] });
      return;
    }

    const ordered = line.match(/^(?:\d+[.)、]|[一二三四五六七八九十]+[、.．])\s*(.+)$/);
    const unordered = line.match(/^(?:[-•*])\s+(.+)$/);
    if (ordered || unordered) {
      flushParagraph();
      const type = ordered ? 'ordered-list' : 'unordered-list';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((ordered || unordered)[1]);
      return;
    }

    flushList();
    paragraph.push(line);
  });

  flushParagraph();
  flushList();
  return blocks;
}

function AnswerContent({ answer }) {
  return (
    <div className="qa-answer">
      {getAnswerBlocks(answer).map((block, index) => {
        if (block.type === 'heading') {
          return <h3 key={index}>{renderAnswerInline(block.text, index)}</h3>;
        }
        if (block.type === 'ordered-list') {
          return <ol key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderAnswerInline(item, `${index}-${itemIndex}`)}</li>)}</ol>;
        }
        if (block.type === 'unordered-list') {
          return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderAnswerInline(item, `${index}-${itemIndex}`)}</li>)}</ul>;
        }
        return <p key={index}>{renderAnswerInline(block.text, index)}</p>;
      })}
    </div>
  );
}

// 2026-09-18 前建立的對話預設標題是英文。
function displayConversationTitle(title) {
  return !title || title === 'New conversation' ? '新對話' : title;
}

function isDefaultConversationTitle(title) {
  return !title || title === '新對話' || title === 'New conversation';
}

// AI 回答通常要 10～20 秒，等待期間在對話尾端顯示明確的進度，避免看起來像當掉。
function PendingAnswer() {
  return (
    <div className="qa-pending-answer" role="status" style={{ marginTop: 12, padding: '12px 14px', background: 'rgba(255,255,255,0.025)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className="qa-pending-dots" aria-hidden="true"><span /><span /><span /></span>
      <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
        AI 正在搜尋課程片段並整理答案，通常需要 10～20 秒，請稍候…
      </span>
    </div>
  );
}

function QAPanel({ courseId, videoRef, videos = [], onJumpToVideo }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading]   = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState(null);
  const [awaitingAnswer, setAwaitingAnswer] = useState(false);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [error, setError]       = useState('');
  const [conversations, setConversations] = useState([]);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [expandedMessageIds, setExpandedMessageIds] = useState(new Set());
  const messageListRef = useRef(null);
  const latestMessageRef = useRef(null);
  // 預設只列前 SEGMENT_PREVIEW_COUNT 筆，避免 QA_MATCH_LIMIT 調大後洗掉整個面板；
  // AI 的答案可能引用超過這個數量的片段，所以要能展開讓學生點到每個時間戳。
  useEffect(() => {
    let active = true;
    setConversationLoading(true);
    apiFetch(`/conversations?courseId=${encodeURIComponent(courseId)}`)
      .then((response) => {
        if (active) setConversations(response.data?.conversations || []);
      })
      .catch(() => { if (active) setError('無法載入最近對話'); })
      .finally(() => { if (active) setConversationLoading(false); });
    return () => { active = false; };
  }, [courseId]);

  useEffect(() => {
    if (messages.length === 0) return;
    scrollConversationMessageIntoView(messageListRef.current, latestMessageRef.current);
  }, [messages]);

  // 送出新問題後把等待提示捲進畫面。
  useEffect(() => {
    if (!awaitingAnswer || !messageListRef.current) return;
    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [awaitingAnswer]);

  async function createNewConversation() {
    setError('');
    const response = await apiFetch('/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId }),
    });
    setConversationId(response.data.id);
    setMessages([]);
    setExpandedMessageIds(new Set());
    setConversations((items) => [response.data, ...items]);
    return response.data.id;
  }

  async function resumeConversation(id) {
    setLoading(true); setError('');
    try {
      const response = await apiFetch(`/conversations/${id}/messages`);
      setConversationId(id);
      setMessages((response.data?.messages || []).map(mapConversationMessage));
      setExpandedMessageIds(new Set());
    } catch (e) {
      setError(e.message || '無法恢復對話');
    } finally {
      setLoading(false);
    }
  }

  async function ask(event) {
    event?.preventDefault();
    if (loading || !question.trim()) return;
    const currentQuestion = question.trim();
    setLoading(true); setError('');
    setAwaitingAnswer(true);
    const temporaryId = `pending-${Date.now()}`;
    setMessages((items) => [...items, {
      id: temporaryId, role: 'user', content: currentQuestion, status: 'completed',
    }]);
    setQuestion('');
    try {
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        activeConversationId = await createNewConversation();
      }
      const res = await apiFetch(`/conversations/${activeConversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: currentQuestion }),
      });
      setMessages((items) => [
        ...items.filter((message) => message.id !== temporaryId),
        mapConversationMessage(res.data.userMessage),
        mapConversationMessage(res.data.assistantMessage),
      ]);
      setConversations((items) => items.map((item) => (
        item.id === activeConversationId
          ? { ...item, title: isDefaultConversationTitle(item.title) ? currentQuestion.slice(0, 120) : item.title, updatedAt: new Date().toISOString() }
          : item
      )).sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0)));
    } catch (e) {
      setError(e.message || '問答失敗');
    } finally {
      setLoading(false);
      setAwaitingAnswer(false);
    }
  }

  async function retryAnswer(message) {
    setLoading(true); setError('');
    setRetryingMessageId(message.id);
    try {
      const response = await apiFetch(
        `/conversations/${conversationId}/messages/${message.replyToMessageId}/retry`,
        { method: 'POST' },
      );
      setMessages((items) => items.map((item) => (
        item.id === message.id ? mapConversationMessage(response.data.assistantMessage) : item
      )));
    } catch (e) {
      setError(e.message || '重新產生失敗');
    } finally {
      setLoading(false);
      setRetryingMessageId(null);
    }
  }

  function handleCitationClick(matchedIndex, startSec) {
    if (matchedIndex >= 0 && onJumpToVideo) {
      onJumpToVideo(matchedIndex, startSec);
      return;
    }
    if (videoRef.current) {
      videoRef.current.currentTime = startSec;
      videoRef.current.play();
    }
  }

  return (
    <div className="qa-conversation-panel">
      <div className="qa-conversation-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#F14F21', letterSpacing: '.06em' }}>AI 問答</div>
        <button type="button" onClick={() => createNewConversation().catch((e) => setError(e.message || '無法建立新對話'))} disabled={loading} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(241,79,33,0.35)', background: 'transparent', color: '#F14F21', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
          ＋ 新對話
        </button>
      </div>
      {(conversationLoading || conversations.length > 0) && (
        <div className="qa-recent-conversations" style={{ marginBottom: 12, padding: '9px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.025)' }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', marginBottom: 6, letterSpacing: '.06em' }}>最近對話</div>
          {conversationLoading ? (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>載入中…</div>
          ) : conversations.slice(0, 5).map((conversation) => (
            <button key={conversation.id} type="button" onClick={() => resumeConversation(conversation.id)} disabled={loading} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 4px', border: 0, background: conversationId === conversation.id ? 'rgba(241,79,33,0.09)' : 'transparent', color: 'rgba(255,255,255,0.72)', cursor: 'pointer', textAlign: 'left', borderRadius: 6 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{displayConversationTitle(conversation.title)}</span>
              <span style={{ flexShrink: 0, color: 'rgba(255,255,255,0.32)', fontSize: 10 }}>{formatConversationDate(conversation.updatedAt || conversation.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={messageListRef} className="qa-message-list" aria-live="polite">
        {error && <div style={{ marginTop: 8, fontSize: 12, color: '#ff6b6b' }}>{error}</div>}
        {messages.map((message, messageIndex) => message.id && message.id === retryingMessageId ? (
          <div key={message.id} ref={messageIndex === messages.length - 1 ? latestMessageRef : undefined}>
            <PendingAnswer />
          </div>
        ) : message.role === 'user' ? (
        <div key={message.id || `user-${messageIndex}`} ref={messageIndex === messages.length - 1 ? latestMessageRef : undefined} style={{ marginTop: 12, marginLeft: '18%', padding: '9px 12px', borderRadius: 12, background: 'rgba(241,79,33,0.18)', color: '#fff', fontSize: 13 }}>
          {message.content}
        </div>
      ) : (() => { const result = message; return (
        <div key={message.id || `assistant-${messageIndex}`} ref={messageIndex === messages.length - 1 ? latestMessageRef : undefined} style={{ marginTop: 12, padding: '12px 14px', background: 'rgba(255,255,255,0.025)', borderRadius: 12 }}>
          <AnswerContent answer={result.answer} />
          {result.status === 'failed' && (
            <button type="button" onClick={() => retryAnswer(result)} disabled={loading} style={{ marginBottom: 10, padding: '7px 11px', borderRadius: 8, border: '1px solid rgba(255,107,107,0.45)', background: 'rgba(255,107,107,0.08)', color: '#ff8b8b', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
              重新產生
            </button>
          )}
          {(result.matches || result.segments || []).length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.42)', letterSpacing: '.06em', marginBottom: 6 }}>
              參考課程片段
              {(result.segments || result.matches || []).length > SEGMENT_PREVIEW_COUNT && (
                <span style={{ fontWeight: 400, letterSpacing: 0 }}>
                  {' '}（共 {(result.segments || result.matches || []).length} 筆）
                </span>
              )}
            </div>
          )}
          {getVisibleSources(
            result.segments || result.matches || [],
            expandedMessageIds.has(result.id || messageIndex),
          ).map((source, i) => {
            const seg = toStudentCitation(source);
            const start = seg.startSec;
            const end = seg.endSec;
            const text = seg.transcript;
            const matchedIndex = videos.findIndex((video) => (
              String(video._id || video.id || '') === String(seg.videoId || '')
              || String(video.videoId || video.externalVideoId || '') === String(seg.videoId || '')
            ));
            const matchedVideo = matchedIndex >= 0 ? videos[matchedIndex] : null;
            const videoTitle = formatVideoLabel(seg, matchedVideo);
            const canJump = (matchedIndex >= 0 && Boolean(onJumpToVideo)) || Boolean(videoRef.current);
            return (
              <div
                key={i}
                className="citation-card"
                role={canJump ? 'button' : undefined}
                tabIndex={canJump ? 0 : undefined}
                aria-label={canJump ? `跳至 ${videoTitle} ${formatTime(start)}` : undefined}
                style={{ display: 'flex', gap: 10, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, marginBottom: 6, cursor: canJump ? 'pointer' : 'default' }}
                onClick={() => handleCitationClick(matchedIndex, start)}
                onKeyDown={(event) => {
                  if (canJump && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    handleCitationClick(matchedIndex, start);
                  }
                }}
              >
                <span style={{ fontSize: 11, color: '#F14F21', fontWeight: 700, flexShrink: 0, fontFamily: 'monospace' }}>{formatTime(start)}-{formatTime(end)}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                  <span style={{ color: 'rgba(255,255,255,0.78)', fontWeight: 700 }}>{videoTitle}</span>
                  {' · '}
                  {text.slice(0, 160)}{text.length > 160 ? '…' : ''}
                </span>
              </div>
            );
          })}
          {(result.segments || result.matches || []).length > SEGMENT_PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setExpandedMessageIds((current) => {
                const next = new Set(current);
                const key = result.id || messageIndex;
                if (next.has(key)) next.delete(key); else next.add(key);
                return next;
              })}
              style={{
                marginTop: 2,
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 700,
                color: '#F14F21',
                background: 'transparent',
                border: '1px solid rgba(241,79,33,0.32)',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              {expandedMessageIds.has(result.id || messageIndex)
                ? '收合'
                : `查看其他 ${getRemainingSourceCount(result.segments || result.matches || [])} 個相關片段`}
            </button>
          )}
        </div>
        ); })())}
        {awaitingAnswer && <PendingAnswer />}
      </div>
      <div className="qa-input-area">
        {/* 用 form 送出：按 Enter 即送出，而且中文輸入法選字時按的 Enter 不會誤送 */}
        <form onSubmit={ask} style={{ display: 'flex', gap: 8 }}>
          <input
            className="ff-input"
            style={{ flex: 1, margin: 0, minWidth: 0 }}
            placeholder="輸入問題，按 Enter 送出…"
            aria-label="輸入課程問題"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              // 中文輸入法選字時的 Enter（isComposing / keyCode 229）只是確認文字，不送出。
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
              ask(e);
            }}
            enterKeyHint="send"
            readOnly={loading}
          />
          <button type="submit" className="btn-primary" style={{ padding: '10px 18px', flexShrink: 0 }} disabled={loading || !question.trim()}>
            {loading ? '回答中…' : '送出'}
          </button>
        </form>
      </div>
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
  const [seekRequest, setSeekRequest]   = useState(null);
  const [progressByCourse, setProgressByCourse] = useState({});
  const videoRef = useRef(null);
  const playerContainerRef = useRef(null);
  const watchedMarkedRef = useRef(new Set());

  // 手機或窄螢幕上影片清單與問答在播放器下方，點選後把播放器捲回畫面，
  // 否則看不到影片已經切換。播放器已完整在畫面內時不捲動。
  function revealPlayer() {
    requestAnimationFrame(() => {
      const element = playerContainerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const fullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!fullyVisible) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function markWatched(courseId, videoId) {
    if (!courseId || !videoId) return;
    const key = `${courseId}:${videoId}`;
    if (watchedMarkedRef.current.has(key)) return;
    watchedMarkedRef.current.add(key);
    try {
      await apiFetch(`/courses/${courseId}/videos/${videoId}/watched`, { method: 'POST' });
    } catch {
      watchedMarkedRef.current.delete(key);
    }
  }

  // Admin usage stats count every open; progress still waits for the 80% watched mark.
  function markOpened(courseId, video) {
    const videoId = video?._id || video?.id;
    if (!courseId || !videoId) return;
    apiFetch(`/courses/${courseId}/videos/${videoId}/opened`, { method: 'POST' }).catch(() => {});
  }

  function openVideo(index) {
    if (index !== playingVid) markOpened(selectedCourse?._id, videos[index]);
    setPlayingVid(index);
    revealPlayer();
  }

  useEffect(() => {
    apiFetch('/courses')
      .then(r => { setCourses(r.data?.courses || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
    // 課程列表顯示觀看進度；取不到時只是不顯示進度，不影響進入課程。
    apiFetch('/stats/student')
      .then((r) => {
        const entries = (r.data?.courseList || []).map((course) => [String(course.id), course]);
        setProgressByCourse(Object.fromEntries(entries));
      })
      .catch(() => {});
  }, []);

  async function openCourse(course) {
    setSelected(course);
    setPlayingVid(null);
    setSeekRequest(null);
    setVideos([]);
    setVLoading(true);
    try {
      const r = await apiFetch(`/courses/${course._id}/videos`);
      setVideos(r.data?.videos || []);
    } catch { /* ignore */ }
    finally { setVLoading(false); }
  }

  function jumpToVideo(index, startSec) {
    openVideo(index);
    setSeekRequest({ videoIndex: index, startSec: startSec || 0, nonce: Date.now() });
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
    const playback = resolveVideoPlayback(playing);
    const youtubeId = playback.youtubeId;
    const videoUrl = playback.videoUrl;

    return (
      <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <div onClick={() => { setSelected(null); setPlayingVid(null); setSeekRequest(null); }} style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
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
            <div ref={playerContainerRef} style={{ borderRadius: 16, overflow: 'hidden', background: '#000', aspectRatio: '16/9', position: 'relative', scrollMarginTop: 12 }}>
              {youtubeId ? (
                <YouTubePlayer
                  key={youtubeId}
                  videoId={youtubeId}
                  seekRequest={seekRequest?.videoIndex === playingVid ? seekRequest : null}
                  onWatched={() => markWatched(selectedCourse._id, playing?._id || playing?.id)}
                />
              ) : videoUrl ? (
                <video
                  ref={videoRef}
                  key={videoUrl}
                  src={videoUrl}
                  controls
                  onTimeUpdate={(e) => {
                    const el = e.currentTarget;
                    if (el.duration > 0 && el.currentTime / el.duration >= 0.8) {
                      markWatched(selectedCourse._id, playing?._id || playing?.id);
                    }
                  }}
                  onEnded={() => markWatched(selectedCourse._id, playing?._id || playing?.id)}
                  style={{ width: '100%', height: '100%', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'rgba(255,255,255,0.3)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  <div style={{ fontSize: 13 }}>從影片清單選擇影片開始播放</div>
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
            <QAPanel courseId={selectedCourse._id} videoRef={videoRef} videos={videos} onJumpToVideo={jumpToVideo} />
          </div>

          {/* Right: video list */}
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '.08em', marginBottom: 12 }}>影片清單</div>
            {vLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '20px 0' }}>載入中…</div>
            ) : videos.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '20px 0' }}>此課程尚無影片</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {videos.map((v, i) => (
                  <div key={v.id || v._id || i} className={`vid-row${playingVid === i ? ' playing' : ''}`} onClick={() => openVideo(i)}>
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
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 20 }}>已修課程</div>
      {loading ? (
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>載入中…</div>
      ) : courses.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 1.7, textAlign: 'center' }}>
                你目前尚未加入任何課程。<br />請聯絡老師或管理員取得修課資格。
              </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
          {courses.map((c, i) => {
            const col = COLORS[i % COLORS.length];
            return (
              <div key={c._id} className="course-row" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderBottom: i < courses.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ width: 46, height: 46, borderRadius: 13, background: `${col}18`, border: `1px solid ${col}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: col, flexShrink: 0 }}>
                  <Ic n="book" s={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => openCourse(c)}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 3 }}>{c.title}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>
                    {c.description || `${progressByCourse[String(c._id)]?.videoCount ?? c.videoCount ?? 0} 部影片`}
                  </div>
                  {progressByCourse[String(c._id)] && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, maxWidth: 320 }}>
                      <div className="prog-track" style={{ flex: 1 }}>
                        <div className="prog-fill" style={{ width: `${progressByCourse[String(c._id)].progress}%`, background: col }} />
                      </div>
                      <span style={{ fontSize: 11, color: col, fontWeight: 700, flexShrink: 0 }}>
                        已看 {progressByCourse[String(c._id)].progress}%
                      </span>
                    </div>
                  )}
                </div>
                <div className="course-row-actions" style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
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
