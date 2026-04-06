const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.QA_QUERY_EMBEDDING_PROVIDER = 'mock';
process.env.QA_VECTOR_SEARCH_MODE = 'memory';
process.env.QA_ANSWER_PROVIDER = 'template';
process.env.LINE_CHANNEL_SECRET = 'line-secret-for-tests';
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';

const app = require('../src/app');
const env = require('../src/config/env');
const User = require('../src/models/user.model');
const Course = require('../src/models/course.model');
const Video = require('../src/models/video.model');
const Enrollment = require('../src/models/enrollment.model');
const VideoSegment = require('../src/models/videoSegment.model');
const Clip = require('../src/models/clip.model');
const UsageLog = require('../src/models/usageLog.model');
const LineBindToken = require('../src/models/lineBindToken.model');
const { buildSuccessResponse, buildErrorResponse } = require('../src/utils/apiResponse');

const uploadsDir = env.uploadDir;
const store = {
  users: [],
  courses: [],
  videos: [],
  enrollments: [],
  videoSegments: [],
  clips: [],
  usageLogs: [],
  lineBindTokens: [],
};

const ids = {
  teacher: '507f1f77bcf86cd799439011',
  student: '507f1f77bcf86cd799439012',
  admin: '507f1f77bcf86cd799439013',
  teacherCourse: '507f191e810c19729de860ea',
  publishedCourse: '507f191e810c19729de860eb',
  teacherVideo: '507f191e810c19729de860ec',
  publishedVideo: '507f191e810c19729de860ed',
  segmentOne: 'segment-one',
};

function normalizeValue(value) {
  if (value == null) {
    return value;
  }

  if (typeof value === 'object' && value._id) {
    return String(value._id);
  }

  return String(value);
}

function setNested(target, key, value) {
  const parts = key.split('.');
  let cursor = target;

  while (parts.length > 1) {
    const part = parts.shift();
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  }

  cursor[parts[0]] = value;
}

function applyUpdate(target, update, { isInsert = false } = {}) {
  if (!update) {
    return target;
  }

  const plainEntries = Object.entries(update).filter(([key]) => !key.startsWith('$'));
  for (const [key, value] of plainEntries) {
    setNested(target, key, value);
  }

  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set)) {
      setNested(target, key, value);
    }
  }

  if (isInsert && update.$setOnInsert) {
    for (const [key, value] of Object.entries(update.$setOnInsert)) {
      setNested(target, key, value);
    }
  }

  if (update.$inc) {
    for (const [key, value] of Object.entries(update.$inc)) {
      target[key] = (target[key] || 0) + value;
    }
  }

  return target;
}

function matchesQuery(document, query = {}) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') {
      return value.some((candidate) => matchesQuery(document, candidate));
    }

    if (value && typeof value === 'object' && '$in' in value) {
      return value.$in.map(normalizeValue).includes(normalizeValue(document[key]));
    }

    return normalizeValue(document[key]) === normalizeValue(value);
  });
}

function sortItems(items, sortSpec = {}) {
  const entries = Object.entries(sortSpec);

  if (!entries.length) {
    return [...items];
  }

  const [[field, direction]] = entries;
  return [...items].sort((left, right) => {
    const leftValue = left[field];
    const rightValue = right[field];

    if (leftValue === rightValue) {
      return 0;
    }

    if (direction < 0) {
      return leftValue > rightValue ? -1 : 1;
    }

    return leftValue > rightValue ? 1 : -1;
  });
}

function createQuery(initialValue, options = {}) {
  const state = {
    value: initialValue,
  };

  return {
    populate(pathName) {
      if (options.populateMap && typeof options.populateMap[pathName] === 'function') {
        state.value = options.populateMap[pathName](state.value);
      }
      return this;
    },
    sort(sortSpec) {
      if (Array.isArray(state.value) && Object.keys(sortSpec || {}).length) {
        state.value = sortItems(state.value, sortSpec);
      }
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(state.value).then(resolve, reject);
    },
    catch(reject) {
      return Promise.resolve(state.value).catch(reject);
    },
  };
}

