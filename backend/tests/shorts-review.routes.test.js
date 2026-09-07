const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  ids,
  jsonRequest,
  loginAs,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  store,
} = require('./helpers/backendTestHarness');

function addReviewAsset({
  _id = newObjectId(),
  courseId = ids.teacherCourse,
  status = 'draft',
  reviewStatus = 'pending',
  generationVersion = 1,
  reviewedGenerationVersion = null,
  reviewHistory = [],
} = {}) {
  const asset = {
    _id,
    courseId,
    sourceVideoId: ids.teacherVideo,
    jobId: 'short-job-1',
    title: 'Review Short',
    description: 'Short awaiting teacher review',
    status,
    reviewStatus,
    reviewedBy: null,
    reviewedAt: null,
    reviewReasons: [],
    generationVersion,
    reviewedGenerationVersion,
    reviewHistory,
    youtubeVideoId: 'review-short-youtube-id',
    youtubeUrl: 'https://www.youtube.com/watch?v=review-short-youtube-id',
    thumbnail: null,
    publishedAt: null,
    youtubeAvailability: 'playable',
    youtubePrivacyStatus: 'unlisted',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
  };
  store.shortAssets.push(asset);
  return asset;
}

describe('ShortAsset teacher review routes', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(() => resetStore());

  it('review list 需要 teacher/admin，教師只會讀到自己課程的 pending ShortAsset', async () => {
    const ownAsset = addReviewAsset();
    addReviewAsset({ courseId: ids.foreignDraftCourse });
    addReviewAsset({ reviewStatus: 'approved', reviewedGenerationVersion: 1 });
    const teacherToken = await loginAs(
      serverContext.baseUrl,
      'teacher@focusflow.local',
      'Teacher123!',
    );
    const studentToken = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );

    const anonymous = await jsonRequest(serverContext.baseUrl, '/api/v1/shorts');
    const student = await jsonRequest(serverContext.baseUrl, '/api/v1/shorts', {
      token: studentToken,
    });
    const teacher = await jsonRequest(serverContext.baseUrl, '/api/v1/shorts', {
      token: teacherToken,
    });

    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.error.code, 'UNAUTHORIZED');
    assert.equal(student.status, 403);
    assert.equal(student.body.error.code, 'FORBIDDEN');
    assert.equal(teacher.status, 200);
    assert.deepEqual(teacher.body.data.items.map((item) => item.id), [ownAsset._id]);
    assert.equal(teacher.body.data.items[0].course.title, 'Teacher Draft Course');
  });

  it('admin 可讀取所有課程的審核 queue 與 detail', async () => {
    const foreignAsset = addReviewAsset({ courseId: ids.foreignDraftCourse });
    const adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');

    const list = await jsonRequest(serverContext.baseUrl, '/api/v1/shorts', { token: adminToken });
    const detail = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${foreignAsset._id}`,
      { token: adminToken },
    );

    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data.items.map((item) => item.id), [foreignAsset._id]);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.course.courseId, ids.foreignDraftCourse);
  });

  it('admin 可審核任一課程資產，且 approve 不直接 publish', async () => {
    const foreignAsset = addReviewAsset({ courseId: ids.foreignDraftCourse });
    const adminToken = await loginAs(serverContext.baseUrl, 'admin@focusflow.local', 'Admin123!');

    const reviewed = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${foreignAsset._id}/review`,
      {
        method: 'POST',
        token: adminToken,
        body: { status: 'approved', expectedGenerationVersion: 1 },
      },
    );

    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.data.reviewStatus, 'approved');
    assert.equal(reviewed.body.data.reviewedBy, ids.admin);
    assert.equal(reviewed.body.data.reviewedGenerationVersion, 1);
    assert.equal(reviewed.body.data.status, 'draft');
  });

  it('detail 與 review 遵守 not found 再 ownership 的錯誤優先序', async () => {
    const asset = addReviewAsset();
    const otherTeacherToken = await loginAs(
      serverContext.baseUrl,
      'teacher2@focusflow.local',
      'Teacher123!',
    );

    const missing = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${newObjectId()}/review`,
      {
        method: 'POST',
        token: otherTeacherToken,
        body: {},
      },
    );
    const deniedDetail = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${asset._id}`,
      { token: otherTeacherToken },
    );
    const deniedReview = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${asset._id}/review`,
      {
        method: 'POST',
        token: otherTeacherToken,
        body: { status: 'approved', expectedGenerationVersion: 1 },
      },
    );

    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'SHORT_ASSET_NOT_FOUND');
    assert.equal(deniedDetail.status, 403);
    assert.equal(deniedDetail.body.error.code, 'SHORT_ASSET_ACCESS_DENIED');
    assert.equal(deniedReview.status, 403);
    assert.equal(deniedReview.body.error.code, 'SHORT_ASSET_ACCESS_DENIED');
  });

  it('owner teacher 可 approve current generation，保存 readback 且不直接 publish', async () => {
    const asset = addReviewAsset();
    const teacherToken = await loginAs(
      serverContext.baseUrl,
      'teacher@focusflow.local',
      'Teacher123!',
    );

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${asset._id}/review`,
      {
        method: 'POST',
        token: teacherToken,
        body: { status: 'approved', expectedGenerationVersion: 1 },
      },
    );
    const readback = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${asset._id}`,
      { token: teacherToken },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.data.reviewStatus, 'approved');
    assert.equal(result.body.data.status, 'draft');
    assert.equal(result.body.data.reviewedBy, ids.teacher);
    assert.equal(result.body.data.reviewedGenerationVersion, 1);
    assert.equal(readback.status, 200);
    assert.equal(readback.body.data.reviewHistory.length, 1);
    assert.equal(readback.body.data.reviewHistory[0].status, 'approved');
    assert.deepEqual(readback.body.data.reviewHistory[0].reasons, []);
  });

  it('rejected 可保存六類 structured reasons，other 必須有 note', async () => {
    const asset = addReviewAsset();
    const invalidOtherAsset = addReviewAsset();
    const teacherToken = await loginAs(
      serverContext.baseUrl,
      'teacher@focusflow.local',
      'Teacher123!',
    );
    const reasons = [
      { code: 'contentIncorrect', note: '知識點錯誤' },
      { code: 'audioIssue', note: '有雜音' },
      { code: 'visualQuality', note: '畫面模糊' },
      { code: 'subtitleIssue', note: '字幕錯字' },
      { code: 'incomplete', note: '內容截斷' },
      { code: 'other', note: '需要補充片尾' },
    ];

    const rejected = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${asset._id}/review`,
      {
        method: 'POST',
        token: teacherToken,
        body: { status: 'rejected', expectedGenerationVersion: 1, reasons },
      },
    );
    const invalidOther = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${invalidOtherAsset._id}/review`,
      {
        method: 'POST',
        token: teacherToken,
        body: {
          status: 'rejected',
          expectedGenerationVersion: 1,
          reasons: [{ code: 'other', note: '   ' }],
        },
      },
    );

    assert.equal(rejected.status, 200);
    assert.deepEqual(rejected.body.data.reviewReasons, reasons);
    assert.deepEqual(rejected.body.data.reviewHistory[0].reasons, reasons);
    assert.equal(invalidOther.status, 400);
    assert.equal(invalidOther.body.error.code, 'VALIDATION_ERROR');
  });

  it('reject 缺理由、非法 code、超長 note 與缺 expected version 皆拒絕', async () => {
    const teacherToken = await loginAs(
      serverContext.baseUrl,
      'teacher@focusflow.local',
      'Teacher123!',
    );
    const bodies = [
      { status: 'rejected', expectedGenerationVersion: 1, reasons: [] },
      {
        status: 'rejected',
        expectedGenerationVersion: 1,
        reasons: [{ code: 'unknownReason' }],
      },
      {
        status: 'rejected',
        expectedGenerationVersion: 1,
        reasons: [{ code: 'audioIssue', note: 'x'.repeat(501) }],
      },
      { status: 'approved' },
    ];

    for (const body of bodies) {
      const asset = addReviewAsset();
      const result = await jsonRequest(
        serverContext.baseUrl,
        `/api/v1/shorts/${asset._id}/review`,
        { method: 'POST', token: teacherToken, body },
      );
      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('過期 generation 與已審版本分別回 stale 與 conflict', async () => {
    const staleAsset = addReviewAsset({ generationVersion: 2 });
    const reviewedAsset = addReviewAsset({
      reviewStatus: 'approved',
      reviewedGenerationVersion: 1,
    });
    const teacherToken = await loginAs(
      serverContext.baseUrl,
      'teacher@focusflow.local',
      'Teacher123!',
    );

    const stale = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${staleAsset._id}/review`,
      {
        method: 'POST',
        token: teacherToken,
        body: { status: 'approved', expectedGenerationVersion: 1 },
      },
    );
    const conflict = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${reviewedAsset._id}/review`,
      {
        method: 'POST',
        token: teacherToken,
        body: { status: 'approved', expectedGenerationVersion: 1 },
      },
    );

    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'SHORT_ASSET_REVIEW_STALE');
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'SHORT_ASSET_REVIEW_CONFLICT');
  });

  it('CAS 失敗時不覆寫另一位審核者並回 review conflict', async () => {
    const asset = addReviewAsset();
    const teacherToken = await loginAs(
      serverContext.baseUrl,
      'teacher@focusflow.local',
      'Teacher123!',
    );
    store.beforeShortAssetCompareAndSwap = async () => {
      store.beforeShortAssetCompareAndSwap = null;
      asset.reviewStatus = 'approved';
      asset.reviewedBy = ids.admin;
      asset.reviewedAt = '2026-09-07T01:00:00.000Z';
      asset.reviewedGenerationVersion = 1;
    };

    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/shorts/${asset._id}/review`,
      {
        method: 'POST',
        token: teacherToken,
        body: {
          status: 'rejected',
          expectedGenerationVersion: 1,
          reasons: [{ code: 'audioIssue', note: '有雜音' }],
        },
      },
    );

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'SHORT_ASSET_REVIEW_CONFLICT');
    assert.equal(asset.reviewedBy, ids.admin);
    assert.deepEqual(asset.reviewReasons, []);
  });
});
