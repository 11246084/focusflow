const path = require('path');
const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const Course = require('../models/course.model');
const Video = require('../models/video.model');
const Enrollment = require('../models/enrollment.model');
const VideoSegment = require('../models/videoSegment.model');
const Clip = require('../models/clip.model');
const UsageLog = require('../models/usageLog.model');
const LineBindToken = require('../models/lineBindToken.model');
const env = require('../config/env');
const {
  USER_ROLES,
  COURSE_STATUSES,
  VIDEO_SOURCE_TYPES,
  VIDEO_PROCESSING_STATUSES,
} = require('../constants/enums');
const { buildMockEmbedding, embedQuery } = require('./queryEmbedding.service');
const { COURSE_BRIDGE_MODES } = require('./bridgeScope.service');

const DEMO_RECORD_IDS = {
  courses: {
    published: '680000000000000000000101',
    draft: '680000000000000000000102',
    pipelineBridge: '680000000000000000000103',
  },
  videos: {
    published: '680000000000000000000201',
    draft: '680000000000000000000202',
    pipelineBridge: '680000000000000000000203',
  },
};

const DEMO_USERS = [
  {
    name: 'Demo Teacher',
    email: 'teacher@focusflow.local',
    password: 'Teacher123!',
    role: USER_ROLES.TEACHER,
    lineUserId: 'demo-line-teacher-001',
  },
  {
    name: 'Demo Student',
    email: 'student@focusflow.local',
    password: 'Student123!',
    role: USER_ROLES.STUDENT,
    lineUserId: 'demo-line-student-001',
  },
  {
    name: 'Demo Admin',
    email: 'admin@focusflow.local',
    password: 'Admin123!',
    role: USER_ROLES.ADMIN,
    lineUserId: 'demo-line-admin-001',
  },
];

const DEMO_COURSES = {
  published: {
    title: 'FocusFlow Demo QA Course',
    description: 'Published demo course for login, course listing, and QA walkthroughs.',
    status: COURSE_STATUSES.PUBLISHED,
  },
  draft: {
    title: 'FocusFlow Demo Processing Course',
    description: 'Draft demo course for teacher-only access and processing status demos.',
    status: COURSE_STATUSES.DRAFT,
  },
  pipelineBridge: {
    title: 'FocusFlow Pipeline Bridge Course',
    description: 'Published bridge course that reuses existing pipeline videos via course.videoIds for QA-only segment scoping.',
    status: COURSE_STATUSES.PUBLISHED,
  },
};

const DEMO_VIDEOS = {
  published: {
    videoId: 'focusflow-demo-video-published',
    title: 'FocusFlow MVP Walkthrough',
    filename: 'focusflow-demo-published.mp4',
    durationSec: 312,
    processing: {
      status: VIDEO_PROCESSING_STATUSES.COMPLETED,
      queuedAt: '2026-04-06T09:00:00.000Z',
      startedAt: '2026-04-06T09:01:00.000Z',
      completedAt: '2026-04-06T09:05:00.000Z',
      failedAt: null,
      errorMessage: null,
      errorCode: null,
      attemptCount: 1,
    },
  },
  draft: {
    videoId: 'focusflow-demo-video-processing',
    title: 'FocusFlow Processing Demo',
    filename: 'focusflow-demo-processing.mp4',
    durationSec: null,
    processing: {
      status: VIDEO_PROCESSING_STATUSES.FAILED,
      queuedAt: '2026-04-06T10:00:00.000Z',
      startedAt: '2026-04-06T10:02:00.000Z',
      completedAt: null,
      failedAt: '2026-04-06T10:07:00.000Z',
      errorMessage: 'Demo worker timeout',
      errorCode: 'DEMO_TIMEOUT',
      attemptCount: 1,
    },
  },
  pipelineBridge: {
    videoId: 'focusflow-demo-video-pipeline-bridge',
    title: 'FocusFlow Pipeline-Style Bridge Demo Video',
    filename: 'focusflow-demo-pipeline-bridge.mp4',
    durationSec: 540,
  },
};

