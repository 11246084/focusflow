// recut 教師流程的純邏輯：狀態對應的步驟與待辦、講稿逐句排列、時長檢查、錯誤文案。
// 這裡不呼叫 API，方便用 node:test 驗證。狀態名稱以 backend/src/constants/recut.js 為準。

export const MIN_DURATION_SEC = 30;
export const MAX_DURATION_SEC = 65;
export const MAX_BATCH = 5;
export const POLL_INTERVAL_MS = 4000;
export const MANAGE_REFRESH_MS = 20000;

import { deriveDisplayStatus } from './shortScriptStatus.js';

export const STEPS = ['確認講稿', '製作短片', '確認成品'];
export const AVATAR_STEPS = ['產生腳本', '做影片並傳回', '確認成品'];

// bucket：mine＝等你處理、waiting＝處理中、done＝已上架。
const STATE_INFO = {
  idle: { step: 0, bucket: 'mine', label: '尚未產生講稿', action: '產生講稿' },
  queued: { step: 0, bucket: 'waiting', label: '排隊中' },
  generating: { step: 0, bucket: 'waiting', label: '正在整理講稿' },
  updating: { step: 0, bucket: 'waiting', label: '正在套用修改' },
  script_review: { step: 0, bucket: 'mine', label: '確認講稿', action: '確認講稿' },
  script_approved: { step: 1, bucket: 'mine', label: '講稿已核准', action: '製作短片' },
  render_queued: { step: 1, bucket: 'waiting', label: '等待製作' },
  rendering: { step: 1, bucket: 'waiting', label: '製作中' },
  render_failed: { step: 1, bucket: 'mine', label: '製作失敗', action: '查看原因' },
  asset_review: { step: 2, bucket: 'mine', label: '確認成品', action: '確認成品' },
  asset_approved: { step: 2, bucket: 'waiting', label: '已核准，等待上架' },
  published: { step: 3, bucket: 'done', label: '已上架' },
};

// 這門課還能再開始幾支：上限扣掉已在排隊或產生講稿中的。
export function batchRoom(scripts = []) {
  const busy = scripts.filter((s) => ['queued', 'generating'].includes(s?.recut?.state)).length;
  return Math.max(0, MAX_BATCH - busy);
}

export function stateInfo(state) {
  return STATE_INFO[state] || STATE_INFO.idle;
}

export function isBusyState(state) {
  return stateInfo(state).bucket === 'waiting';
}

// 背景工作（產生講稿、套用修改）可以取消；製作影片沒有教師取消端點。
export function isCancellableState(state) {
  return ['queued', 'generating', 'updating'].includes(state);
}

// idle 但最近一次工作失敗時，顯示失敗而不是「尚未產生」。
export function describeScript(script, task = null) {
  const state = script?.recut?.state || 'idle';
  const info = stateInfo(state);
  if (state === 'idle' && ['failed', 'cancelled'].includes(task?.status)) {
    return { ...info, state, label: task.status === 'cancelled' ? '已取消' : '產生失敗', action: '重新產生' };
  }
  return { ...info, state };
}

export function isRecutScript(script) {
  return script?.productionMode === 'recut';
}

// 管理清單排序：等你處理在前，其次處理中，最後已上架；同組依最後更新時間新到舊。
const BUCKET_ORDER = { mine: 0, waiting: 1, done: 2, closed: 3 };
export function sortManageItems(items) {
  return [...items].sort((a, b) => (BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket])
    || (Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)));
}

// 數位分身：系統只產生腳本，教授在地端做好影片後傳回，再確認成品上架（UX-24）。
// 狀態沿用舊頁面的 deriveDisplayStatus，這裡只換成工作區的步驟與待辦分組。
const AVATAR_INFO = {
  to_generate: { step: 0, bucket: 'mine', label: '尚未產生腳本', action: '產生腳本' },
  changes_requested: { step: 0, bucket: 'mine', label: '需修改', action: '重新產生' },
  to_film: { step: 1, bucket: 'mine', label: '待傳回影片', action: '傳回影片' },
  asset_rejected: { step: 1, bucket: 'mine', label: '成品已退回', action: '重新上傳' },
  upload_failed: { step: 1, bucket: 'mine', label: '上傳失敗', action: '重試' },
  upload_waiting: { step: 1, bucket: 'waiting', label: '等待上傳' },
  uploading: { step: 1, bucket: 'waiting', label: '傳送中' },
  upload_needs_admin: { step: 1, bucket: 'waiting', label: '等管理員確認' },
  in_review: { step: 2, bucket: 'mine', label: '確認成品', action: '確認成品' },
  approved_waiting_upload: { step: 2, bucket: 'waiting', label: '已核准，等待上架' },
  published: { step: 3, bucket: 'done', label: '已上架' },
  dismissed: { step: 3, bucket: 'closed', label: '不做了' },
};

