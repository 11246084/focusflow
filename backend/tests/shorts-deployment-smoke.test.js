const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  loadConfig,
  normalizeBaseUrl,
  runSmoke,
  validateHealth,
} = require('../src/scripts/verifyShortsDeployment');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function healthyRuntime() {
  return {
    success: true,
    data: {
      runtime: {
        shortsSync: {
          enabled: true,
          lastAttemptAt: '2026-08-11T10:00:00.000Z',
          lastSuccessAt: '2026-08-11T10:00:01.000Z',
          lastError: null,
          degraded: false,
        },
      },
    },
  };
}

function visibleShort() {
  return {
    assetId: '507f191e810c19729de86101',
    videoId: 'youtube-video-1',
    title: '正式測試 Short',
    thumbnail: 'https://img.youtube.com/vi/youtube-video-1/hqdefault.jpg',
    publishedAt: '2026-08-11T09:00:00.000Z',
    course: {
      courseId: '507f191e810c19729de860eb',
      title: '正式測試課程',
    },
    youtubeUrl: 'https://www.youtube.com/watch?v=youtube-video-1',
  };
}

describe('Shorts 正式環境唯讀 smoke', () => {
  it('正規化正式網址並移除 api/v1 後綴', () => {
    assert.equal(normalizeBaseUrl('https://example.com/api/v1/'), 'https://example.com');
  });

  it('沒有 token 或學生登入資料時拒絕執行', () => {
    assert.throws(
      () => loadConfig({ SHORTS_SMOKE_BASE_URL: 'https://example.com' }),
      (error) => error.code === 'INVALID_CONFIG',
    );
  });

  it('同步停用、degraded 或尚無成功週期時拒絕通過', () => {
    assert.throws(
      () => validateHealth({ data: { runtime: { shortsSync: { enabled: false } } } }),
      (error) => error.code === 'SHORTS_SYNC_DISABLED',
    );
    assert.throws(
      () => validateHealth({ data: { runtime: { shortsSync: { enabled: true, degraded: true } } } }),
      (error) => error.code === 'SHORTS_SYNC_DEGRADED',
    );
    assert.throws(
      () => validateHealth({ data: { runtime: { shortsSync: { enabled: true, degraded: false } } } }),
      (error) => error.code === 'SHORTS_SYNC_NOT_OBSERVED',
    );
  });

  it('使用既有 token 完成 health、feed、fixture 與 YouTube oEmbed 檢查', async () => {
    const requests = [];
    const item = visibleShort();
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET' });
      if (url.endsWith('/health')) return jsonResponse(healthyRuntime());
      if (url.includes('/api/v1/youtube/shorts')) {
        assert.equal(options.headers.Authorization, 'Bearer existing-token');
        return jsonResponse({ data: { items: [item], nextPageToken: null } });
      }
      if (url.startsWith('https://www.youtube.com/oembed')) return jsonResponse({ title: item.title });
      throw new Error(`Unexpected URL: ${url}`);
    };

    const summary = await runSmoke({
      baseUrl: 'https://example.com',
      bearerToken: 'existing-token',
      email: '',
      password: '',
      expectedCourseId: item.course.courseId,
      expectedVideoId: item.videoId,
      allowEmpty: false,
      verifyYouTube: true,
      timeoutMs: 5000,
    }, { fetchImpl, log: () => {} });

    assert.equal(summary.loginUsed, false);
    assert.equal(summary.firstPageCount, 1);
    assert.equal(summary.youtubeChecked, 1);
    assert.equal(requests.some((request) => request.method === 'POST'), false);
  });

  it('登入模式只送出 student login 且不註冊或修改資料', async () => {
    const requests = [];
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith('/health')) return jsonResponse(healthyRuntime());
      if (url.endsWith('/api/v1/auth/login')) {
        assert.deepEqual(JSON.parse(options.body), {
          email: 'student@example.com',
          password: 'secret-password',
          role: 'student',
        });
        return jsonResponse({ data: { token: 'login-token' } });
      }
      if (url.includes('/api/v1/youtube/shorts')) {
        return jsonResponse({ data: { items: [], nextPageToken: null } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const summary = await runSmoke({
      baseUrl: 'https://example.com',
      bearerToken: '',
      email: 'student@example.com',
      password: 'secret-password',
      expectedCourseId: '',
      expectedVideoId: '',
      allowEmpty: true,
      verifyYouTube: false,
      timeoutMs: 5000,
    }, { fetchImpl, log: () => {} });

    assert.equal(summary.loginUsed, true);
    assert.equal(requests.filter(({ options }) => options.method === 'POST').length, 1);
    assert.equal(requests.some(({ url }) => url.includes('/auth/register')), false);
  });
});
