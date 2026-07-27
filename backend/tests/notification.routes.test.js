const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const Notification = require('../src/models/notification.model');
const {
  env,
  ids,
  store,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
  createProcessingState,
} = require('./helpers/backendTestHarness');

function addNotification({
  recipientId = ids.student,
  source = 'system_maintenance',
  title = '系統通知',
  content = '系統維護內容',
  urgent = false,
  readAt = null,
  courseIds = [],
  videoId = null,
  createdAt = new Date().toISOString(),
} = {}) {
  const notification = {
    _id: newObjectId(),
    recipientId,
    source,
    title,
    content,
    urgent,
    readAt,
    createdBy: ids.admin,
    courseIds,
    videoId,
    createdAt,
    updatedAt: createdAt,
  };
  store.notifications.push(notification);
  return notification;
}

describe('notification routes', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(() => {
    resetStore();
  });

  it('Notification schema 定義列表、未讀與 dedupe 索引', () => {
    const indexes = Notification.schema.indexes();

    assert.equal(indexes.some(([fields]) => (
      fields.recipientId === 1
      && fields.createdAt === -1
      && fields._id === -1
    )), true);
    assert.equal(indexes.some(([fields]) => (
      fields.recipientId === 1
      && fields.readAt === 1
      && fields.createdAt === -1
      && fields._id === -1
    )), true);
    assert.equal(indexes.some(([fields, options]) => (
      fields.recipientId === 1
      && fields.dedupeKey === 1
      && options.unique === true
      && options.sparse === undefined
      && options.partialFilterExpression?.dedupeKey?.$type === 'string'
    )), true);
    assert.equal(Notification.schema.path('urgent').isRequired, true);
    assert.equal(Notification.schema.path('courseIds').isRequired, true);

    const systemNotification = new Notification({
      recipientId: ids.student,
      source: 'system_maintenance',
      title: 'Maintenance',
      content: 'Maintenance content',
      urgent: false,
      courseIds: [],
      dedupeKey: null,
    });
    assert.equal(systemNotification.dedupeKey, undefined);
  });

  it('未登入不可查詢通知', async () => {
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/notifications');

    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'UNAUTHORIZED');
  });

  it('通知列表依 cursor 分頁且只回目前使用者資料', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const newest = addNotification({
      createdAt: '2026-07-24T10:03:00.000Z',
      title: '最新通知',
    });
    addNotification({
      createdAt: '2026-07-24T10:02:00.000Z',
      title: '已讀通知',
      readAt: '2026-07-24T10:04:00.000Z',
    });
    const oldest = addNotification({
      createdAt: '2026-07-24T10:01:00.000Z',
      title: '較舊通知',
    });
    addNotification({
      recipientId: ids.teacher,
      createdAt: '2026-07-24T10:05:00.000Z',
      title: '教師通知',
    });

    const firstPage = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/notifications?limit=2',
      { token },
    );
    const secondPage = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/notifications?limit=2&cursor=${encodeURIComponent(firstPage.body.data.nextCursor)}`,
      { token },
    );

    assert.equal(firstPage.status, 200);
    assert.deepEqual(
      firstPage.body.data.notifications.map((item) => item.id),
      [newest._id, store.notifications[1]._id],
    );
    assert.equal(firstPage.body.data.unreadCount, 2);
    assert.ok(firstPage.body.data.nextCursor);
    assert.equal(secondPage.status, 200);
    assert.deepEqual(
      secondPage.body.data.notifications.map((item) => item.id),
      [oldest._id],
    );
    assert.equal(secondPage.body.data.nextCursor, null);
    assert.equal(
      [...firstPage.body.data.notifications, ...secondPage.body.data.notifications]
        .some((item) => item.title === '教師通知'),
      false,
    );
  });

  it('相同 createdAt 以 _id 作 cursor tie-breaker 且跨頁不重複', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const createdAt = '2026-07-24T10:03:00.000Z';
    const low = addNotification({ createdAt, title: 'Same time low' });
    const middle = addNotification({ createdAt, title: 'Same time middle' });
    const high = addNotification({ createdAt, title: 'Same time high' });
    low._id = '680000000000000000000001';
    middle._id = '680000000000000000000002';
    high._id = '680000000000000000000003';

    const firstPage = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/notifications?limit=2',
      { token },
    );
    const secondPage = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/notifications?limit=2&cursor=${encodeURIComponent(firstPage.body.data.nextCursor)}`,
      { token },
    );

    assert.deepEqual(
      firstPage.body.data.notifications.map((item) => item.id),
      [high._id, middle._id],
    );
    assert.deepEqual(
      secondPage.body.data.notifications.map((item) => item.id),
      [low._id],
    );
    assert.equal(new Set([
      ...firstPage.body.data.notifications.map((item) => item.id),
      ...secondPage.body.data.notifications.map((item) => item.id),
    ]).size, 3);
  });

  it('unreadOnly 只回未讀通知但 unreadCount 保留總未讀數', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    addNotification({ title: '未讀一' });
    addNotification({ title: '未讀二' });
    addNotification({
      title: '已讀',
      readAt: '2026-07-24T10:04:00.000Z',
    });

    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/notifications?unreadOnly=true',
      { token },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.data.notifications.length, 2);
    assert.equal(result.body.data.notifications.every((item) => item.read === false), true);
    assert.equal(result.body.data.unreadCount, 2);
  });

  it('非法 cursor 回傳 400', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/notifications?cursor=not-a-cursor',
      { token },
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  });

  it('通知 id 非 ObjectId 時回傳 INVALID_ID', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/notifications/not-an-id/read',
      {
        method: 'PATCH',
        token,
      },
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'INVALID_ID');
  });

  it('不可將其他使用者通知標為已讀', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const teacherNotification = addNotification({
      recipientId: ids.teacher,
    });
    const result = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/notifications/${teacherNotification._id}/read`,
      {
        method: 'PATCH',
        token,
      },
    );

    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'NOTIFICATION_NOT_FOUND');
    assert.equal(teacherNotification.readAt, null);
  });

  it('標記單筆已讀為 idempotent 並保留首次 readAt', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const notification = addNotification();

    const first = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/notifications/${notification._id}/read`,
      {
        method: 'PATCH',
        token,
      },
    );
    const second = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/notifications/${notification._id}/read`,
      {
        method: 'PATCH',
        token,
      },
    );

    assert.equal(first.status, 200);
    assert.equal(first.body.data.notification.read, true);
    assert.ok(first.body.data.notification.readAt);
    assert.equal(second.status, 200);
    assert.equal(second.body.data.notification.readAt, first.body.data.notification.readAt);
  });

  it('read-all 只標記目前使用者的未讀通知', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    addNotification();
    addNotification();
    const teacherNotification = addNotification({
      recipientId: ids.teacher,
    });

    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/notifications/read-all',
      {
        method: 'POST',
        token,
      },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.data.updatedCount, 2);
    assert.equal(
      store.notifications
        .filter((item) => item.recipientId === ids.student)
        .every((item) => Boolean(item.readAt)),
      true,
    );
    assert.equal(teacherNotification.readAt, null);
  });

  it('非 admin 不可發送系統通知', async () => {
    const token = await loginAs(
      serverContext.baseUrl,
      'student@focusflow.local',
      'Student123!',
    );
    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/admin/notifications',
      {
        method: 'POST',
        token,
        body: {
          title: '維護公告',
          content: '今晚維護',
        },
      },
    );

    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'FORBIDDEN');
  });

  const invalidBroadcastCases = [
    {
      label: '空白 title',
      body: { title: '   ', content: '內容' },
      message: 'Title is required.',
    },
    {
      label: '過長 title',
      body: { title: 'a'.repeat(121), content: '內容' },
      message: 'Title must be at most 120 characters.',
    },
    {
      label: '空白 content',
      body: { title: '標題', content: '   ' },
      message: 'Content is required.',
    },
    {
      label: '過長 content',
      body: { title: '標題', content: 'a'.repeat(2001) },
      message: 'Content must be at most 2000 characters.',
    },
    {
      label: '非 boolean urgent',
      body: { title: '標題', content: '內容', urgent: 'true' },
      message: 'urgent must be a boolean.',
    },
  ];

  for (const invalidCase of invalidBroadcastCases) {
    it(`管理員通知拒絕${invalidCase.label}`, async () => {
      const token = await loginAs(
        serverContext.baseUrl,
        'admin@focusflow.local',
        'Admin123!',
      );
      const result = await jsonRequest(
        serverContext.baseUrl,
        '/api/v1/admin/notifications',
        {
          method: 'POST',
          token,
          body: invalidCase.body,
        },
      );

      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
      assert.equal(result.body.message, invalidCase.message);
      assert.equal(store.notifications.length, 0);
    });
  }

  it('管理員系統通知只發送給 active students', async () => {
    const activeStudentId = newObjectId();
    const inactiveStudentId = newObjectId();
    const missingActiveStateStudentId = newObjectId();
    store.users.push(
      {
        _id: activeStudentId,
        name: 'Active Student Two',
        email: 'student2@focusflow.local',
        role: 'student',
        isActive: true,
      },
      {
        _id: inactiveStudentId,
        name: 'Inactive Student',
        email: 'inactive@focusflow.local',
        role: 'student',
        isActive: false,
      },
      {
        _id: missingActiveStateStudentId,
        name: 'Missing Active State Student',
        email: 'missing-active@focusflow.local',
        role: 'student',
      },
    );
    const token = await loginAs(
      serverContext.baseUrl,
      'admin@focusflow.local',
      'Admin123!',
    );

    const result = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/admin/notifications',
      {
        method: 'POST',
        token,
        body: {
          title: '  維護公告  ',
          content: '  今晚十點維護  ',
          urgent: true,
        },
      },
    );
    const secondResult = await jsonRequest(
      serverContext.baseUrl,
      '/api/v1/admin/notifications',
      {
        method: 'POST',
        token,
        body: {
          title: '第二則公告',
          content: '第二則公告內容',
          urgent: false,
        },
      },
    );

    assert.equal(result.status, 201);
    assert.equal(secondResult.status, 201);
    assert.equal(result.body.data.recipientCount, 2);
    assert.equal(secondResult.body.data.recipientCount, 2);
    assert.deepEqual(result.body.data.summary, {
      source: 'system_maintenance',
      title: '維護公告',
      content: '今晚十點維護',
      urgent: true,
    });
    assert.deepEqual(
      new Set(store.notifications.map((item) => String(item.recipientId))),
      new Set([ids.student, activeStudentId]),
    );
    assert.equal(store.notifications.length, 4);
    assert.equal(
      store.notifications.filter((item) => item.recipientId === ids.student).length,
      2,
    );
    assert.equal(store.notifications.every((item) => item.dedupeKey === undefined), true);
    assert.equal(store.notifications.every((item) => item.createdBy === ids.admin), true);
  });

  it('影片完成後通知主課程的 active enrolled students', async () => {
    const video = store.videos.find((item) => item._id === ids.publishedVideo);
    video.processing = createProcessingState({
      status: 'queued',
      queuedAt: '2026-07-24T11:00:00.000Z',
    });

    const start = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    assert.equal(start.status, 200);
    assert.equal(store.notifications.length, 0);

    const complete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(complete.status, 200);
    assert.equal(store.notifications.length, 1);
    assert.equal(store.notifications[0].recipientId, ids.student);
    assert.equal(store.notifications[0].source, 'video_completed');
    assert.equal(store.notifications[0].dedupeKey, `video_completed:${ids.publishedVideo}`);
    assert.deepEqual(store.notifications[0].courseIds, [ids.publishedCourse]);
  });

  it('掛載課程 fanout 依修課關係送出、同學生去重且重送 complete 不重複', async () => {
    const attachedStudentId = newObjectId();
    const nonEnrolledStudentId = newObjectId();
    const inactiveEnrolledStudentId = newObjectId();
    const missingActiveStateEnrolledStudentId = newObjectId();
    store.users.push(
      {
        _id: attachedStudentId,
        name: 'Attached Course Student',
        email: 'attached@focusflow.local',
        role: 'student',
        isActive: true,
      },
      {
        _id: nonEnrolledStudentId,
        name: 'Non-enrolled Student',
        email: 'non-enrolled@focusflow.local',
        role: 'student',
        isActive: true,
      },
      {
        _id: inactiveEnrolledStudentId,
        name: 'Inactive Enrolled Student',
        email: 'inactive-enrolled@focusflow.local',
        role: 'student',
        isActive: false,
      },
      {
        _id: missingActiveStateEnrolledStudentId,
        name: 'Missing Active State Enrolled Student',
        email: 'missing-active-enrolled@focusflow.local',
        role: 'student',
      },
    );
    store.courses.find((course) => course._id === ids.teacherCourse)
      .videoIds.push(ids.publishedVideo);
    store.enrollments.push(
      {
        _id: newObjectId(),
        studentId: ids.student,
        courseId: ids.teacherCourse,
      },
      {
        _id: newObjectId(),
        studentId: attachedStudentId,
        courseId: ids.teacherCourse,
      },
      {
        _id: newObjectId(),
        studentId: inactiveEnrolledStudentId,
        courseId: ids.teacherCourse,
      },
      {
        _id: newObjectId(),
        studentId: missingActiveStateEnrolledStudentId,
        courseId: ids.teacherCourse,
      },
    );
    const video = store.videos.find((item) => item._id === ids.publishedVideo);
    video.processing = createProcessingState({ status: 'queued' });

    await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    const firstComplete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    const replayComplete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(firstComplete.status, 200);
    assert.equal(replayComplete.status, 200);
    assert.equal(store.notifications.length, 2);
    assert.equal(
      store.notifications.filter((item) => item.recipientId === ids.student).length,
      1,
    );
    assert.deepEqual(
      store.notifications.find((item) => item.recipientId === ids.student).courseIds,
      [ids.publishedCourse, ids.teacherCourse].sort(),
    );
    assert.deepEqual(
      store.notifications.find((item) => item.recipientId === attachedStudentId).courseIds,
      [ids.teacherCourse],
    );
    assert.equal(
      store.notifications.some((item) => item.recipientId === nonEnrolledStudentId),
      false,
    );
    assert.equal(
      store.notifications.some((item) => item.recipientId === inactiveEnrolledStudentId),
      false,
    );
    assert.equal(
      store.notifications.some(
        (item) => item.recipientId === missingActiveStateEnrolledStudentId,
      ),
      false,
    );
  });

  it('queued、start 與 fail 狀態不發送完成通知', async () => {
    const video = store.videos.find((item) => item._id === ids.publishedVideo);
    video.processing = createProcessingState({ status: 'queued' });
    assert.equal(store.notifications.length, 0);

    const start = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    const fail = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/fail`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
        body: {
          errorMessage: 'worker failed',
        },
      },
    );

    assert.equal(start.status, 200);
    assert.equal(fail.status, 200);
    assert.equal(store.notifications.length, 0);
  });

  it('fanout 失敗後重送 completed webhook 可 repair 且不重複', async () => {
    const video = store.videos.find((item) => item._id === ids.publishedVideo);
    video.processing = createProcessingState({ status: 'queued' });

    await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    store.nextNotificationBulkWriteError = new Error('temporary notification write failure');

    const failedComplete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    assert.equal(failedComplete.status, 500);
    assert.equal(video.processing.status, 'completed');
    assert.equal(store.notifications.length, 0);

    const repairedComplete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    const replayComplete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(repairedComplete.status, 200);
    assert.equal(replayComplete.status, 200);
    assert.equal(store.notifications.length, 1);
    assert.equal(store.notifications[0].recipientId, ids.student);
  });

  it('並行 upsert 的 duplicate-only E11000 視為冪等成功且 replay 仍只有一筆', async () => {
    const video = store.videos.find((item) => item._id === ids.publishedVideo);
    video.processing = createProcessingState({ status: 'queued' });

    await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    const duplicateRaceError = Object.assign(
      new Error('concurrent notification upsert duplicate'),
      {
        code: 11000,
        writeErrors: [{ code: 11000 }],
        // The competing write wins before this simulated bulkWrite reports E11000.
        appliedOperationIndexes: [0],
      },
    );
    store.nextNotificationBulkWriteError = duplicateRaceError;

    const complete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    const replay = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(complete.status, 200);
    assert.equal(replay.status, 200);
    assert.equal(store.notifications.length, 1);
    assert.equal(
      store.notifications[0].dedupeKey,
      `video_completed:${ids.publishedVideo}`,
    );
  });

  it('E11000 同時帶 write concern error 時不可視為冪等成功', async () => {
    const video = store.videos.find((item) => item._id === ids.publishedVideo);
    video.processing = createProcessingState({ status: 'queued' });

    await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    store.nextNotificationBulkWriteError = Object.assign(
      new Error('duplicate with uncertain durability'),
      {
        code: 11000,
        writeErrors: [{ code: 11000 }],
        result: {
          getWriteConcernError: () => ({
            code: 64,
            message: 'write concern timed out',
          }),
        },
      },
    );

    const complete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(complete.status, 500);
    assert.equal(complete.body.error.code, 'NOTIFICATION_FANOUT_FAILED');
    assert.equal(video.processing.status, 'completed');
    assert.equal(store.notifications.length, 0);
  });

  it('混合 bulkWrite errors 不可誤判為 duplicate-only 成功', async () => {
    const video = store.videos.find((item) => item._id === ids.publishedVideo);
    video.processing = createProcessingState({ status: 'queued' });

    await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    store.nextNotificationBulkWriteError = Object.assign(
      new Error('mixed notification bulk write failure'),
      {
        code: 11000,
        writeErrors: [{ code: 11000 }, { code: 121 }],
      },
    );

    const complete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(complete.status, 500);
    assert.equal(complete.body.error.code, 'NOTIFICATION_FANOUT_FAILED');
    assert.equal(video.processing.status, 'completed');
    assert.equal(store.notifications.length, 0);
  });

  it('partial bulkWrite 成功後 replay 補齊缺少 recipients 且不重複', async () => {
    const secondStudentId = newObjectId();
    store.users.push({
      _id: secondStudentId,
      name: 'Second Active Student',
      email: 'second-active@focusflow.local',
      role: 'student',
      isActive: true,
    });
    store.enrollments.push({
      _id: newObjectId(),
      studentId: secondStudentId,
      courseId: ids.publishedCourse,
    });
    const video = store.videos.find((item) => item._id === ids.publishedVideo);
    video.processing = createProcessingState({ status: 'queued' });

    await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    store.nextNotificationBulkWriteError = Object.assign(
      new Error('partial notification bulk write failure'),
      { appliedOperationIndexes: [0] },
    );

    const failedComplete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    assert.equal(failedComplete.status, 500);
    assert.equal(video.processing.status, 'completed');
    assert.equal(store.notifications.length, 1);

    const repairedComplete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    const replayComplete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(repairedComplete.status, 200);
    assert.equal(replayComplete.status, 200);
    assert.equal(store.notifications.length, 2);
    assert.deepEqual(
      new Set(store.notifications.map((item) => item.recipientId)),
      new Set([ids.student, secondStudentId]),
    );
    assert.equal(
      store.notifications.every(
        (item) => item.dedupeKey === `video_completed:${ids.publishedVideo}`,
      ),
      true,
    );
  });

  it('FAQ clear 失敗仍嘗試 fanout，回 500 後 replay 可修復且不重複', async () => {
    const video = store.videos.find((item) => item._id === ids.publishedVideo);
    video.processing = createProcessingState({ status: 'queued' });

    await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/start`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );
    store.nextFaqDeleteManyError = new Error('temporary FAQ invalidation failure');

    const failedComplete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(failedComplete.status, 500);
    assert.equal(video.processing.status, 'completed');
    assert.equal(store.notifications.length, 1);

    const repairedComplete = await jsonRequest(
      serverContext.baseUrl,
      `/api/v1/internal/videos/${ids.publishedVideo}/processing/complete`,
      {
        method: 'POST',
        headers: {
          'x-processing-secret': env.processingWebhookSecret,
        },
      },
    );

    assert.equal(repairedComplete.status, 200);
    assert.equal(store.notifications.length, 1);
  });
});
