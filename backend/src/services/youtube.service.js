const env = require('../config/env');

const CHANNEL_HANDLE = 'FocusFlow-ai413';
const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedChannelId = null;
// Map<cacheKey, { data, expiresAt }>
const pageCache = new Map();

async function fetchYouTubeJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `YouTube API responded with ${res.status}`;
    const err = new Error(msg);
    err.youtubeStatus = res.status;
    err.youtubeCode = body?.error?.code;
    throw err;
  }
  return body;
}

async function resolveChannelId() {
  if (cachedChannelId) return cachedChannelId;
  const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${CHANNEL_HANDLE}&key=${env.youtubeApiKey}`;
  const data = await fetchYouTubeJson(url);
  if (!data.items?.length) throw new Error('YouTube channel not found for handle: ' + CHANNEL_HANDLE);
  cachedChannelId = data.items[0].id;
  return cachedChannelId;
}

// YouTube uploads playlist: replace leading "UC" with "UU"
function toUploadsPlaylistId(channelId) {
  return 'UU' + channelId.slice(2);
}

async function getShorts(pageToken = '') {
  const cacheKey = pageToken || '__first__';
  const hit = pageCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const channelId = await resolveChannelId();
  const playlistId = toUploadsPlaylistId(channelId);

  let apiUrl =
    `https://www.googleapis.com/youtube/v3/playlistItems` +
    `?part=snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=20&key=${env.youtubeApiKey}`;
  if (pageToken) apiUrl += `&pageToken=${encodeURIComponent(pageToken)}`;

  const raw = await fetchYouTubeJson(apiUrl);

  const result = {
    items: (raw.items || []).map((item) => {
      const sn = item.snippet;
      const thumb =
        sn.thumbnails?.maxres?.url ||
        sn.thumbnails?.high?.url ||
        sn.thumbnails?.medium?.url ||
        sn.thumbnails?.default?.url ||
        null;
      return {
        videoId: sn.resourceId.videoId,
        title: sn.title,
        thumbnail: thumb,
        publishedAt: sn.publishedAt,
      };
    }),
    nextPageToken: raw.nextPageToken || null,
  };

  pageCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

module.exports = { getShorts };