function installModelStubs() {
  User.findOne = async (query) => store.users.find((item) => matchesQuery(item, query)) || null;
  User.findById = async (id) => store.users.find((item) => normalizeValue(item._id) === normalizeValue(id)) || null;
  User.findOneAndUpdate = async (query, update, options = {}) => {
    let user = store.users.find((item) => matchesQuery(item, query));

    if (!user && options.upsert) {
      user = { _id: new mongoose.Types.ObjectId().toString() };
      applyUpdate(user, query, { isInsert: true });
      applyUpdate(user, update, { isInsert: true });
      store.users.push(user);
      return user;
    }

    if (!user) {
      return null;
    }

    applyUpdate(user, update);
    return options.new ? user : user;
  };
  User.findByIdAndUpdate = async (id, update, options = {}) => {
    const user = store.users.find((item) => normalizeValue(item._id) === normalizeValue(id));
    if (!user) {
      return null;
    }

    applyUpdate(user, update);
    return options.new ? user : user;
  };

  Course.create = async (payload) => {
    const course = {
      _id: payload._id || new mongoose.Types.ObjectId().toString(),
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...payload,
    };
    store.courses.push(course);
    return course;
  };
  Course.find = (query = {}) => createQuery(store.courses.filter((item) => matchesQuery(item, query)));
  Course.findById = (id) => createQuery(
    store.courses.find((item) => normalizeValue(item._id) === normalizeValue(id)) || null,
  );

  Video.create = async (payload) => {
    const video = {
      _id: payload._id || new mongoose.Types.ObjectId().toString(),
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...payload,
    };
    store.videos.push(video);
    return video;
  };
  Video.find = (query = {}) => createQuery(store.videos.filter((item) => matchesQuery(item, query)));
  Video.findById = (id) => createQuery(
    store.videos.find((item) => normalizeValue(item._id) === normalizeValue(id)) || null,
  );
  Video.findByIdAndUpdate = async (id, update, options = {}) => {
    const video = store.videos.find((item) => normalizeValue(item._id) === normalizeValue(id));
    if (!video) {
      return null;
    }

    applyUpdate(video, update);
    video.updatedAt = new Date().toISOString();
    return options.new ? video : video;
  };

  Enrollment.find = (query = {}) => createQuery(
    store.enrollments.filter((item) => matchesQuery(item, query)),
    {
      populateMap: {
        courseId(value) {
          return value.map((item) => ({
            ...item,
            courseId: store.courses.find((course) => normalizeValue(course._id) === normalizeValue(item.courseId)) || null,
          }));
        },
      },
    },
  );
  Enrollment.findOne = async (query = {}) => store.enrollments.find((item) => matchesQuery(item, query)) || null;
  Enrollment.findOneAndUpdate = async (query, update, options = {}) => {
    let enrollment = store.enrollments.find((item) => matchesQuery(item, query));

    if (!enrollment && options.upsert) {
      enrollment = { _id: new mongoose.Types.ObjectId().toString() };
      applyUpdate(enrollment, query, { isInsert: true });
      applyUpdate(enrollment, update, { isInsert: true });
      store.enrollments.push(enrollment);
      return enrollment;
    }

    if (!enrollment) {
      return null;
    }

    applyUpdate(enrollment, update);
    return options.new ? enrollment : enrollment;
  };

  VideoSegment.find = async (query = {}) => store.videoSegments.filter((item) => matchesQuery(item, query));
  VideoSegment.aggregate = async () => [];

  Clip.findOneAndUpdate = async (query, update, options = {}) => {
    const clip = store.clips.find((item) => matchesQuery(item, query));
    if (!clip) {
      return null;
    }

    applyUpdate(clip, update);
    return options.new ? clip : clip;
  };

  UsageLog.create = async (payload) => {
    store.usageLogs.push({
      _id: new mongoose.Types.ObjectId().toString(),
      ...payload,
    });
  };

  LineBindToken.create = async (payload) => {
    const token = {
      _id: new mongoose.Types.ObjectId().toString(),
      ...payload,
    };
    store.lineBindTokens.push(token);
    return token;
  };
  LineBindToken.findOne = async (query = {}) => store.lineBindTokens.find((item) => matchesQuery(item, query)) || null;
  LineBindToken.deleteOne = async (query = {}) => {
    const index = store.lineBindTokens.findIndex((item) => matchesQuery(item, query));
    if (index >= 0) {
      store.lineBindTokens.splice(index, 1);
    }
  };
}

