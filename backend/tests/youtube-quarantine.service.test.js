const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { ids, resetStore, store } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const youtubeUploadService = require('../src/services/youtubeUpload.service');
const quarantineService = require('../src/services/youtubeQuarantine.service');

const FORCE_SSL_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const ENV_KEYS = [
  'youtubeUploadEnabled',
  'youtubeClientId',
  'youtubeClientSecret',
  'youtubeRefreshToken',
  'youtubeOAuthClientId',
  'youtubeOAuthClientSecret',
  'youtubeOAuthRefreshToken',
  'youtubeUploadAccessToken',
];

const VIDEO_ID = '6c0000000000000000000001';
const ASSET_ID = '6c0000000000000000000002';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function playlistItem(youtubeVideoId, description, privacyStatus = 'unlisted') {
  return {
    snippet: { title: `YT ${youtubeVideoId}`, description, publishedAt: '2026-10-01T00:00:00Z' },
    contentDetails: { videoId: youtubeVideoId, videoPublishedAt: '2026-10-01T00:00:00Z' },
    status: { privacyStatus },
  };
}

// 假的 YouTube Data API：token、channels.list、分頁的 playlistItems.list、videos.list。
function buildYouTubeFake({
  scope = FORCE_SSL_SCOPE,
  pages = [[]],
  channelStatus = 200,
} = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const text = String(url);
    calls.push(text);
    if (text.includes('oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'quarantine-access-token', scope });
    }
    if (text.startsWith(quarantineService.YOUTUBE_CHANNELS_URL)) {
      if (channelStatus !== 200) return jsonResponse({ error: { message: 'forbidden' } }, channelStatus);
      return jsonResponse({
        items: [{ id: 'UCownChannel', contentDetails: { relatedPlaylists: { uploads: 'UUownUploads' } } }],
      });
    }
    if (text.startsWith(quarantineService.YOUTUBE_PLAYLIST_ITEMS_URL)) {
      const pageToken = new URL(text).searchParams.get('pageToken');
      const index = pageToken ? Number(pageToken.replace('page-', '')) : 0;
      return jsonResponse({
        items: pages[index] || [],
        nextPageToken: index + 1 < pages.length ? `page-${index + 1}` : undefined,
      });
    }
    throw new Error(`Unexpected fetch: ${text}`);
  };
  return { fetchImpl, calls };
}

function addQuarantinedVideo(overrides = {}) {
  const video = {
    _id: VIDEO_ID,
    courseId: ids.teacherCourse,
    title: 'Quarantined lecture',
    uploadedBy: ids.teacher,
    processing: { status: 'completed' },
    youtubeUpload: {
      status: 'failed',
      error: 'Stale upload quarantined: review YouTube Studio before retrying.',
      attemptCount: 1,
      failedAt: new Date('2026-10-19T00:00:00Z'),
      retrySafe: false,
    },
    ...overrides,
  };
  store.videos.push(video);
  return video;
}

function addQuarantinedAsset(overrides = {}) {
  const asset = {
    _id: ASSET_ID,
    courseId: ids.teacherCourse,
    title: 'Quarantined short',
    filePath: 'uploads/test-upload-short.mp4',
    status: 'draft',
    disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true, confirmedBy: ids.teacher },
    youtubeUpload: {
      status: 'failed',
      error: 'Failed to upload video to YouTube.',
      attemptCount: 2,
      failedAt: new Date('2026-10-20T00:00:00Z'),
      retrySafe: false,
    },
    ...overrides,
  };
  store.shortAssets.push(asset);
  return asset;
}

