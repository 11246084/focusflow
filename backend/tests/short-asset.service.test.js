const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const Course = require('../src/models/course.model');
const ShortAsset = require('../src/models/shortAsset.model');
const courseService = require('../src/services/course.service');
const shortAssetService = require('../src/services/shortAsset.service');
const { ids, store, newObjectId, resetStore } = require('./helpers/backendTestHarness');

function addAsset({ status = 'published', courseId = ids.teacherCourse } = {}) {
  const asset = {
    _id: newObjectId(),
    courseId,
    sourceVideoId: ids.teacherVideo,
    jobId: null,
    title: 'Short asset',
    description: '',
    status,
    youtubeVideoId: `yt-${newObjectId()}`,
    youtubeUrl: 'https://www.youtube.com/watch?v=test',
    thumbnail: null,
    publishedAt: '2026-07-18T08:00:00.000Z',
    youtubeAvailability: 'playable',
    youtubePrivacyStatus: 'public',
    lastCheckedAt: '2026-07-18T08:00:00.000Z',
  };
  store.shortAssets.push(asset);
  return asset;
}

describe('ShortAsset model/service', () => {
  beforeEach(() => resetStore());

  it('定義 feed 複合索引與 youtubeVideoId sparse unique index', () => {
    const indexes = ShortAsset.schema.indexes();
    assert.equal(indexes.some(([fields]) => (
      fields.courseId === 1
      && fields.status === 1
      && fields.youtubeAvailability === 1
      && fields.publishedAt === -1
      && fields._id === -1
    )), true);
    assert.equal(indexes.some(([fields, options]) => (
      fields.youtubeVideoId === 1 && options.unique === true && options.sparse === true
    )), true);
  });

  it('定義與 lifecycle 分離的審核 snapshot、generation 與歷史欄位', () => {
    const paths = ShortAsset.schema.paths;

    assert.deepEqual(paths.reviewStatus.enumValues, ['pending', 'approved', 'rejected']);
    assert.equal(paths.reviewStatus.defaultValue, 'pending');
    assert.equal(paths.reviewedBy.options.ref, 'User');
    assert.equal(paths.reviewedAt.defaultValue, null);
    assert.equal(paths.generationVersion.defaultValue, 1);
    assert.equal(paths.reviewedGenerationVersion.defaultValue, null);
    assert.ok(paths.reviewReasons);
    assert.ok(paths.reviewHistory);
  });

  it('提供內部 create/update service、發布閘門且不接受任意 archive 欄位', async () => {
    const created = await shortAssetService.createShortAsset({
      courseId: ids.publishedCourse,
      sourceVideoId: ids.publishedVideo,
      jobId: 'clipjob-1',
      title: 'Created Short',
      description: 'Description',
      archivedAt: 'should-not-be-written',
    });
    await assert.rejects(
      () => shortAssetService.updateShortAsset(created._id, {
        status: 'published',
        youtubeVideoId: 'yt-created',
        youtubeUrl: 'https://www.youtube.com/watch?v=yt-created',
        publishedAt: '2026-07-18T08:00:00.000Z',
      }),
      (error) => error.statusCode === 409 && error.code === 'SHORT_ASSET_NOT_APPROVED',
    );

    await shortAssetService.reviewShortAsset({
      assetId: created._id,
      user: { id: ids.teacher, role: 'teacher' },
      status: 'approved',
      expectedGenerationVersion: 1,
    });
    const updated = await shortAssetService.updateShortAsset(created._id, {
      status: 'published',
      youtubeVideoId: 'yt-created',
      youtubeUrl: 'https://www.youtube.com/watch?v=yt-created',
      publishedAt: '2026-07-18T08:00:00.000Z',
      archiveReason: 'should-not-be-written',
    });

    assert.equal(created.archivedAt, undefined);
    assert.equal(updated.status, 'published');
    assert.equal(updated.youtubeVideoId, 'yt-created');
    assert.equal(updated.archiveReason, undefined);
  });

  it('重新生成遞增版本並失效 current review，但保留跨 generation 歷史', async () => {
    const asset = await shortAssetService.createShortAsset({
      courseId: ids.teacherCourse,
      sourceVideoId: ids.teacherVideo,
      title: 'Regeneration Short',
    });
    await shortAssetService.reviewShortAsset({
      assetId: asset._id,
      user: { id: ids.teacher, role: 'teacher' },
      status: 'rejected',
      expectedGenerationVersion: 1,
      reasons: [{ code: 'other', note: '需要重新產生畫面' }],
      now: new Date('2026-09-07T01:00:00.000Z'),
    });

    const regenerated = await shortAssetService.recordShortAssetRegeneration(asset._id, {
      jobId: 'generation-job-2',
      youtubeVideoId: null,
    });
    const readback = await shortAssetService.getReviewShortAsset({
      assetId: asset._id,
      user: { id: ids.teacher, role: 'teacher' },
    });

    assert.equal(regenerated.generationVersion, 2);
    assert.equal(regenerated.reviewStatus, 'pending');
    assert.equal(regenerated.reviewedBy, null);
    assert.equal(regenerated.reviewedAt, null);
    assert.equal(regenerated.reviewedGenerationVersion, null);
    assert.deepEqual(regenerated.reviewReasons, []);
    assert.equal(regenerated.status, 'draft');
    assert.equal(regenerated.publishedAt, null);
    assert.equal(regenerated.youtubeVideoId, undefined);
    assert.equal(regenerated.reviewHistory.length, 1);
    assert.deepEqual(regenerated.reviewHistory[0].reasons, [
      { code: 'other', note: '需要重新產生畫面' },
    ]);
    assert.equal(readback.generationVersion, 2);
    assert.equal(readback.reviewStatus, 'pending');
    assert.deepEqual(readback.reviewHistory[0].reasons, [
      { code: 'other', note: '需要重新產生畫面' },
    ]);

    const approvedAsset = await shortAssetService.createShortAsset({
      courseId: ids.teacherCourse,
      sourceVideoId: ids.teacherVideo,
      title: 'Approved regeneration Short',
    });
    await shortAssetService.reviewShortAsset({
      assetId: approvedAsset._id,
      user: { id: ids.teacher, role: 'teacher' },
      status: 'approved',
      expectedGenerationVersion: 1,
    });

    const regeneratedApproved = await shortAssetService.recordShortAssetRegeneration(
      approvedAsset._id,
      { jobId: 'approved-generation-job-2' },
    );

    assert.equal(regeneratedApproved.generationVersion, 2);
    assert.equal(regeneratedApproved.reviewStatus, 'pending');
    assert.equal(regeneratedApproved.reviewedGenerationVersion, null);
    assert.deepEqual(regeneratedApproved.reviewReasons, []);
    assert.equal(regeneratedApproved.reviewHistory.length, 1);
    assert.equal(regeneratedApproved.reviewHistory[0].status, 'approved');
  });

  it('published+playable metadata 必須有非空 youtubeVideoId 與有效 publishedAt', () => {
    assert.throws(
      () => shortAssetService.assertPublishedPlayableMetadata({
        status: 'published',
        youtubeAvailability: 'playable',
        publishedAt: '2026-07-18T08:00:00.000Z',
      }),
      (error) => error.statusCode === 400 && error.code === 'VALIDATION_ERROR',
    );
    assert.throws(
      () => shortAssetService.assertPublishedPlayableMetadata({
        status: 'published',
        youtubeAvailability: 'playable',
        youtubeVideoId: 'valid-video-id',
        publishedAt: 'not-a-date',
      }),
      (error) => error.statusCode === 400 && error.code === 'VALIDATION_ERROR',
    );
  });

  it('update 進入 published+playable 前驗證現有與新欄位的合併狀態', async () => {
    const asset = addAsset({ status: 'published' });
    asset.youtubeAvailability = 'pending';
    delete asset.youtubeVideoId;

    await assert.rejects(
      () => shortAssetService.updateShortAsset(asset._id, { youtubeAvailability: 'playable' }),
      (error) => error.statusCode === 400 && error.code === 'VALIDATION_ERROR',
    );
    assert.equal(asset.youtubeAvailability, 'pending');
  });

  it('非字串 cursor 不會被當成首頁', () => {
    assert.throws(
      () => shortAssetService.decodePageToken(['cursor-one', 'cursor-two']),
      (error) => error.statusCode === 400 && error.code === 'INVALID_PAGE_TOKEN',
    );
    assert.throws(
      () => shortAssetService.decodePageToken({ id: 'cursor' }),
      (error) => error.statusCode === 400 && error.code === 'INVALID_PAGE_TOKEN',
    );
  });

  it('Course hard delete 前批次封存 ShortAsset，已封存資料不覆寫', async () => {
    const publishedAsset = addAsset({ status: 'published' });
    const alreadyArchived = addAsset({ status: 'archived' });
    alreadyArchived.statusBeforeArchive = 'ready';
    alreadyArchived.archiveReason = 'manual';
    alreadyArchived.archivedAt = '2026-07-17T00:00:00.000Z';

    await courseService.deleteCourse(ids.teacherCourse, { id: ids.teacher, role: 'teacher' });

    assert.equal(store.courses.some((course) => course._id === ids.teacherCourse), false);
    assert.equal(store.shortAssets.length, 2);
    assert.equal(publishedAsset.status, 'archived');
    assert.equal(publishedAsset.archivedBy, null);
    assert.equal(publishedAsset.archiveReason, 'course_deleted');
    assert.equal(publishedAsset.statusBeforeArchive, 'published');
    assert.deepEqual(Object.keys(publishedAsset.courseSnapshot).sort(), ['courseId', 'status', 'teacherId', 'title']);
    assert.deepEqual(publishedAsset.courseSnapshot, {
      courseId: ids.teacherCourse,
      title: 'Teacher Draft Course',
      teacherId: ids.teacher,
      status: 'draft',
    });
    assert.equal(alreadyArchived.statusBeforeArchive, 'ready');
    assert.equal(alreadyArchived.archiveReason, 'manual');
    assert.equal(alreadyArchived.archivedAt, '2026-07-17T00:00:00.000Z');
  });

  it('封存操作可重複執行且不覆寫 statusBeforeArchive', async () => {
    const asset = addAsset({ status: 'ready' });
    const course = store.courses.find((item) => item._id === ids.teacherCourse);
    await shortAssetService.archiveForCourseDeletion(course, {
      now: new Date('2026-07-18T09:00:00.000Z'),
    });
    await shortAssetService.archiveForCourseDeletion(course, {
      now: new Date('2026-07-18T10:00:00.000Z'),
    });

    assert.equal(asset.status, 'archived');
    assert.equal(asset.statusBeforeArchive, 'ready');
    assert.equal(new Date(asset.archivedAt).toISOString(), '2026-07-18T09:00:00.000Z');
  });

  it('Course.deleteOne 失敗時 best-effort 還原本次封存', async () => {
    const asset = addAsset({ status: 'published' });
    const originalDeleteOne = Course.deleteOne;
    Course.deleteOne = async () => {
      throw new Error('simulated course delete failure');
    };

    try {
      await assert.rejects(
        () => courseService.deleteCourse(ids.teacherCourse, { id: ids.teacher, role: 'teacher' }),
        /simulated course delete failure/,
      );
      assert.equal(asset.status, 'published');
      assert.equal(asset.archivedAt, undefined);
      assert.equal(asset.archivedBy, undefined);
      assert.equal(asset.archiveReason, undefined);
      assert.equal(asset.statusBeforeArchive, undefined);
      assert.equal(asset.courseSnapshot, undefined);
    } finally {
      Course.deleteOne = originalDeleteOne;
    }
  });
});