export function describeAvatar(script, assets = []) {
  const status = deriveDisplayStatus(script, assets);
  return { ...(AVATAR_INFO[status.key] || AVATAR_INFO.to_generate), state: status.key };
}

// 兩種產片方式共用的描述：清單、管理頁都用這個。
export function describeShort(script, assets = []) {
  return isRecutScript(script) ? describeScript(script) : describeAvatar(script, assets);
}

export function chipTone(info) {
  return ['render_failed', 'upload_failed'].includes(info.state) || info.label === '產生失敗' ? 'error' : info.bucket;
}

export function toManageItem(script, course, assets = []) {
  const info = describeShort(script, assets);
  return {
    scriptId: String(script._id),
    courseId: String(script.courseId || course?._id || ''),
    courseTitle: course?.title || '',
    question: scriptQuestion(script),
    state: info.state,
    label: info.label,
    action: info.action || null,
    bucket: info.bucket,
    tone: chipTone(info),
    updatedAt: script.updatedAt || script.createdAt || null,
  };
}

// 講稿最上方顯示「這支短片要回答的問題」：優先用學生原本的問法。
export function scriptQuestion(script) {
  return script?.sourceQuestions?.[0]?.question || script?.topic || '';
}

// ── 時長 ─────────────────────────────────────────────────────────

export function durationStatus(seconds) {
  const sec = Math.round(Number(seconds) || 0);
  if (sec < MIN_DURATION_SEC) return { sec, valid: false, delta: MIN_DURATION_SEC - sec, message: `還差 ${MIN_DURATION_SEC - sec} 秒` };
  if (sec > MAX_DURATION_SEC) return { sec, valid: false, delta: sec - MAX_DURATION_SEC, message: `超過 ${sec - MAX_DURATION_SEC} 秒` };
  return { sec, valid: true, delta: 0, message: '' };
}

// 尺的範圍固定 0～80 秒，30～65 秒為可用區間；回傳百分比給 CSS。
export const METER_MAX_SEC = 80;
export function meterPercent(seconds) {
  return Math.max(0, Math.min(100, ((Number(seconds) || 0) / METER_MAX_SEC) * 100));
}