function resetStore() {
  store.users.length = 0;
  store.courses.length = 0;
  store.videos.length = 0;
  store.enrollments.length = 0;
  store.videoSegments.length = 0;
  store.clips.length = 0;
  store.usageLogs.length = 0;
  store.lineBindTokens.length = 0;

  store.users.push(
    {
      _id: ids.teacher,
      name: 'Demo Teacher',
      email: 'teacher@focusflow.local',
      passwordHash: bcrypt.hashSync('Teacher123!', 10),
      role: 'teacher',
      isActive: true,
      lineUserId: null,
      activeCourseId: null,
    },
    {
      _id: ids.student,
      name: 'Demo Student',
      email: 'student@focusflow.local',
      passwordHash: bcrypt.hashSync('Student123!', 10),
      role: 'student',
      isActive: true,
      lineUserId: 'line-student-001',
      activeCourseId: null,
    },
    {
      _id: ids.admin,
      name: 'Demo Admin',
      email: 'admin@focusflow.local',
      passwordHash: bcrypt.hashSync('Admin123!', 10),
      role: 'admin',
      isActive: true,
      lineUserId: null,
      activeCourseId: null,
    },
  );

  store.courses.push(
    {
      _id: ids.teacherCourse,
      title: 'Teacher Draft Course',
      description: 'Draft course',
      teacherId: ids.teacher,
      status: 'draft',
      createdAt: '2026-04-06T09:00:00.000Z',
    },
    {
      _id: ids.publishedCourse,
      title: 'Published AI Course',
      description: 'Published course',
      teacherId: ids.teacher,
      status: 'published',
      createdAt: '2026-04-06T10:00:00.000Z',
    },
  );

  store.videos.push(
    {
      _id: ids.teacherVideo,
      courseId: ids.teacherCourse,
      title: 'Draft Video',
      sourceType: 'upload',
      sourceUrl: '/uploads/draft.mp4',
      storagePath: path.join(uploadsDir, 'draft.mp4'),
      durationSec: null,
      uploadedBy: ids.teacher,
      processing: {
        status: 'queued',
        errorMessage: null,
      },
      createdAt: '2026-04-06T11:00:00.000Z',
      updatedAt: '2026-04-06T11:00:00.000Z',
    },
    {
      _id: ids.publishedVideo,
      courseId: ids.publishedCourse,
      title: 'Published Video',
      sourceType: 'upload',
      sourceUrl: '/uploads/published.mp4',
      storagePath: path.join(uploadsDir, 'published.mp4'),
      durationSec: null,
      uploadedBy: ids.teacher,
      processing: {
        status: 'completed',
        errorMessage: null,
      },
      createdAt: '2026-04-06T12:00:00.000Z',
      updatedAt: '2026-04-06T12:00:00.000Z',
    },
  );

  store.enrollments.push({
    _id: new mongoose.Types.ObjectId().toString(),
    studentId: ids.student,
    courseId: ids.publishedCourse,
    progress: 25,
  });

  store.videoSegments.push(
    {
      _id: new mongoose.Types.ObjectId().toString(),
      segmentId: ids.segmentOne,
      courseId: ids.publishedCourse,
      videoId: 'video-published-001',
      startSec: 12,
      endSec: 32,
      transcript: 'Node.js backend course explains JWT authentication and role based access control.',
      embedding: [],
    },
    {
      _id: new mongoose.Types.ObjectId().toString(),
      segmentId: 'segment-two',
      courseId: ids.publishedCourse,
      videoId: 'video-published-001',
      startSec: 40,
      endSec: 58,
      transcript: 'This segment describes Express middleware and video upload processing status.',
      embedding: [],
    },
  );

  store.clips.push({
    _id: new mongoose.Types.ObjectId().toString(),
    segmentId: ids.segmentOne,
    courseId: ids.publishedCourse,
    clipUrl: 'https://clips.local/segment-one.mp4',
    jumpUrl: 'https://videos.local/watch?v=video-published-001&t=12',
    keyPoints: ['JWT auth', 'RBAC'],
    hitCount: 0,
  });
}