const DEMO_SEGMENTS = [
  {
    segmentId: 'focusflow-demo-segment-qa',
    startSec: 18,
    endSec: 42,
    transcript: 'FocusFlow 問答 API 會回傳文字答案 對應影片片段資訊 與可用的時間戳 方便 demo 展示。',
  },
  {
    segmentId: 'focusflow-demo-segment-processing',
    startSec: 62,
    endSec: 98,
    transcript: '影片處理流程包含 queued processing completed failed 四種狀態 失敗後 teacher 或 admin 可以 retry。',
  },
  {
    segmentId: 'focusflow-demo-segment-access',
    startSec: 118,
    endSec: 150,
    transcript: '學生只能存取已發布課程或已選課課程 teacher 與 admin 可以管理課程與影片。',
  },
];

const DEMO_CLIP = {
  segmentId: DEMO_SEGMENTS[0].segmentId,
  clipUrl: 'https://focusflow.local/demo-clips/qa-overview.mp4',
  jumpUrl: 'https://focusflow.local/demo-watch/focusflow-demo-video-published?t=18',
  keyPoints: ['QA API', 'video snippet', 'timestamp'],
};

const DEMO_USER_EMAILS = DEMO_USERS.map((user) => user.email);
const DEMO_COURSE_TITLES = Object.values(DEMO_COURSES).map((course) => course.title);
const DEMO_VIDEO_IDS = Object.values(DEMO_VIDEOS).map((video) => video.videoId);
const DEMO_SEGMENT_IDS = DEMO_SEGMENTS.map((segment) => segment.segmentId);

