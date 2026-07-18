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

  it('提供內部 create/update service 且不接受任意 archive 欄位', async () => {
    const created = await shortAssetService.createShortAsset({
      courseId: ids.publishedCourse,
      sourceVideoId: ids.publishedVideo,
      jobId: 'clipjob-1',
      title: 'Created Short',
      description: 'Description',
      archivedAt: 'should-not-be-written',
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

  it('published+playable create 必須有非空 youtubeVideoId 與有效 publishedAt', async () => {
    await assert.rejects(
      () => shortAssetService.createShortAsset({
        courseId: ids.publishedCourse,
        title: 'Missing YouTube id',
        status: 'published',
        youtubeAvailability: 'playable',
        publishedAt: '2026-07-18T08:00:00.000Z',
      }),
      (error) => error.statusCode === 400 && error.code === 'VALIDATION_ERROR',
    );
    await assert.rejects(
      () => shortAssetService.createShortAsset({
        courseId: ids.publishedCourse,
        title: 'Invalid publish date',
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
