const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_LIMIT = 50;

// Production smoke validation is read-only: it checks health, authenticated
// feed shape, and optional YouTube reachability without mutating Short assets.

class SmokeCheckError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SmokeCheckError';
    this.code = code;
  }
}

function parseBoolean(value, defaultValue) {
  if (value == null || value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new SmokeCheckError('Boolean smoke options must be true or false.', 'INVALID_CONFIG');
}

function normalizeBaseUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    throw new SmokeCheckError('SHORTS_SMOKE_BASE_URL is required.', 'INVALID_CONFIG');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SmokeCheckError('SHORTS_SMOKE_BASE_URL must be a valid URL.', 'INVALID_CONFIG');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new SmokeCheckError('SHORTS_SMOKE_BASE_URL must use HTTP or HTTPS.', 'INVALID_CONFIG');
  }

  url.search = '';
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/api/v1')) pathname = pathname.slice(0, -'/api/v1'.length);
  url.pathname = pathname || '/';
  return url.toString().replace(/\/$/, '');
}

function loadConfig(env = process.env) {
  const bearerToken = String(env.SHORTS_SMOKE_BEARER_TOKEN || '').trim();
  const email = String(env.SHORTS_SMOKE_STUDENT_EMAIL || '').trim();
  const password = String(env.SHORTS_SMOKE_STUDENT_PASSWORD || '');
  if (!bearerToken && (!email || !password)) {
    throw new SmokeCheckError(
      'Provide SHORTS_SMOKE_BEARER_TOKEN or both student email and password.',
      'INVALID_CONFIG',
    );
  }

  const timeoutMs = Number(env.SHORTS_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new SmokeCheckError('SHORTS_SMOKE_TIMEOUT_MS must be between 1000 and 120000.', 'INVALID_CONFIG');
  }

  return {
    baseUrl: normalizeBaseUrl(env.SHORTS_SMOKE_BASE_URL),
    bearerToken,
    email,
    password,
    expectedCourseId: String(env.SHORTS_SMOKE_EXPECTED_COURSE_ID || '').trim(),
    expectedVideoId: String(env.SHORTS_SMOKE_EXPECTED_VIDEO_ID || '').trim(),
    allowEmpty: parseBoolean(env.SHORTS_SMOKE_ALLOW_EMPTY, false),
    verifyYouTube: parseBoolean(env.SHORTS_SMOKE_VERIFY_YOUTUBE, true),
    timeoutMs,
  };
}

async function requestJson(url, options = {}, { fetchImpl = global.fetch, timeoutMs } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new SmokeCheckError('Fetch is unavailable.', 'FETCH_UNAVAILABLE');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = body?.error?.code || `HTTP_${response.status}`;
      throw new SmokeCheckError(`${options.method || 'GET'} ${url} failed with ${code}.`, code);
    }
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new SmokeCheckError(`Request timed out: ${url}`, 'REQUEST_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateHealth(body) {
  const snapshot = body?.data?.runtime?.shortsSync;
  if (!snapshot || typeof snapshot !== 'object') {
    throw new SmokeCheckError('Health response is missing runtime.shortsSync.', 'SHORTS_HEALTH_MISSING');
  }
  if (snapshot.enabled !== true) {
    throw new SmokeCheckError('Shorts sync is disabled.', 'SHORTS_SYNC_DISABLED');
  }
  if (snapshot.degraded === true || snapshot.lastError) {
    throw new SmokeCheckError('Shorts sync health is degraded.', 'SHORTS_SYNC_DEGRADED');
  }
  if (!snapshot.lastAttemptAt || !snapshot.lastSuccessAt) {
    throw new SmokeCheckError('Shorts sync has no completed successful cycle.', 'SHORTS_SYNC_NOT_OBSERVED');
  }
  return snapshot;
}

function validateShortItem(item) {
  const requiredStrings = [
    ['assetId', item?.assetId],
    ['videoId', item?.videoId],
    ['title', item?.title],
    ['course.courseId', item?.course?.courseId],
    ['course.title', item?.course?.title],
    ['youtubeUrl', item?.youtubeUrl],
  ];
  const missing = requiredStrings
    .filter(([, value]) => typeof value !== 'string' || !value.trim())
    .map(([field]) => field);
  if (missing.length) {
    throw new SmokeCheckError(`Short item is missing: ${missing.join(', ')}.`, 'INVALID_SHORT_ITEM');
  }
  if (Number.isNaN(new Date(item.publishedAt).getTime())) {
    throw new SmokeCheckError('Short item has an invalid publishedAt.', 'INVALID_SHORT_ITEM');
  }
  if (!item.youtubeUrl.includes(item.videoId)) {
    throw new SmokeCheckError('Short youtubeUrl does not match videoId.', 'INVALID_SHORT_ITEM');
  }
}

