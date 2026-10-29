import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Ic } from '../components/Icons';
import BottomSheet from '../components/BottomSheet';
import brandMark from '../assets/mark-white.svg';
import { apiFetch } from '../api';
import { recoverLocalPlayback, resolveVideoPlayback } from './studentPlayback';
import {
  findExtendedResourcesQuestion,
  formatVideoMeta,
  isFeatureDisabledError,
  pickDisplayVideos,
} from '../utils/extendedResources';
import {
  SOURCE_PREVIEW_COUNT,
  formatConversationDate,
  formatConversationLabel,
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

function YouTubePlayer({ videoId, seekRequest, onWatched, onError }) {
  const wrapperRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const seekRequestRef = useRef(seekRequest);
  const onWatchedRef = useRef(onWatched);
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
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
          onError: (event) => onErrorRef.current?.(event.data),
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
// Portal keeps viewport coordinates independent of transformed/filtered ancestors.
async function buildCourseBindUrl(courseId) {
  if (!LINE_BOT_URL) return '';
  if (!courseId) return LINE_BOT_URL || '';

  try {
    const res = await apiFetch('/line/bind-token', { method: 'POST' });
    const token = res.data?.token || res.data?.bindToken || '';
    return token ? lineMessageUrl(`BIND:${token}:COURSE:${courseId}`) : lineMessageUrl(`COURSE:${courseId}`);
  } catch {
    return lineMessageUrl(`COURSE:${courseId}`);
  }
}

function AskTAContent({ url, loading, courseName }) {
  return (
    <>
      {url && !loading && <div style={{ padding: 10, background: '#fff', borderRadius: 12 }}>
        <QRCodeSVG value={url} size={148} bgColor="#ffffff" fgColor="#000000" />
      </div>}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 1.6 }}>
        {loading ? '產生 QR code 中…' : url ? '用手機 LINE 掃描後送出訊息' : '尚未設定 LINE 助教連結，暫時無法掃碼。'}<br />
        <span style={{ color: '#F14F21' }}>{courseName}</span>
      </div>
      {/* 手機上無法用同一支手機掃 QR code，直接開啟 LINE 並帶入訊息 */}
      {url && !loading && (
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
    </>
  );
}

// 手機版「⋯」選單裡的詢問助教：展開時才產生綁定碼連結。
function AskTAPanel({ courseId, courseName }) {
  const [state, setState] = useState({ loading: true, url: '' });
  useEffect(() => {
    let active = true;
    buildCourseBindUrl(courseId).then((url) => { if (active) setState({ loading: false, url }); });
    return () => { active = false; };
  }, [courseId]);
  return (
    <div className="study-more-ta">
      <AskTAContent url={state.url} loading={state.loading} courseName={courseName} />
    </div>
  );
}

function AskTAButton({ courseId, courseName, variant = 'list' }) {
  const [pos, setPos] = useState(null); // null = closed, {top,right} = open
  const [url, setUrl] = useState(LINE_BOT_URL || '');
  const [loadingUrl, setLoadingUrl] = useState(false);
  const btnRef = useRef(null);
  const cardRef = useRef(null);

  useLayoutEffect(() => {
    if (!pos) return;
    const updatePosition = () => {
      const button = btnRef.current;
      const card = cardRef.current;
      if (!button || !card) return;
      const rect = button.getBoundingClientRect();
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      const below = rect.bottom + 8;
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 8);
      card.style.top = `${Math.min(top, Math.max(8, window.innerHeight - height - 8))}px`;
      card.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(cardRef.current);
    observer.observe(btnRef.current);
    const main = btnRef.current.closest('.dashboard-main');
    if (main) observer.observe(main);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); };
  }, [pos]);

  useEffect(() => {
    if (!pos) return;
    const handler = (e) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        cardRef.current && !cardRef.current.contains(e.target)
      ) setPos(null);
    };
    document.addEventListener('mousedown', handler);
    const escape = (event) => { if (event.key === 'Escape') { setPos(null); btnRef.current?.focus(); } };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', escape); };
  }, [pos]);

  const isDetail = variant === 'detail';

  async function handleClick(e) {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    setPos({ top: 0, left: 0 });
    setLoadingUrl(true);
    try {
      setUrl(await buildCourseBindUrl(courseId));
    } finally {
      setLoadingUrl(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={Boolean(pos)}
        onClick={handleClick}
        className={isDetail ? 'btn-primary' : 'btn-ask-ta'}
        style={isDetail ? { background: '#06C755', padding: '10px 20px', fontSize: 13, flexShrink: 0 } : { flexShrink: 0 }}
      >
        <Ic n="chat" s={isDetail ? 14 : 13} /> 詢問助教
      </button>

      {pos && createPortal(
        <div
          ref={cardRef}
          className="line-qr-popover"
          role="region"
          aria-label="LINE 助教 QR Code"
          style={{ position: 'fixed', zIndex: 1000, top: pos.top, left: pos.left, width: 224, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto', background: 'rgba(22,8,18,0.97)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          <AskTAContent url={url} loading={loadingUrl} courseName={courseName} />
        </div>, document.body
      )}
    </>
  );
}

// 與 index.css 的手機斷點一致：≤768px 學習頁改用上下排列與底部抽屜。
const COMPACT_QUERY = '(max-width: 768px)';

function useCompactLayout() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const handleChange = (event) => setCompact(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);
  return compact;
}

const COLORS = ['#a5b4fc', '#4ade80', '#F14F21', '#fb923c', '#38bdf8', '#f472b6'];

// 命中片段預設顯示筆數。backend 回傳筆數由 QA_MATCH_LIMIT 決定（2026-07-25 起為 15），
// 全列會洗掉整個問答面板，因此預設只列前幾筆、可展開。
// 展開能力是必要的：答案結尾的「依據」可能引用超過這個數量的片段，
// 學生要能點到每一個被引用的時間戳。
const SEGMENT_PREVIEW_COUNT = SOURCE_PREVIEW_COUNT;

// 需與後端 QA_MAX_QUESTION_LENGTH / QA_DAILY_ASK_LIMIT_PER_STUDENT 一致（預設 50 字、每天 5 次）。
// 後端才是真正的限制，這裡只是事先提示。
const MAX_QUESTION_LENGTH = 50;
const DAILY_ASK_LIMIT = 5;

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
function isDefaultConversationTitle(title) {
  return !title || title === '新對話' || title === 'New conversation';
}

// AI 回答通常要 10～20 秒，等待期間在對話尾端顯示明確的進度，避免看起來像當掉。
// AI 回答、等待中與錯誤訊息共用：左側系統 logo 頭像，文字直接排在問答區背景上。
function AiAvatar() {
  return (
    <span className="qa-ai-avatar" aria-hidden="true">
      <img src={brandMark} alt="" />
    </span>
  );
}

function PendingAnswer() {
  return (
    <div className="qa-ai-message qa-pending-answer" role="status">
      <AiAvatar />
      <div className="qa-ai-body qa-pending-body">
        <span className="sr-only">AI 回答：</span>
        <span className="qa-pending-dots" aria-hidden="true"><span /><span /><span /></span>
        <span>AI 正在搜尋課程片段並整理答案，通常需要 10～20 秒，請稍候…</span>
      </div>
    </div>
  );
}

// 後端功能開關關閉時回 404 NOT_FOUND；確認一次後，這次頁面載入內不再重複呼叫。
let extendedResourcesDisabled = false;

// 教育開放資料（國家教育研究院愛學網）的延伸學習影片，放在課程答案之外，
// 與課程片段分區顯示。失敗、無結果或功能未啟用時整塊不顯示。
function ExtendedLearning({ courseId, question }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!question || extendedResourcesDisabled) return undefined;
    let active = true;
    apiFetch('/qa/extended-resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, question }),
    })
      .then((response) => { if (active) setData(response.data); })
      .catch((error) => {
        if (isFeatureDisabledError(error)) extendedResourcesDisabled = true;
      });
    return () => { active = false; };
  }, [courseId, question]);

  const videos = pickDisplayVideos(data);
  if (!videos.length) return null;

  return (
    <div className="extended-learning" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.42)', letterSpacing: '.06em', marginBottom: 6 }}>
        延伸學習
      </div>
      {videos.map((video) => (
        <a
          key={video.videoUrl}
          href={video.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'block', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, marginBottom: 6, textDecoration: 'none' }}
        >
          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.78)', lineHeight: 1.5 }}>{video.title}</span>
          {formatVideoMeta(video) && (
            <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{formatVideoMeta(video)}</span>
          )}
        </a>
      ))}
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
        資料來源：{data.attribution?.source || '國家教育研究院愛學網'}（{data.attribution?.license || '政府資料開放授權條款－第1版'}）。
        延伸影片不屬於本課程教材，內容以教師課程為準。
      </div>
    </div>
  );
}

