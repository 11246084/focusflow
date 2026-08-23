export const SOURCE_PREVIEW_COUNT = 3;

export function mapConversationMessage(message) {
  const sources = message.sources || message.matches || message.segments || [];
  return {
    ...message,
    answer: message.answer || message.content || '',
    matches: sources,
    status: message.status || 'completed',
  };
}

export function getVisibleSources(sources, expanded, previewCount = SOURCE_PREVIEW_COUNT) {
  const items = Array.isArray(sources) ? sources : [];
  return expanded ? items : items.slice(0, previewCount);
}

export function getRemainingSourceCount(sources, previewCount = SOURCE_PREVIEW_COUNT) {
  return Math.max(0, (Array.isArray(sources) ? sources.length : 0) - previewCount);
}

export function toStudentCitation(source) {
  return {
    videoId: source.videoId || '',
    videoTitle: source.videoTitle || source.title || source.fileName || '',
    startSec: source.startSec ?? source.start_sec ?? 0,
    endSec: source.endSec ?? source.end_sec ?? source.startSec ?? source.start_sec ?? 0,
    transcript: source.transcript || source.text || source.content || '',
  };
}

export function formatConversationDate(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((dayStart - targetStart) / 86400000);
  if (dayDiff === 0) return '今天';
  if (dayDiff === 1) return '昨天';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