async function seedDemoUsers({ silent = false } = {}) {
  for (const demoUser of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(demoUser.password, 10);

    await User.findOneAndUpdate(
      { email: demoUser.email },
      {
        $set: {
          name: demoUser.name,
          email: demoUser.email,
          passwordHash,
          role: demoUser.role,
          isActive: true,
          lineUserId: demoUser.lineUserId,
          lineBindAt: null,
          activeCourseId: null,
          lineConversationState: 'idle',
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  }

  if (!silent) {
    console.log('Demo users seeded.');
  }

  return DEMO_USERS.map(({ passwordHash, ...user }) => user);
}

function buildDemoResetSelectors(existingTargets) {
  const courseIds = existingTargets.courses.map((course) => String(course._id));
  const userIds = existingTargets.users.map((user) => String(user._id));

  return {
    courseIds,
    userIds,
    lineBindTokenQuery: userIds.length
      ? { userId: { $in: userIds } }
      : null,
    usageLogQuery: [
      userIds.length ? { userId: { $in: userIds } } : null,
      courseIds.length ? { courseId: { $in: courseIds } } : null,
    ].filter(Boolean),
  };
}

async function collectExistingDemoTargets() {
  const users = (await Promise.all(DEMO_USER_EMAILS.map((email) => User.findOne({ email }))))
    .filter(Boolean);
  const [courses, videos] = await Promise.all([
    Course.find({ title: { $in: DEMO_COURSE_TITLES } }),
    Video.find({ videoId: { $in: DEMO_VIDEO_IDS } }),
  ]);

  return {
    users,
    courses,
    videos,
  };
}

async function resetDemoData({ silent = false } = {}) {
  const existingTargets = await collectExistingDemoTargets();
  const selectors = buildDemoResetSelectors(existingTargets);

  if (selectors.lineBindTokenQuery) {
    await LineBindToken.deleteMany(selectors.lineBindTokenQuery);
  }

  if (selectors.usageLogQuery.length) {
    await UsageLog.deleteMany({ $or: selectors.usageLogQuery });
  }

  if (selectors.courseIds.length) {
    await Enrollment.deleteMany({ courseId: { $in: selectors.courseIds } });
  }

  await Clip.deleteMany({ segmentId: { $in: [DEMO_CLIP.segmentId] } });
  await VideoSegment.deleteMany({ segmentId: { $in: DEMO_SEGMENT_IDS } });
  await Video.deleteMany({
    $or: [
      { _id: { $in: Object.values(DEMO_RECORD_IDS.videos) } },
      { videoId: { $in: DEMO_VIDEO_IDS } },
    ],
  });
  await Course.deleteMany({
    $or: [
      { _id: { $in: Object.values(DEMO_RECORD_IDS.courses) } },
      { title: { $in: DEMO_COURSE_TITLES } },
    ],
  });

  if (!silent) {
    console.log('Demo-owned baseline data reset.');
  }
}

function buildDemoVideoPayload({ courseId, uploadedBy, definition }) {
  const sourceUrl = `/uploads/${definition.filename}`;
  const storagePath = path.join(env.uploadDir, definition.filename);

  return {
    courseId,
    title: definition.title,
    sourceType: VIDEO_SOURCE_TYPES.UPLOAD,
    sourceUrl,
    videoId: definition.videoId,
    fileName: definition.filename,
    filePath: storagePath,
    storagePath,
    durationSec: definition.durationSec,
    videoSource: VIDEO_SOURCE_TYPES.UPLOAD,
    videoUrl: sourceUrl,
    uploadedBy,
    processing: definition.processing,
  };
}

function buildPipelineStyleBridgeVideoPayload(definition) {
  return {
    title: definition.title,
    videoId: definition.videoId,
    fileName: definition.filename,
    durationSec: definition.durationSec,
  };
}

async function seedDemoData({ silent = false, reset = false } = {}) {
  if (reset) {
    await resetDemoData({ silent: true });
  }

  const users = await seedDemoUsers({ silent: true });

  const teacher = await User.findOne({ email: 'teacher@focusflow.local' });
  const student = await User.findOne({ email: 'student@focusflow.local' });

  const publishedCourse = await Course.findOneAndUpdate(
    { title: DEMO_COURSES.published.title, teacherId: teacher._id },
    {
      $set: {
        title: DEMO_COURSES.published.title,
        description: DEMO_COURSES.published.description,
        teacherId: teacher._id,
        status: DEMO_COURSES.published.status,
      },
      $setOnInsert: {
        _id: DEMO_RECORD_IDS.courses.published,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  const draftCourse = await Course.findOneAndUpdate(
    { title: DEMO_COURSES.draft.title, teacherId: teacher._id },
    {
      $set: {
        title: DEMO_COURSES.draft.title,
        description: DEMO_COURSES.draft.description,
        teacherId: teacher._id,
        status: DEMO_COURSES.draft.status,
      },
      $setOnInsert: {
        _id: DEMO_RECORD_IDS.courses.draft,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  const publishedVideo = await Video.findOneAndUpdate(
    { videoId: DEMO_VIDEOS.published.videoId },
    {
      $set: buildDemoVideoPayload({
        courseId: publishedCourse._id,
        uploadedBy: teacher._id,
        definition: DEMO_VIDEOS.published,
      }),
      $setOnInsert: {
        _id: DEMO_RECORD_IDS.videos.published,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  const draftVideo = await Video.findOneAndUpdate(
    { videoId: DEMO_VIDEOS.draft.videoId },
    {
      $set: buildDemoVideoPayload({
        courseId: draftCourse._id,
        uploadedBy: teacher._id,
        definition: DEMO_VIDEOS.draft,
      }),
      $setOnInsert: {
        _id: DEMO_RECORD_IDS.videos.draft,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  await Course.findByIdAndUpdate(publishedCourse._id, {
    $set: {
      videoIds: [publishedVideo._id],
    },
  });

  await Course.findByIdAndUpdate(draftCourse._id, {
    $set: {
      videoIds: [draftVideo._id],
    },
  });

  const pipelineBridgeCourse = await Course.findOneAndUpdate(
    { title: DEMO_COURSES.pipelineBridge.title, teacherId: teacher._id },
    {
      $set: {
        title: DEMO_COURSES.pipelineBridge.title,
        description: `${DEMO_COURSES.pipelineBridge.description} This is a pipeline-style demo baseline for reproducible MVP demos, not a fully synchronized live pipeline contract.`,
        teacherId: teacher._id,
        status: DEMO_COURSES.pipelineBridge.status,
      },
      $setOnInsert: {
        _id: DEMO_RECORD_IDS.courses.pipelineBridge,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  const pipelineBridgeVideo = await Video.findOneAndUpdate(
    { videoId: DEMO_VIDEOS.pipelineBridge.videoId },
    {
      $set: buildPipelineStyleBridgeVideoPayload(DEMO_VIDEOS.pipelineBridge),
      $setOnInsert: {
        _id: DEMO_RECORD_IDS.videos.pipelineBridge,
      },
      $unset: {
        courseId: 1,
        uploadedBy: 1,
        processing: 1,
        sourceType: 1,
        sourceUrl: 1,
        filePath: 1,
        storagePath: 1,
        videoSource: 1,
        videoUrl: 1,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  await Course.findByIdAndUpdate(pipelineBridgeCourse._id, {
    $set: {
      videoIds: [pipelineBridgeVideo._id],
    },
  });

  for (const [index, segment] of DEMO_SEGMENTS.entries()) {
    let embedding;
    try {
      embedding = env.qaQueryEmbeddingProvider !== 'mock'
        ? await embedQuery(segment.transcript)
        : buildMockEmbedding(`${segment.transcript} ${index}`);
    } catch {
      embedding = buildMockEmbedding(`${segment.transcript} ${index}`);
    }

    await VideoSegment.findOneAndUpdate(
      { segmentId: segment.segmentId },
      {
        $set: {
          courseId: publishedCourse._id,
          segmentId: segment.segmentId,
          chunkId: segment.segmentId,
          videoId: String(publishedVideo._id),
          startSec: segment.startSec,
          endSec: segment.endSec,
          text: segment.transcript,
          corrections: [],
          embedding,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  }

  await Clip.findOneAndUpdate(
    { segmentId: DEMO_CLIP.segmentId },
    {
      $set: {
        segmentId: DEMO_CLIP.segmentId,
        courseId: publishedCourse._id,
        clipUrl: DEMO_CLIP.clipUrl,
        jumpUrl: DEMO_CLIP.jumpUrl,
        keyPoints: DEMO_CLIP.keyPoints,
      },
      $setOnInsert: {
        hitCount: 0,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  await Enrollment.findOneAndUpdate(
    { studentId: student._id, courseId: publishedCourse._id },
    {
      $set: {
        studentId: student._id,
        courseId: publishedCourse._id,
        progress: 15,
        lineNotify: false,
      },
      $setOnInsert: {
        enrolledAt: new Date('2026-04-06T09:30:00.000Z'),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  await Enrollment.findOneAndUpdate(
    { studentId: student._id, courseId: pipelineBridgeCourse._id },
    {
      $set: {
        studentId: student._id,
        courseId: pipelineBridgeCourse._id,
        progress: 0,
        lineNotify: false,
      },
      $setOnInsert: {
        enrolledAt: new Date('2026-04-13T08:00:00.000Z'),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  await User.findOneAndUpdate(
    { email: 'student@focusflow.local' },
    {
      $set: {
        activeCourseId: publishedCourse._id,
        lineUserId: DEMO_USERS[1].lineUserId,
        lineBindAt: new Date('2026-04-06T09:31:00.000Z'),
        lineConversationState: 'idle',
      },
    },
    {
      new: true,
    },
  );

  const summary = {
    resetApplied: reset,
    users,
    courses: [
      {
        key: 'publishedCourse',
        id: String(publishedCourse._id),
        title: publishedCourse.title,
        status: publishedCourse.status,
      },
      {
        key: 'draftCourse',
        id: String(draftCourse._id),
        title: draftCourse.title,
        status: draftCourse.status,
      },
      {
        key: 'pipelineBridgeCourse',
        id: String(pipelineBridgeCourse._id),
        title: pipelineBridgeCourse.title,
        status: pipelineBridgeCourse.status,
      },
    ],
    videos: [
      {
        key: 'publishedVideo',
        id: String(publishedVideo._id),
        videoId: publishedVideo.videoId,
        title: publishedVideo.title,
        processingStatus: publishedVideo.processing.status,
      },
      {
        key: 'draftVideo',
        id: String(draftVideo._id),
        videoId: draftVideo.videoId,
        title: draftVideo.title,
        processingStatus: draftVideo.processing.status,
      },
      {
        key: 'pipelineBridgeVideo',
        id: String(pipelineBridgeVideo._id),
        videoId: pipelineBridgeVideo.videoId,
        title: pipelineBridgeVideo.title,
        processingStatus: null,
      },
    ],
    segments: DEMO_SEGMENTS.map((segment) => segment.segmentId),
    pipelineBridge: {
      mode: COURSE_BRIDGE_MODES.QA_SCOPE_ONLY,
      baseline: 'pipeline_style_demo_baseline',
      fullySynchronizedWithLivePipeline: false,
      courseId: String(pipelineBridgeCourse._id),
      title: pipelineBridgeCourse.title,
      videoIds: [String(pipelineBridgeVideo._id)],
      externalVideoIds: [DEMO_VIDEOS.pipelineBridge.videoId],
    },
  };

  if (!silent) {
    console.log('Demo data seeded.');
    console.log(JSON.stringify(summary, null, 2));
  }

  return summary;
}

module.exports = {
  DEMO_USERS,
  DEMO_COURSES,
  DEMO_VIDEOS,
  DEMO_SEGMENTS,
  DEMO_CLIP,
  resetDemoData,
  seedDemoUsers,
  seedDemoData,
};