function createLineSignature(body) {
  return crypto
    .createHmac('sha256', env.lineChannelSecret)
    .update(body)
    .digest('base64');
}

async function loginAs(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  return payload.data.token;
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  installModelStubs();
  resetStore();

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await run('api response helpers', async () => {
      assert.deepEqual(
        buildSuccessResponse({
          message: 'Created',
          data: { id: '123' },
        }),
        {
          success: true,
          message: 'Created',
          data: { id: '123' },
        },
      );

      assert.deepEqual(
        buildErrorResponse({
          message: 'Unauthorized',
          code: 'UNAUTHORIZED',
        }),
        {
          success: false,
          message: 'Unauthorized',
          error: {
            code: 'UNAUTHORIZED',
          },
        },
      );
    });

    await run('auth login and me', async () => {
      resetStore();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      assert.equal(meResponse.status, 200);
      const payload = await meResponse.json();
      assert.equal(payload.data.user.email, 'teacher@focusflow.local');
      assert.equal(store.usageLogs[0].event, 'login');
    });

    await run('student cannot create course', async () => {
      resetStore();
      const token = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');
      const response = await fetch(`${baseUrl}/api/v1/courses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Blocked course' }),
      });

      assert.equal(response.status, 403);
      const payload = await response.json();
      assert.equal(payload.error.code, 'FORBIDDEN');
    });

    await run('teacher creates course and uploads video', async () => {
      resetStore();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const createCourseResponse = await fetch(`${baseUrl}/api/v1/courses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Integration Course',
          description: 'Created in test',
          status: 'published',
        }),
      });

      assert.equal(createCourseResponse.status, 201);
      const createdCourse = (await createCourseResponse.json()).data.course;

      const formData = new FormData();
      formData.append('title', 'Integration Test Video');
      formData.append('video', new Blob(['test video binary'], { type: 'video/mp4' }), 'integration-test-video.mp4');

      const uploadResponse = await fetch(`${baseUrl}/api/v1/courses/${createdCourse._id}/videos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      assert.equal(uploadResponse.status, 201);
      const uploadedVideo = (await uploadResponse.json()).data.video;
      assert.equal(uploadedVideo.processing.status, 'queued');

      const processingResponse = await fetch(`${baseUrl}/api/v1/videos/${uploadedVideo._id}/processing`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      assert.equal(processingResponse.status, 200);
      const processingPayload = await processingResponse.json();
      assert.equal(processingPayload.data.processing.status, 'queued');
    });

    await run('invalid upload type is rejected', async () => {
      resetStore();
      const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

      const formData = new FormData();
      formData.append('title', 'Wrong file');
      formData.append('video', new Blob(['not a video'], { type: 'text/plain' }), 'integration-test-video.txt');

      const response = await fetch(`${baseUrl}/api/v1/courses/${ids.teacherCourse}/videos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      assert.equal(response.status, 400);
      const payload = await response.json();
      assert.equal(payload.error.code, 'INVALID_FILE_TYPE');
    });

    await run('qa access rules and clip cache hit', async () => {
      resetStore();

      const unauthorizedResponse = await fetch(`${baseUrl}/api/v1/qa/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseId: ids.publishedCourse,
          question: 'What does the course say about JWT authentication?',
        }),
      });

      assert.equal(unauthorizedResponse.status, 401);

      const studentToken = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');
      const forbiddenResponse = await fetch(`${baseUrl}/api/v1/qa/ask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseId: ids.teacherCourse,
          question: 'draft content',
        }),
      });

      assert.equal(forbiddenResponse.status, 403);

      const successResponse = await fetch(`${baseUrl}/api/v1/qa/ask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseId: ids.publishedCourse,
          question: 'What does the course say about JWT authentication?',
        }),
      });

      assert.equal(successResponse.status, 200);
      const payload = await successResponse.json();
      assert.match(payload.data.answer, /JWT authentication/i);
      assert.equal(payload.data.matches.length > 0, true);
      assert.equal(payload.data.clip.segmentId, ids.segmentOne);
      assert.equal(store.clips[0].hitCount, 1);
    });

    await run('qa returns empty result when nothing matches', async () => {
      resetStore();
      const studentToken = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');
      const response = await fetch(`${baseUrl}/api/v1/qa/ask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseId: ids.publishedCourse,
          question: 'quantum entanglement satellite farming',
        }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.data.matches.length, 0);
      assert.equal(payload.data.clip, null);
    });

    await run('line webhook covers error and happy paths', async () => {
      resetStore();

      const payload = {
        events: [
          {
            type: 'message',
            replyToken: 'reply-1',
            source: { userId: 'unknown-line-user' },
            message: { type: 'text', text: 'What is JWT?' },
          },
        ],
      };

      const rawBody = JSON.stringify(payload);

      const missingSignatureResponse = await fetch(`${baseUrl}/api/v1/line/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: rawBody,
      });
      assert.equal(missingSignatureResponse.status, 401);

      const invalidSignatureResponse = await fetch(`${baseUrl}/api/v1/line/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': 'invalid-signature',
        },
        body: rawBody,
      });
      assert.equal(invalidSignatureResponse.status, 401);

      const validSignature = createLineSignature(rawBody);
      const unboundUserResponse = await fetch(`${baseUrl}/api/v1/line/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': validSignature,
        },
        body: rawBody,
      });
      assert.equal(unboundUserResponse.status, 200);
      const unboundPayload = await unboundUserResponse.json();
      assert.equal(unboundPayload.data.results[0].reason, 'user_not_bound');

      const noCoursePayload = {
        events: [
          {
            type: 'message',
            replyToken: 'reply-2',
            source: { userId: 'line-student-001' },
            message: { type: 'text', text: 'What is JWT?' },
          },
        ],
      };

      const noCourseBody = JSON.stringify(noCoursePayload);
      const noCourseResponse = await fetch(`${baseUrl}/api/v1/line/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': createLineSignature(noCourseBody),
        },
        body: noCourseBody,
      });
      assert.equal(noCourseResponse.status, 200);
      const noCourseResult = await noCourseResponse.json();
      assert.equal(noCourseResult.data.results[0].reason, 'active_course_missing');

      store.users.find((item) => item._id === ids.student).activeCourseId = ids.publishedCourse;

      const happyPayload = {
        events: [
          {
            type: 'message',
            replyToken: 'reply-3',
            source: { userId: 'line-student-001' },
            message: { type: 'text', text: 'What does the course say about JWT authentication?' },
          },
          {
            type: 'postback',
            replyToken: 'reply-4',
            source: { userId: 'line-student-001' },
            postback: { data: `action=select_course&courseId=${ids.publishedCourse}` },
          },
          {
            type: 'beacon',
            replyToken: 'reply-5',
            source: { userId: 'line-student-001' },
          },
        ],
      };

      const happyBody = JSON.stringify(happyPayload);
      const happyResponse = await fetch(`${baseUrl}/api/v1/line/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': createLineSignature(happyBody),
        },
        body: happyBody,
      });
      assert.equal(happyResponse.status, 200);
      const happyResult = await happyResponse.json();
      assert.equal(happyResult.data.results[0].handled, true);
      assert.equal(happyResult.data.results[1].handled, true);
      assert.equal(happyResult.data.results[2].reason, 'unsupported_event');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));

    if (fs.existsSync(uploadsDir)) {
      for (const entry of fs.readdirSync(uploadsDir)) {
        if (entry.includes('integration-test-video')) {
          fs.rmSync(path.join(uploadsDir, entry), { force: true });
        }
      }
    }
  }
}

main()
  .then(() => {
    console.log('All backend tests passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