// 只捲動選單本身，不用 scrollIntoView（它也會捲動 overflow:hidden 的外層容器）。
function scrollMenuItemIntoView(menu, item) {
  if (!menu || !item) return;
  if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop;
  else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight;
}

function QAPanel({ courseId, videos = [], onJumpToVideo, activeSourceKey, compact = false }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading]   = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState(null);
  const [awaitingAnswer, setAwaitingAnswer] = useState(false);
  const questionLength = [...question.trim()].length;
  const questionTooLong = questionLength > MAX_QUESTION_LENGTH;
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [error, setError]       = useState('');
  const [conversations, setConversations] = useState([]);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedMessageIds, setExpandedMessageIds] = useState(new Set());
  const messageListRef = useRef(null);
  const latestMessageRef = useRef(null);
  const historyButtonRef = useRef(null);
  const historyMenuRef = useRef(null);
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

  useEffect(() => {
    if (compact || !historyOpen) return undefined;
    const menu = historyMenuRef.current;
    // 問答區是 overflow:hidden：選單左側或底部超出時會被裁切，開啟時往右挪並限制高度，維持在問答區內。
    const panel = menu?.closest('.qa-conversation-panel')?.getBoundingClientRect();
    if (menu && panel) {
      const rect = menu.getBoundingClientRect();
      const overflowLeft = panel.left + 8 - rect.left;
      if (overflowLeft > 0) menu.style.right = `${-overflowLeft}px`;
      menu.style.maxHeight = `${Math.max(120, Math.min(320, panel.bottom - rect.top - 8))}px`;
    }
    // preventScroll：預設的 focus 捲動會連 overflow:hidden 的外層一起捲，把整個學習頁往上推。
    const initial = menu?.querySelector('[aria-checked="true"]') || menu?.querySelector('[role="menuitemradio"]');
    initial?.focus({ preventScroll: true });
    scrollMenuItemIntoView(menu, initial);
    const closeOnOutside = (event) => {
      if (menu?.contains(event.target) || historyButtonRef.current?.contains(event.target)) return;
      setHistoryOpen(false);
      // 點到可聚焦的元素（例如輸入框）就讓它取得焦點，否則回到「最近對話」按鈕。
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) historyButtonRef.current?.focus();
      }, 0);
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [compact, historyOpen]);

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
      setHistoryOpen(false);
    } catch (e) {
      setError(e.message || '無法恢復對話');
    } finally {
      setLoading(false);
    }
  }

  async function ask(event) {
    event?.preventDefault();
    if (loading || !question.trim()) return;
    if (questionTooLong) {
      setError(`問題太長了，請精簡到 ${MAX_QUESTION_LENGTH} 個字以內。`);
      return;
    }
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
      // 被拒絕（字數、次數用完等）時問題沒有送出：移除暫時顯示的提問，並把文字放回輸入框。
      setMessages((items) => items.filter((message) => message.id !== temporaryId));
      setQuestion(currentQuestion);
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

  function handleCitationClick(matchedIndex, startSec, sourceKey) {
    if (matchedIndex >= 0 && onJumpToVideo) {
      onJumpToVideo(matchedIndex, startSec, sourceKey);
    }
  }

  const startNewConversation = () => createNewConversation().catch((e) => setError(e.message || '無法建立新對話'));
  const currentTitle = formatConversationLabel(conversations.find((item) => item.id === conversationId));
  const recentConversations = conversations.slice(0, 20);

  function closeHistory() {
    setHistoryOpen(false);
    historyButtonRef.current?.focus();
  }

  function selectConversation(id) {
    closeHistory();
    if (id !== conversationId) resumeConversation(id);
  }

  // 電腦版浮動選單：方向鍵／Home／End 移動，Enter 選取（原生 button），Esc 關閉並回到觸發按鈕。
  function handleHistoryMenuKeyDown(event) {
    const items = [...(historyMenuRef.current?.querySelectorAll('[role="menuitemradio"]:not(:disabled)') || [])];
    const index = items.indexOf(document.activeElement);
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
    if (move !== undefined && items.length) {
      event.preventDefault();
      const next = items[(move + items.length) % items.length];
      next.focus({ preventScroll: true });
      scrollMenuItemIntoView(historyMenuRef.current, next);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeHistory();
    } else if (event.key === 'Tab') {
      setHistoryOpen(false);
    }
  }

  return (
    <div className={`qa-conversation-panel${compact ? ' qa-compact' : ''}`}>
      {compact ? (
        <div className="qa-compact-bar">
          <button ref={historyButtonRef} type="button" className="qa-compact-title" aria-haspopup="dialog" aria-expanded={historyOpen} aria-label={`最近對話，目前：${currentTitle}`} onClick={() => setHistoryOpen(true)}>
            <span className="qa-compact-title-text">{currentTitle}</span>
            <span aria-hidden="true">▾</span>
          </button>
          <button type="button" className="study-icon-btn qa-compact-new" aria-label="新對話" title="新對話" onClick={startNewConversation} disabled={loading}>＋</button>
        </div>
      ) : (
      <div className="qa-conversation-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#F14F21', letterSpacing: '.06em' }}>AI 問答</div>
        {/* 選單是按鈕的定位錨點內的子元素，對齊按鈕右下，浮在對話內容上方 */}
        <span className="qa-history-anchor">
          <button ref={historyButtonRef} type="button" className="study-control qa-history-toggle" aria-haspopup="menu" aria-expanded={historyOpen} aria-controls="qa-history" onClick={() => setHistoryOpen(!historyOpen)}>
            最近對話 {historyOpen ? '▴' : '▾'}
          </button>
          {historyOpen && (
            <div id="qa-history" ref={historyMenuRef} className="qa-history-menu" role="menu" aria-label="最近對話" onKeyDown={handleHistoryMenuKeyDown}>
              {conversationLoading ? (
                <div className="sheet-empty">載入中…</div>
              ) : conversations.length === 0 ? (
                <div className="sheet-empty">尚無對話，輸入問題開始。</div>
              ) : recentConversations.map((conversation) => (
                <button key={conversation.id} type="button" role="menuitemradio" tabIndex={-1} aria-checked={conversationId === conversation.id} className={`qa-history-item${conversationId === conversation.id ? ' active' : ''}`} onClick={() => selectConversation(conversation.id)} disabled={loading}>
                  <span className="qa-history-item-title">{formatConversationLabel(conversation)}</span>
                  <span className="qa-history-item-meta">{conversationId === conversation.id ? '目前對話' : formatConversationDate(conversation.updatedAt || conversation.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </span>
        <button type="button" onClick={startNewConversation} disabled={loading} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(241,79,33,0.35)', background: 'transparent', color: '#F14F21', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
          ＋ 新對話
        </button>
      </div>
      )}
      {compact && historyOpen && (
        <BottomSheet title="最近對話" onClose={() => setHistoryOpen(false)} returnFocusRef={historyButtonRef}>
          <div className="sheet-list">
            {conversationLoading ? (
              <div className="sheet-empty">載入中…</div>
            ) : conversations.length === 0 ? (
              <div className="sheet-empty">尚無對話，輸入問題開始。</div>
            ) : recentConversations.map((conversation) => (
              <button key={conversation.id} type="button" className={`sheet-row${conversationId === conversation.id ? ' active' : ''}`} aria-current={conversationId === conversation.id ? 'true' : undefined} onClick={() => selectConversation(conversation.id)} disabled={loading}>
                <span className="sheet-row-title">{formatConversationLabel(conversation)}</span>
                <span className="sheet-row-meta">{conversationId === conversation.id ? '目前對話' : formatConversationDate(conversation.updatedAt || conversation.createdAt)}</span>
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
      <div ref={messageListRef} className="qa-message-list" aria-live="polite">
        {messages.length === 0 && !awaitingAnswer && (
          <div className="qa-empty-state">邊看影片，邊釐清問題。<br /><span>回答中的來源可直接跳轉影片，對話會留在原處。</span></div>
        )}
        {error && (
          <div className="qa-ai-message qa-ai-error" role="alert">
            <AiAvatar />
            <div className="qa-ai-body"><span className="sr-only">系統訊息：</span>{error}</div>
          </div>
        )}
        {messages.map((message, messageIndex) => message.id && message.id === retryingMessageId ? (
          <div key={message.id} ref={messageIndex === messages.length - 1 ? latestMessageRef : undefined}>
            <PendingAnswer />
          </div>
        ) : message.role === 'user' ? (
        <div key={message.id || `user-${messageIndex}`} ref={messageIndex === messages.length - 1 ? latestMessageRef : undefined} style={{ marginTop: 12, marginLeft: '18%', padding: '9px 12px', borderRadius: 12, background: 'rgba(241,79,33,0.18)', color: '#fff', fontSize: 13 }}>
          {message.content}
        </div>
      ) : (() => { const result = message; return (
        <div key={message.id || `assistant-${messageIndex}`} ref={messageIndex === messages.length - 1 ? latestMessageRef : undefined} className="qa-ai-message">
          <AiAvatar />
          <div className="qa-ai-body">
          <span className="sr-only">AI 回答：</span>
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
            // 影像片段沒有逐字稿，改顯示來源說明，避免卡片只剩標題
            const text = seg.transcript || (seg.modality === 'video' ? '影像片段（依畫面比對，無逐字稿）' : '');
            const matchedIndex = videos.findIndex((video) => (
              String(video._id || video.id || '') === String(seg.videoId || '')
              || String(video.videoId || video.externalVideoId || '') === String(seg.videoId || '')
            ));
            const matchedVideo = matchedIndex >= 0 ? videos[matchedIndex] : null;
            const videoTitle = formatVideoLabel(seg, matchedVideo);
            const canJump = matchedIndex >= 0 && Boolean(onJumpToVideo)
              && ['youtube', 'upload'].includes(resolveVideoPlayback(matchedVideo).type);
            const sourceKey = `${result.id || messageIndex}:${i}`;
            const isActive = activeSourceKey === sourceKey;
            return (
              <div
                key={i}
                className={`citation-card${isActive ? ' citation-active' : ''}`}
                role={canJump ? 'button' : undefined}
                tabIndex={canJump ? 0 : undefined}
                aria-label={canJump ? `跳至 ${videoTitle} ${formatTime(start)}` : undefined}
                aria-current={isActive ? 'true' : undefined}
                style={{ display: 'flex', gap: 10, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, marginBottom: 6, cursor: canJump ? 'pointer' : 'default' }}
                onClick={() => { if (canJump) handleCitationClick(matchedIndex, start, sourceKey); }}
                onKeyDown={(event) => {
                  if (canJump && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    handleCitationClick(matchedIndex, start, sourceKey);
                  }
                }}
              >
                <span style={{ fontSize: 11, color: '#F14F21', fontWeight: 700, flexShrink: 0, fontFamily: 'monospace' }}>{formatTime(start)}-{formatTime(end)}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                  <span style={{ color: 'rgba(255,255,255,0.78)', fontWeight: 700 }}>{videoTitle}</span>
                  {isActive && <span className="citation-active-label">目前選取</span>}
                  {!canJump && <span className="citation-unavailable">（未提供可播放影片）</span>}
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
          <ExtendedLearning
            courseId={courseId}
            question={findExtendedResourcesQuestion(messages, messageIndex)}
          />
          </div>
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
          <button type="submit" className="btn-primary" style={{ padding: '10px 18px', flexShrink: 0 }} disabled={loading || !question.trim() || questionTooLong}>
            {loading ? '回答中…' : '送出'}
          </button>
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, fontSize: 11, color: questionTooLong ? '#ff6b6b' : 'rgba(255,255,255,0.4)' }}>
          <span>{questionTooLong ? `超過 ${MAX_QUESTION_LENGTH} 字，請精簡問題` : `每天可提問 ${DAILY_ASK_LIMIT} 次（網頁與 LINE 合併計算）`}</span>
          <span aria-live="polite">{questionLength} / {MAX_QUESTION_LENGTH}</span>
        </div>
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
  const [playbackError, setPlaybackError] = useState('');
  const courseRequestRef = useRef(0);
  const playbackSelectionRef = useRef(null);
  const [seekRequest, setSeekRequest]   = useState(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [videoWidth, setVideoWidth] = useState(38);
  // 手機版（≤768px）：影片清單與「⋯」選單改用底部抽屜，桌面版維持並排與下拉清單。
  const compact = useCompactLayout();
  const [videoSheetOpen, setVideoSheetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [askTAOpen, setAskTAOpen] = useState(false);
  // 影片清單抽屜可由「切換」或影片名稱開啟，關閉後回到實際觸發的按鈕。
  const playlistTriggerRef = useRef(null);
  const moreButtonRef = useRef(null);
  const studyGridRef = useRef(null);
  const [progressByCourse, setProgressByCourse] = useState({});
  const videoRef = useRef(null);
  const watchedMarkedRef = useRef(new Set());

  function resizeStudy(event) {
    const grid = studyGridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    setVideoWidth(Math.max(25, Math.min(60, ((event.clientX - rect.left) / rect.width) * 100)));
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
    playbackSelectionRef.current = { index, videoId: videos[index]?._id || videos[index]?.id };
    setPlaybackError('');
    setPlayingVid(index);
    setSeekRequest(null);
    setPlaylistOpen(false);
    setVideoSheetOpen(false);
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
    const request = ++courseRequestRef.current;
    playbackSelectionRef.current = null;
    setPlaybackError('');
    setSelected(course);
    setPlayingVid(null);
    setSeekRequest(null);
    setPlaylistOpen(true);
    setPlayerExpanded(false);
    setVideos([]);
    setVLoading(true);
    try {
      const r = await apiFetch(`/courses/${course._id}/videos`);
      if (courseRequestRef.current !== request) return;
      setVideos((current) => courseRequestRef.current === request ? (r.data?.videos || []) : current);
    } catch { /* ignore */ }
    finally {
      if (courseRequestRef.current === request) {
        setVLoading((current) => courseRequestRef.current === request ? false : current);
      }
    }
  }

  async function handleLocalPlaybackError(video, index, position) {
    const id = video?._id || video?.id;
    const selection = playbackSelectionRef.current;
    const isCurrent = () => selection !== null && playbackSelectionRef.current === selection
      && selection.index === index && selection.videoId === id;
    const result = await recoverLocalPlayback({
      videoId: id,
      isCurrent,
      probe: (videoId) => fetch(`/api/v1/videos/${encodeURIComponent(videoId)}/source`, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' }),
      loadVideo: (videoId) => apiFetch(`/videos/${encodeURIComponent(videoId)}`),
    });
    if (!result || !isCurrent()) return;
    if (result.refreshed) {
      setVideos((current) => isCurrent() ? current.map((item, i) => i === index ? result.refreshed : item) : current);
      setSeekRequest((current) => isCurrent() ? { videoIndex: index, startSec: position, nonce: Date.now() } : current);
      return;
    }
    setPlaybackError((current) => isCurrent() ? result.error : current);
  }

  function jumpToVideo(index, startSec, sourceKey) {
    openVideo(index);
    setSeekRequest({ videoIndex: index, startSec: Math.max(0, Number(startSec) || 0), sourceKey, nonce: Date.now() });
  }

  // Apply seeks to the new video only after its metadata is ready. Same-video
  // seeks run here immediately; cross-video seeks also run in onLoadedMetadata.
  useEffect(() => {
    const element = videoRef.current;
    if (element?.readyState >= 1 && seekRequest?.videoIndex === playingVid) {
      element.currentTime = seekRequest.startSec;
      element.play().catch(() => {});
    }
  }, [playingVid, seekRequest]);

  // Course detail view
  if (selectedCourse) {
    const playing = playingVid !== null ? videos[playingVid] : null;
    const playback = resolveVideoPlayback(playing);
    const youtubeId = playback.youtubeId;
    const videoUrl = playback.videoUrl;

    const playingLabel = playing ? formatVideoLabel({}, playing) : '尚未選擇影片';
    const playlistTriggerProps = compact
      ? { 'aria-haspopup': 'dialog', 'aria-expanded': videoSheetOpen, onClick: (event) => { playlistTriggerRef.current = event.currentTarget; setVideoSheetOpen(true); } }
      : { 'aria-expanded': playlistOpen, 'aria-controls': 'course-playlist', onClick: () => setPlaylistOpen(!playlistOpen) };
    const playlistItems = vLoading ? (
      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '20px 0' }}>載入中…</div>
    ) : videos.length === 0 ? (
      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '20px 0' }}>此課程尚無影片</div>
    ) : (
      <div className="course-playlist-list">
        {videos.map((v, i) => (
          <button type="button" key={v.id || v._id || i} className={`vid-row${playingVid === i ? ' playing' : ''}`} aria-pressed={playingVid === i} onClick={() => openVideo(i)}>
            <div className="vid-row-icon" style={{ background: playingVid === i ? 'rgba(241,79,33,0.25)' : 'rgba(255,255,255,0.06)', border: `1px solid ${playingVid === i ? 'rgba(241,79,33,0.5)' : 'rgba(255,255,255,0.1)'}`, color: playingVid === i ? '#F14F21' : 'rgba(255,255,255,0.4)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div className="vid-row-title" style={{ color: playingVid === i ? '#fff' : 'rgba(255,255,255,0.78)' }}>{v.title || v.file_name || '未命名'}</div>
              <div className="vid-row-meta">
                <span className={`badge ${v.processing?.status === 'completed' ? 'bg' : v.processing?.status === 'processing' ? 'by' : 'bb'}`} style={{ fontSize: 10 }}>
                  {v.processing?.status === 'completed' ? '可提問' : v.processing?.status === 'processing' ? '處理中' : v.processing?.status || '—'}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    );

    return (
      <div className={`course-study${compact ? ' course-study-compact' : ''}`}>
        <div className="course-study-header">
          <button type="button" className="study-back-btn" aria-label="返回課程列表" onClick={() => { ++courseRequestRef.current; playbackSelectionRef.current = null; setPlaybackError(''); setSelected(null); setPlayingVid(null); setSeekRequest(null); }} style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="course-study-title">
            {/* 電腦版「詢問助教」緊接在課程名稱右側，不再推到最右邊壓在問答區上方 */}
            <div className="course-study-title-row">
              <div className="course-study-name" style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#fff' }}>{selectedCourse.title}</div>
              {!compact && <AskTAButton courseId={selectedCourse._id} courseName={selectedCourse.title} variant="list" />}
            </div>
            {!compact && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>{videos.length} 部影片</div>}
          </div>
          {compact && (
            <button ref={moreButtonRef} type="button" className="study-icon-btn" aria-label="更多選項" title="更多選項" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>⋯</button>
          )}
        </div>

        <div ref={studyGridRef} className="course-detail-grid" style={{ '--study-video-width': `${videoWidth}fr`, '--study-chat-width': `${100 - videoWidth}fr` }}>
          <section className={`course-media${playerExpanded ? ' player-expanded' : ''}`} aria-label="課程播放器">
            <div className="course-player">
              {playbackError ? (
                <div role="status" style={{ padding: 24, color: 'rgba(255,255,255,0.75)' }}>{playbackError}</div>
              ) : youtubeId ? (
                <YouTubePlayer
                  key={youtubeId}
                  videoId={youtubeId}
                  onError={(code) => setPlaybackError(code === 100 ? 'YouTube 找不到這支影片，請聯絡教師。' : [101, 150].includes(code) ? 'YouTube 不允許在此播放，請聯絡教師。' : '影片準備中，可先提問。')}
                  seekRequest={seekRequest?.videoIndex === playingVid ? seekRequest : null}
                  onWatched={() => markWatched(selectedCourse._id, playing?._id || playing?.id)}
                />
              ) : videoUrl ? (
                <video
                  ref={videoRef}
                  key={videoUrl}
                  src={videoUrl}
                  controls
                  playsInline
                  onError={(e) => handleLocalPlaybackError(playing, playingVid, e.currentTarget.currentTime || 0)}
                  onLoadedMetadata={(e) => {
                    if (seekRequest?.videoIndex === playingVid) {
                      e.currentTarget.currentTime = seekRequest.startSec;
                      e.currentTarget.play().catch(() => {});
                    }
                  }}
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
                  <div style={{ fontSize: 13 }}>{playing ? '影片準備中，可先提問。' : '從影片清單選擇影片開始播放'}</div>
                </div>
              )}
            </div>
            <div className="course-player-toolbar">
              {/* 影片名稱本身也能開影片清單，行為同「切換／影片清單」按鈕 */}
              <button type="button" className="course-playing-title" aria-label={`影片清單，目前：${playingLabel}`} {...playlistTriggerProps}>
                <span className="course-playing-text">
                  <strong>{playingLabel}</strong>
                  {seekRequest?.sourceKey && <span>來源起點 {formatTime(seekRequest.startSec)}</span>}
                </span>
                <span className="course-playing-chevron" aria-hidden="true">{(compact ? videoSheetOpen : playlistOpen) ? '▴' : '▾'}</span>
              </button>
              <span className="sr-only" role="status">{playing ? `目前影片：${playingLabel}` : ''}</span>
              <button type="button" className="study-control course-player-expand" aria-expanded={playerExpanded} onClick={() => setPlayerExpanded(!playerExpanded)}>{playerExpanded ? '縮小影片' : '放大影片'}</button>
              {compact ? (
                <button type="button" className="study-control study-switch" aria-label="切換影片" {...playlistTriggerProps}>切換</button>
              ) : (
                <button type="button" className="study-control" {...playlistTriggerProps}>影片清單 {playlistOpen ? '▴' : '▾'}</button>
              )}
            </div>
            {!compact && (
            <div id="course-playlist" className="course-playlist scrl" hidden={!playlistOpen}>
            {playlistItems}
            </div>
            )}
          </section>
          <div
            className="study-resizer"
            role="separator"
            tabIndex={0}
            aria-label="調整影片與對話寬度"
            aria-orientation="vertical"
            aria-valuemin={25}
            aria-valuemax={60}
            aria-valuenow={Math.round(videoWidth)}
            aria-valuetext={`影片 ${Math.round(videoWidth)}%，對話 ${Math.round(100 - videoWidth)}%`}
            title="拖曳調整寬度；方向鍵微調；按兩下還原"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              resizeStudy(event);
            }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeStudy(event); }}
            onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onDoubleClick={() => setVideoWidth(38)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              setVideoWidth((value) => event.key === 'Home' ? 25 : event.key === 'End' ? 60 : Math.max(25, Math.min(60, value + (event.key === 'ArrowLeft' ? -2 : 2))));
            }}
          />
          <QAPanel key={selectedCourse._id} courseId={selectedCourse._id} videos={videos} onJumpToVideo={jumpToVideo} activeSourceKey={seekRequest?.sourceKey} compact={compact} />
        </div>

        {compact && videoSheetOpen && (
          <BottomSheet title="影片清單" onClose={() => setVideoSheetOpen(false)} returnFocusRef={playlistTriggerRef}>
            <div className="course-playlist-sheet">{playlistItems}</div>
          </BottomSheet>
        )}
        {compact && moreOpen && (
          <BottomSheet title="更多" onClose={() => { setMoreOpen(false); setAskTAOpen(false); }} returnFocusRef={moreButtonRef}>
            <div className="sheet-list">
              <button type="button" className="sheet-row" aria-expanded={askTAOpen} onClick={() => setAskTAOpen((open) => !open)}>
                <span className="sheet-row-title"><Ic n="chat" s={16} /> 詢問助教（LINE）</span>
                <span className="sheet-row-meta" aria-hidden="true">{askTAOpen ? '▴' : '▾'}</span>
              </button>
              {askTAOpen && <AskTAPanel courseId={selectedCourse._id} courseName={selectedCourse.title} />}
            </div>
          </BottomSheet>
        )}
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