// 數位分身腳本的鏡頭時間（例如「5-15s」）改成和講稿一樣的 0:05–0:15；看不懂的格式原樣顯示。
export function formatShotRange(range) {
  const match = String(range || '').trim().match(/^(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)\s*s?$/i);
  if (!match) return String(range || '');
  return `${formatClock(match[1])}–${formatClock(match[2])}`;
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ── 講稿逐句排列 ───────────────────────────────────────────────────
// 依原片順序列出句子：留用的句子、留用句前後各一句被略過的句子（點一下可加回）照原位顯示；
// 更遠的連續略過句收成一行「略過 N 句」，展開後才列出。片頭句另外放在最上方，不在原位重複。

export function buildScriptLines(sentences = [], expandedGaps = new Set()) {
  const list = sentences.filter((s) => !s.opening);
  const keptIdx = list.map((s, i) => (s.selected ? i : -1)).filter((i) => i >= 0);
  const near = new Set();
  for (const i of keptIdx) { near.add(i - 1); near.add(i + 1); }
  const lines = [];
  let gap = [];
  const flushGap = () => {
    if (!gap.length) return;
    const id = `gap-${gap[0].id}`;
    if (expandedGaps.has(id)) gap.forEach((s) => lines.push({ type: 'sentence', role: 'omitted', sentence: s }));
    else lines.push({ type: 'gap', id, count: gap.length, sentenceIds: gap.map((s) => s.id) });
    gap = [];
  };
  list.forEach((s, i) => {
    if (s.selected) { flushGap(); lines.push({ type: 'sentence', role: 'kept', sentence: s }); return; }
    // 老師移除的句子留在原位（帶「已移除」），焦點與修改紀錄都不會消失。
    if (near.has(i) || s.teacherChanged || !keptIdx.length) { flushGap(); lines.push({ type: 'sentence', role: 'omitted', sentence: s }); return; }
    gap.push(s);
  });
  flushGap();
  return lines;
}

export function openingSentence(sentences = []) {
  return sentences.find((s) => s.opening) || null;
}

// 成品播放時，用講稿順序（片頭在前）與每句長度推算目前那一句。只是近似值，供同步標示。
export function playbackTimeline(sentences = []) {
  const opening = openingSentence(sentences);
  const ordered = [...(opening ? [opening] : []), ...sentences.filter((s) => s.selected && !s.opening)];
  let at = 0;
  return ordered.map((s) => {
    const length = Math.max(0, (Number(s.endSec) || 0) - (Number(s.startSec) || 0));
    const item = { id: s.id, from: at, to: at + length };
    at += length;
    return item;
  });
}

// 講稿時間軸上的 30／65 秒刻線：放在第一句從該秒數之後才開始的留用句前面，
// 老師加回或移除句子時刻線跟著移動，看得出哪幾句會超出長度。
export const CUT_MARKS = [MIN_DURATION_SEC, MAX_DURATION_SEC];
export function withCutMarks(lines, timeline) {
  const starts = new Map(timeline.map((item) => [item.id, item.from]));
  const pending = [...CUT_MARKS];
  const result = [];
  for (const line of lines) {
    const from = line.type === 'sentence' && line.role === 'kept' ? starts.get(line.sentence.id) : undefined;
    while (from !== undefined && pending.length && from >= pending[0]) {
      result.push({ type: 'mark', id: `mark-${pending[0]}`, sec: pending[0] });
      pending.shift();
    }
    result.push(line);
  }
  return result;
}

// 素材來源：影片名稱與這段在原片的時間範圍，讓老師知道剪自哪裡（可查核）。
export function sourceLabel(script, source) {
  if (!source) return '';
  const evidence = script?.evidence || [];
  const title = evidence.find((item) => String(item.videoId) === String(source.videoId))?.videoTitle || evidence[0]?.videoTitle || '';
  const sentences = source.sentences || [];
  const start = Number.isFinite(source.startSec) ? source.startSec : sentences[0]?.startSec;
  const end = Number.isFinite(source.endSec) ? source.endSec : sentences.at(-1)?.endSec;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return title;
  const range = `${formatClock(start)}–${formatClock(end)}`;
  return title ? `${title}・${range}` : `原片 ${range}`;
}

// 管理清單的「多久前更新」。
export function formatAgo(value, now = Date.now()) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function sentenceAt(timeline, seconds) {
  const t = Number(seconds) || 0;
  const hit = timeline.find((item) => t >= item.from && t < item.to);
  return hit ? hit.id : null;
}

// ── 退回成品 ──────────────────────────────────────────────────────
// 內容有問題要回到講稿重審（content）；只是畫面、聲音、字幕問題回到製作（presentation）。
// 「其他」沒辦法判斷是哪一種，保守地回到講稿，讓老師有機會再看一次。
const CONTENT_REASONS = new Set(['contentIncorrect', 'incomplete', 'other']);
export function rejectScope(codes = []) {
  return codes.some((code) => CONTENT_REASONS.has(code)) ? 'content' : 'presentation';
}

// ── 錯誤文案 ──────────────────────────────────────────────────────
// 教師畫面不出現技術名詞；沒有對應的代碼沿用後端已轉成中文的訊息。

const ERROR_TEXT = {
  RECUT_STATE_INVALID: '這支短片剛剛有更新，已重新載入。',
  RECUT_BATCH_LIMIT_EXCEEDED: '這門課已有 5 支在產生講稿，完成後再開始。',
  RECUT_REVIEW_NOT_READY: '講稿還沒準備好。',
  RECUT_DURATION_INVALID: '總長需在 30～65 秒才能套用。',
  RECUT_LOCK_CONFIRM_REQUIRED: '這個建議會改到你調整過的句子，請確認後再採納。',
  RECUT_SUGGESTION_NOT_READY: '這個建議暫時無法套用。',
  RECUT_MODEL_FAILED: 'AI 暫時無法完成，已保留原本的講稿。',
  RECUT_CALL_LIMIT_EXCEEDED: '這支短片的 AI 次數已用完，請聯絡管理員。',
  RECUT_REPAIR_STALLED: 'AI 重複出現同一個錯誤，已停止以保留次數。請調整講稿或換一個主題。',
  RECUT_TASK_CANCELLED: '已取消，講稿維持原樣。',
  RECUT_TASK_INTERRUPTED: '系統重新啟動中斷了處理，講稿維持原樣，可以再試一次。',
  RECUT_SOURCE_UPDATED: '原片的逐字稿已更新，請重新產生講稿。',
  RECUT_SOURCE_UNAVAILABLE: '找不到這門課的原片檔案，請先確認原片仍在系統上。',
  RECUT_WINDOW_NOT_FOUND: '這個主題在原片裡找不到夠長的連續段落。',
  RECUT_CONTENT_CONSENT_REQUIRED: '需要先同意授課內容的使用條款。',
  RECUT_VOICE_CONSENT_REQUIRED: '需要先選擇聲音。',
  RECUT_SYNTHETIC_VOICE_NOT_READY: '合成語音還沒開放，請改用老師原音。',
  RECUT_CONSENT_TERMS_OUTDATED: '條款已更新，請重新閱讀後確認。',
  RECUT_CONSENT_WITHDRAWAL_PENDING: '還有下架工作沒完成，請先處理。',
  RECUT_TEXT_OVERFLOW: '圖卡文字太長放不下。移除或換掉較長的句子，確定修改後再製作。',
  RECUT_RENDER_AUDIO_LOWERED: '製作時聲音處理異常，已通知管理員檢查，重新製作也會失敗。',
  RECUT_RENDER_CHECK_FAILED: '影片沒有通過聲音或長度檢查，已通知管理員檢查。',
  RECUT_COMPLETION_FAILED: '影片做好了但無法存檔，請重新製作。',
  RECUT_RENDER_FAILED: '製作沒有完成，可以重新製作一次。',
  SHORT_SCRIPT_NO_CANDIDATE: '這個主題目前沒有足夠的學生提問。',
  SHORT_SCRIPT_EVIDENCE_EMPTY: '原片裡找不到能回答這題的段落。',
  LOCAL_PLAYBACK_UNAVAILABLE: '原片目前無法播放。',
};

export function recutErrorText(error) {
  if (!error) return '';
  if (error.status === 404 && error.code === 'NOT_FOUND') return '短影片功能目前未開放。';
  // fetch 本身失敗（離線、斷線）時沒有 HTTP 狀態，訊息是瀏覽器的英文，不能直接給老師看。
  if (!error.status && error.name !== 'AbortError' && !error.code) return '連不上伺服器，請確認網路後再試。';
  if (error.status === 503) return '服務暫時無法使用，請稍後再試。';
  // 沒對應的代碼時，只有中文的伺服器訊息才直接顯示；英文或技術訊息一律換成可理解的說法。
  if (ERROR_TEXT[error.code]) return ERROR_TEXT[error.code];
  if (/[\u3400-\u9fff]/.test(error.message || '')) return error.message;
  return '發生錯誤，請稍後再試；一直失敗請聯絡管理員。';
}

// 渲染失敗的固定類錯誤，重送也不會成功，不提供「再製作一次」。
// RECUT_TEXT_OVERFLOW 要先改講稿；聲音異常與檢查不通過需要管理員處理。
export function isFixedRenderFailure(code) {
  return ['RECUT_TEXT_OVERFLOW', 'RECUT_RENDER_AUDIO_LOWERED', 'RECUT_RENDER_CHECK_FAILED'].includes(code);
}

export function renderFailureText(render) {
  return recutErrorText({ code: render?.errorCode || 'RECUT_RENDER_FAILED' });
}

export function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// 第一次使用時要補哪些同意：內容同意依課程、聲音偏好是教師全域。
export function consentNeeds(consent) {
  return {
    content: consent?.decisions?.content?.choice !== 'granted',
    voice: consent?.voiceMode !== 'original',
  };
}

// ── 接續上次的位置 ─────────────────────────────────────────────────
// 同一台裝置記住最後打開的那一支；換裝置時從「短影片管理」的等你處理清單接續。
const LAST_KEY = 'ff_recut_last';
export function rememberLastScript(target, storage = globalThis.localStorage) {
  try { storage?.setItem(LAST_KEY, JSON.stringify({ courseId: String(target.courseId || ''), scriptId: String(target.scriptId || '') })); } catch { /* storage blocked */ }
}
export function recallLastScript(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(LAST_KEY) || 'null');
    return value?.scriptId ? value : null;
  } catch { return null; }
}