async function verifyYouTubeItems(items, requestOptions) {
  for (const item of items.slice(0, 5)) {
    const oembedUrl = new URL('https://www.youtube.com/oembed');
    oembedUrl.searchParams.set('url', item.youtubeUrl);
    oembedUrl.searchParams.set('format', 'json');
    await requestJson(oembedUrl.toString(), {}, requestOptions);
  }
}

async function runSmoke(config, { fetchImpl = global.fetch, log = console.log } = {}) {
  const requestOptions = { fetchImpl, timeoutMs: config.timeoutMs };
  const health = await requestJson(`${config.baseUrl}/health`, {}, requestOptions);
  const shortsSync = validateHealth(health);

  let token = config.bearerToken;
  let loginUsed = false;
  if (!token) {
    loginUsed = true;
    const login = await requestJson(`${config.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: config.email, password: config.password, role: 'student' }),
    }, requestOptions);
    token = login?.data?.token;
    if (typeof token !== 'string' || !token) {
      throw new SmokeCheckError('Login response did not include a token.', 'LOGIN_TOKEN_MISSING');
    }
  }

  const authHeaders = { Authorization: `Bearer ${token}` };
  const firstPage = await requestJson(
    `${config.baseUrl}/api/v1/youtube/shorts?limit=${DEFAULT_LIMIT}`,
    { headers: authHeaders },
    requestOptions,
  );
  const items = firstPage?.data?.items;
  if (!Array.isArray(items)) {
    throw new SmokeCheckError('Shorts response data.items must be an array.', 'INVALID_SHORTS_RESPONSE');
  }
  if (!config.allowEmpty && items.length === 0) {
    throw new SmokeCheckError('Student feed is empty; a formal fixture is required.', 'SHORTS_FEED_EMPTY');
  }
  items.forEach(validateShortItem);

  if (config.expectedCourseId && !items.some((item) => item.course.courseId === config.expectedCourseId)) {
    throw new SmokeCheckError('Expected course is absent from the student feed.', 'EXPECTED_COURSE_MISSING');
  }
  if (config.expectedVideoId && !items.some((item) => item.videoId === config.expectedVideoId)) {
    throw new SmokeCheckError('Expected YouTube video is absent from the student feed.', 'EXPECTED_VIDEO_MISSING');
  }

  let secondPageCount = 0;
  const nextPageToken = firstPage?.data?.nextPageToken;
  if (nextPageToken) {
    const secondPage = await requestJson(
      `${config.baseUrl}/api/v1/youtube/shorts?limit=${DEFAULT_LIMIT}&pageToken=${encodeURIComponent(nextPageToken)}`,
      { headers: authHeaders },
      requestOptions,
    );
    const secondItems = secondPage?.data?.items;
    if (!Array.isArray(secondItems)) {
      throw new SmokeCheckError('Second Shorts page data.items must be an array.', 'INVALID_SHORTS_RESPONSE');
    }
    secondItems.forEach(validateShortItem);
    const firstIds = new Set(items.map((item) => item.assetId));
    if (secondItems.some((item) => firstIds.has(item.assetId))) {
      throw new SmokeCheckError('Shorts pagination returned duplicate assets.', 'SHORTS_PAGE_DUPLICATE');
    }
    secondPageCount = secondItems.length;
  }

  if (config.verifyYouTube) await verifyYouTubeItems(items, requestOptions);

  const summary = {
    baseUrl: config.baseUrl,
    loginUsed,
    firstPageCount: items.length,
    secondPageCount,
    youtubeChecked: config.verifyYouTube ? Math.min(items.length, 5) : 0,
    shortsSync: {
      lastAttemptAt: shortsSync.lastAttemptAt,
      lastSuccessAt: shortsSync.lastSuccessAt,
      degraded: shortsSync.degraded,
    },
  };
  log(JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  try {
    const config = loadConfig();
    await runSmoke(config);
  } catch (error) {
    console.error(`[${error.code || 'SHORTS_SMOKE_FAILED'}] ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = {
  SmokeCheckError,
  loadConfig,
  normalizeBaseUrl,
  requestJson,
  runSmoke,
  validateHealth,
  validateShortItem,
};