describe('youtubeQuarantine.service 隔離清單與查詢', () => {
  let originalEnv;

  beforeEach(() => {
    resetStore();
    youtubeUploadService.resetYouTubeUploadState();
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
    env.youtubeUploadEnabled = true;
    env.youtubeClientId = 'client-id';
    env.youtubeClientSecret = 'client-secret';
    env.youtubeRefreshToken = 'refresh-token';
    env.youtubeUploadAccessToken = '';
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
    youtubeUploadService.resetYouTubeUploadState();
  });

  it('清單列出隔離的影片與短片，不含可重試或已上傳的項目', async () => {
    addQuarantinedVideo();
    addQuarantinedAsset();
    store.videos.push({
      _id: '6c0000000000000000000003',
      courseId: ids.teacherCourse,
      title: 'Retry safe',
      youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 1 },
    });
    store.shortAssets.push({
      _id: '6c0000000000000000000004',
      courseId: ids.teacherCourse,
      title: 'Archived short',
      filePath: 'uploads/archived.mp4',
      status: 'archived',
      youtubeUpload: { status: 'failed', retrySafe: false },
    });

    const result = await quarantineService.listQuarantinedItems();
    const course = store.courses.find((item) => item._id === ids.teacherCourse);
    const teacher = store.users.find((user) => user._id === ids.teacher);

    assert.deepEqual(result.items.map((item) => `${item.kind}:${item.id}`), [
      `short_asset:${ASSET_ID}`,
      `video:${VIDEO_ID}`,
    ]);
    assert.deepEqual(result.items[1], {
      kind: 'video',
      id: VIDEO_ID,
      title: 'Quarantined lecture',
      courseId: ids.teacherCourse,
      courseTitle: course.title,
      uploadedBy: { id: ids.teacher, name: teacher.name },
      failedAt: new Date('2026-10-19T00:00:00Z'),
      error: 'Stale upload quarantined: review YouTube Studio before retrying.',
      attemptCount: 1,
    });
    assert.equal(result.items[0].uploadedBy.id, ids.teacher);
    assert.equal(result.items[0].attemptCount, 2);
  });

  it('清單把沒有 retrySafe 的舊失敗紀錄也視為隔離', async () => {
    addQuarantinedVideo({ youtubeUpload: { status: 'failed', attemptCount: 1 } });

    const result = await quarantineService.listQuarantinedItems();

    assert.deepEqual(result.items.map((item) => item.id), [VIDEO_ID]);
  });

  it('清單在本行程還沒換過 token 時 searchable 為 null，未設定憑證時為 false', async () => {
    assert.equal((await quarantineService.listQuarantinedItems()).searchable, null);
    env.youtubeClientId = '';
    assert.equal((await quarantineService.listQuarantinedItems()).searchable, false);
  });

  it('有讀取權限時依描述標記找出影片，跨頁比對且不修改資料', async () => {
    const video = addQuarantinedVideo();
    const { fetchImpl } = buildYouTubeFake({
      pages: [
        [playlistItem('otherVideo1', 'Uploaded by FocusFlow (video 6c0000000000000000000009).')],
        [playlistItem('matchVideo1', `Uploaded by FocusFlow (video ${VIDEO_ID}).`, 'unlisted')],
      ],
    });

    const result = await quarantineService.lookupQuarantinedItem({ kind: 'video', id: VIDEO_ID, fetchImpl });

    assert.deepEqual(result, {
      searchable: true,
      matches: [{
        youtubeVideoId: 'matchVideo1',
        title: 'YT matchVideo1',
        publishedAt: '2026-10-01T00:00:00Z',
        privacyStatus: 'unlisted',
      }],
    });
    assert.equal(video.youtubeUpload.status, 'failed');
    assert.equal(video.youtubeVideoId, undefined);
  });

  it('短片依 (FocusFlow short <id>) 標記比對，不會誤配影片標記', async () => {
    addQuarantinedAsset();
    const { fetchImpl } = buildYouTubeFake({
      pages: [[
        playlistItem('videoMarker', `Uploaded by FocusFlow (video ${ASSET_ID}).`),
        playlistItem('shortMarker', `教師描述\n(FocusFlow short ${ASSET_ID})`),
      ]],
    });

    const result = await quarantineService.lookupQuarantinedItem({ kind: 'short_asset', id: ASSET_ID, fetchImpl });

    assert.deepEqual(result.matches.map((match) => match.youtubeVideoId), ['shortMarker']);
  });

  it('憑證只有上傳權限時回 searchable: false，不讀頻道', async () => {
    addQuarantinedVideo();
    const { fetchImpl, calls } = buildYouTubeFake({ scope: UPLOAD_SCOPE });

    const result = await quarantineService.lookupQuarantinedItem({ kind: 'video', id: VIDEO_ID, fetchImpl });

    assert.deepEqual(result, { searchable: false, matches: [] });
    assert.equal(calls.some((url) => url.startsWith(quarantineService.YOUTUBE_CHANNELS_URL)), false);
  });

  it('沒有設定憑證時回 searchable: false', async () => {
    addQuarantinedVideo();
    env.youtubeRefreshToken = '';
    const { fetchImpl, calls } = buildYouTubeFake();

    const result = await quarantineService.lookupQuarantinedItem({ kind: 'video', id: VIDEO_ID, fetchImpl });

    assert.deepEqual(result, { searchable: false, matches: [] });
    assert.equal(calls.length, 0);
  });

  it('不是隔離狀態的項目查詢回 409', async () => {
    addQuarantinedVideo({ youtubeUpload: { status: 'failed', retrySafe: true, attemptCount: 1 } });
    const { fetchImpl, calls } = buildYouTubeFake();

    await assert.rejects(
      quarantineService.lookupQuarantinedItem({ kind: 'video', id: VIDEO_ID, fetchImpl }),
      (error) => error.statusCode === 409 && error.code === 'YOUTUBE_QUARANTINE_NOT_ALLOWED',
    );
    assert.equal(calls.length, 0);
  });

  it('YouTube 讀取頻道失敗時回 502 YOUTUBE_QUARANTINE_VERIFY_FAILED', async () => {
    addQuarantinedVideo();
    const { fetchImpl } = buildYouTubeFake({ channelStatus: 403 });

    await assert.rejects(
      quarantineService.lookupQuarantinedItem({ kind: 'video', id: VIDEO_ID, fetchImpl }),
      (error) => error.statusCode === 502 && error.code === 'YOUTUBE_QUARANTINE_VERIFY_FAILED',
    );
  });
});

