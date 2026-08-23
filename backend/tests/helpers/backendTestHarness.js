const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.QA_QUERY_EMBEDDING_PROVIDER = 'mock';
process.env.QA_VECTOR_SEARCH_MODE = 'memory';
process.env.QA_ANSWER_PROVIDER = 'template';
process.env.LINE_CHANNEL_SECRET = 'line-secret-for-tests';
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.PROCESSING_WEBHOOK_SECRET = 'processing-secret-for-tests';
const avatarTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-avatar-tests-'));
process.env.AVATAR_UPLOAD_DIR = path.join(avatarTestRoot, 'avatars');

const app = require('../../src/app');
const env = require('../../src/config/env');
const User = require('../../src/models/user.model');
const Course = require('../../src/models/course.model');
const Video = require('../../src/models/video.model');
const VideoBatch = require('../../src/models/videoBatch.model');
const Enrollment = require('../../src/models/enrollment.model');
const VideoSegment = require('../../src/models/videoSegment.model');
const VideoSegmentVideo = require('../../src/models/videoSegmentVideo.model');
const Clip = require('../../src/models/clip.model');
const UsageLog = require('../../src/models/usageLog.model');
const Question = require('../../src/models/question.model');
const LineBindToken = require('../../src/models/lineBindToken.model');
const Faq = require('../../src/models/faq.model');
const ShortAsset = require('../../src/models/shortAsset.model');
const Notification = require('../../src/models/notification.model');
const Conversation = require('../../src/models/conversation.model');
const Message = require('../../src/models/message.model');

const uploadsDir = env.uploadDir;
const TEST_UPLOAD_PREFIX = 'test-upload-';

// All model stubs read from and write to this shared in-memory store.
const store = {
  users: [],
  courses: [],
  videos: [],
  videoBatches: [],
  enrollments: [],
  videoSegments: [],
  videoSegmentVideos: [],
  clips: [],
  usageLogs: [],
  questions: [],
  lineBindTokens: [],
  faqs: [],
  shortAssets: [],
  notifications: [],
  conversations: [],
  messages: [],
  nextUserCreateError: null,
  nextUserFindByIdAndUpdateError: null,
  beforeUserAvatarCompareAndSwap: null,
  nextNotificationBulkWriteError: null,
  nextFaqDeleteManyError: null,
};

const ids = {
  teacher: '507f1f77bcf86cd799439011',
  student: '507f1f77bcf86cd799439012',
  admin: '507f1f77bcf86cd799439013',
  otherTeacher: '507f1f77bcf86cd799439014',
  teacherCourse: '507f191e810c19729de860ea',
  publishedCourse: '507f191e810c19729de860eb',
  pipelineBridgeCourse: '507f191e810c19729de860f0',
  teacherVideo: '507f191e810c19729de860ec',
  publishedVideo: '507f191e810c19729de860ed',
  pipelineBridgeVideo: '507f191e810c19729de860f1',
  teacherVideoExternal: 'video-draft-001',
  publishedVideoExternal: 'video-published-001',
  pipelineBridgeVideoExternal: 'video-pipeline-bridge-001',
  enrolledDraftCourse: '507f191e810c19729de860ee',
  foreignDraftCourse: '507f191e810c19729de860ef',
  segmentOne: 'segment-one',
  segmentTwo: 'segment-two',
  snakeCaseSegment: 'segment-snake-case',
  // 64-char hex strings trigger the LINE bind-token branch in text messages.
  lineBindTokenText: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  expiredLineBindTokenText: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
};

function newObjectId() {
  return new mongoose.Types.ObjectId().toString();
}

function getNested(target, key) {
  return key.split('.').reduce((value, segment) => {
    if (value == null) {
      return undefined;
    }

    return value[segment];
  }, target);
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

function normalizeValue(value) {
  if (value == null) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object' && value._id) {
    return String(value._id);
  }

  return String(value);
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

  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) {
      setNested(target, key, undefined);
    }
  }

  if (isInsert && update.$setOnInsert) {
    for (const [key, value] of Object.entries(update.$setOnInsert)) {
      setNested(target, key, value);
    }
  }

  if (update.$inc) {
    for (const [key, value] of Object.entries(update.$inc)) {
      const currentValue = Number(getNested(target, key) || 0);
      setNested(target, key, currentValue + value);
    }
  }

  if (update.$push) {
    for (const [key, value] of Object.entries(update.$push)) {
      const currentValue = getNested(target, key);
      const nextValue = Array.isArray(currentValue) ? [...currentValue, value] : [value];
      setNested(target, key, nextValue);
    }
  }

  if (update.$pull) {
    for (const [key, value] of Object.entries(update.$pull)) {
      const currentValue = getNested(target, key);

      if (!Array.isArray(currentValue)) {
        continue;
      }

      const removable = value && typeof value === 'object' && Array.isArray(value.$in)
        ? value.$in.map(normalizeValue)
        : [normalizeValue(value)];
      setNested(target, key, currentValue.filter((item) => !removable.includes(normalizeValue(item))));
    }
  }

  if (update.$addToSet) {
    for (const [key, value] of Object.entries(update.$addToSet)) {
      const currentValue = getNested(target, key);
      const nextValue = Array.isArray(currentValue) ? [...currentValue] : [];
      const exists = nextValue.some((item) => normalizeValue(item) === normalizeValue(value));

      if (!exists) {
        nextValue.push(value);
      }

      setNested(target, key, nextValue);
    }
  }

  return target;
}

function matchesQuery(document, query = {}) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$and') {
      return value.every((candidate) => matchesQuery(document, candidate));
    }

    if (key === '$or') {
      return value.some((candidate) => matchesQuery(document, candidate));
    }

    const currentValue = getNested(document, key);

    const isOperatorObject = value
      && typeof value === 'object'
      && Object.keys(value).some((operator) => operator.startsWith('$'));

    if (isOperatorObject) {
      if ('$exists' in value) {
        const exists = currentValue !== undefined;
        if (exists !== Boolean(value.$exists)) return false;
      }

      if ('$in' in value && !value.$in.map(normalizeValue).includes(normalizeValue(currentValue))) {
        return false;
      }

      if ('$nin' in value && value.$nin.map(normalizeValue).includes(normalizeValue(currentValue))) {
        return false;
      }

      if ('$ne' in value && normalizeValue(currentValue) === normalizeValue(value.$ne)) {
        return false;
      }

      if ('$gte' in value && new Date(currentValue).getTime() < new Date(value.$gte).getTime()) {
        return false;
      }

      if ('$lt' in value) {
        const leftDate = new Date(currentValue).getTime();
        const rightDate = new Date(value.$lt).getTime();
        const isDateComparison = !Number.isNaN(leftDate) && !Number.isNaN(rightDate);
        if (isDateComparison ? leftDate >= rightDate : normalizeValue(currentValue) >= normalizeValue(value.$lt)) return false;
      }

      return true;
    }

    if (Array.isArray(currentValue)) {
      return currentValue.some((item) => normalizeValue(item) === normalizeValue(value));
    }

    return normalizeValue(currentValue) === normalizeValue(value);
  });
}

function sortItems(items, sortSpec = {}) {
  const entries = Object.entries(sortSpec);

  if (!entries.length) {
    return [...items];
  }

  return [...items].sort((left, right) => {
    for (const [field, direction] of entries) {
      const leftValue = normalizeValue(getNested(left, field));
      const rightValue = normalizeValue(getNested(right, field));
      if (leftValue === rightValue) continue;
      if (direction < 0) return leftValue > rightValue ? -1 : 1;
      return leftValue > rightValue ? 1 : -1;
    }
    return 0;
  });
}

function mapValue(value, mapper) {
  if (Array.isArray(value)) {
    return value.map((item) => mapper({ ...item }));
  }

  if (!value) {
    return value;
  }

  return mapper({ ...value });
}

function findUserById(id) {
  return store.users.find((user) => normalizeValue(user._id) === normalizeValue(id)) || null;
}

function findCourseById(id) {
  return store.courses.find((course) => normalizeValue(course._id) === normalizeValue(id)) || null;
}

function createProcessingState({
  status,
  errorMessage = null,
  errorCode = null,
  queuedAt = null,
  startedAt = null,
  completedAt = null,
  failedAt = null,
  attemptCount = 0,
} = {}) {
  return {
    status,
    errorMessage,
    errorCode,
    queuedAt,
    startedAt,
    completedAt,
    failedAt,
    attemptCount,
  };
}

function createQuery(initialValue, options = {}) {
  const state = {
    value: initialValue,
  };

  // This minimal thenable supports the populate/sort chains used by services.
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
    limit(count) {
      if (Array.isArray(state.value)) {
        state.value = state.value.slice(0, count);
      }

      return this;
    },
    lean() {
      // store 已是 plain JS objects，hydration 在這個 harness 是 no-op
      return this;
    },
    select() {
      // 測試 harness 不做欄位投影，全部回傳原物件即可
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

function findOneAndUpdateInStore(collection, query, update, options = {}) {
  let document = collection.find((item) => matchesQuery(item, query));

  if (!document && options.upsert) {
    document = {
      _id: newObjectId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    applyUpdate(document, query, { isInsert: true });
    applyUpdate(document, update, { isInsert: true });
    collection.push(document);
    return document;
  }

  if (!document) {
    return null;
  }

  applyUpdate(document, update);
  document.updatedAt = new Date().toISOString();
  return document;
}

function deleteManyInStore(collection, query = {}) {
  const removableIndexes = [];

  collection.forEach((item, index) => {
    if (matchesQuery(item, query)) {
      removableIndexes.push(index);
    }
  });

  for (let index = removableIndexes.length - 1; index >= 0; index -= 1) {
    collection.splice(removableIndexes[index], 1);
  }

  return {
    deletedCount: removableIndexes.length,
  };
}

async function bulkWriteInStore(collection, operations = []) {
  let modifiedCount = 0;
  for (const operation of operations) {
    const { filter = {}, update = {} } = operation.updateOne || {};
    const document = collection.find((item) => matchesQuery(item, filter));
    if (!document) continue;
    applyUpdate(document, update);
    document.updatedAt = new Date().toISOString();
    modifiedCount += 1;
  }
  return { modifiedCount };
}

function installModelStubs() {
  if (installModelStubs.installed) {
    return;
  }

  // 測試不連真實 MongoDB；deleteVideo 會直接操作 raw collection（transcripts_normalized），
  // 這裡給 mongoose.connection.db 一個 no-op stub 避免 500。
  if (!mongoose.connection.db) {
    Object.defineProperty(mongoose.connection, 'db', {
      configurable: true,
      get() {
        return {
          collection: () => ({
            deleteMany: async () => ({ deletedCount: 0 }),
          }),
        };
      },
    });
  }

  // Monkey-patch the mongoose models once so production services can run unchanged.
  User.findOne = async (query = {}) => store.users.find((item) => matchesQuery(item, query)) || null;
  User.findById = async (id) => findUserById(id);
  User.find = (query = {}) => createQuery(store.users.filter((item) => matchesQuery(item, query)));
  User.create = async (payload) => {
    if (store.nextUserCreateError) {
      const error = store.nextUserCreateError;
      store.nextUserCreateError = null;
      throw error;
    }

    if (store.users.some((item) => item.email === payload.email)) {
      const error = new Error('Duplicate user email.');
      error.code = 11000;
      error.keyValue = { email: payload.email };
      throw error;
    }

    const now = new Date().toISOString();
    const user = {
      _id: payload._id || newObjectId(),
      isActive: payload.isActive ?? true,
      avatar: payload.avatar ?? null,
      createdAt: payload.createdAt || now,
      updatedAt: now,
      ...payload,
    };
    store.users.push(user);
    return user;
  };
  User.findOneAndUpdate = async (query, update, options = {}) => {
    const isAvatarCompareAndSwap = Boolean(
      query?._id
      && (
        Object.prototype.hasOwnProperty.call(query, 'avatar')
        || Object.prototype.hasOwnProperty.call(query, 'avatar.filename')
      )
    );

    if (isAvatarCompareAndSwap && store.beforeUserAvatarCompareAndSwap) {
      await store.beforeUserAvatarCompareAndSwap(query, update);
    }

    if (isAvatarCompareAndSwap && store.nextUserFindByIdAndUpdateError) {
      const error = store.nextUserFindByIdAndUpdateError;
      store.nextUserFindByIdAndUpdateError = null;
      throw error;
    }

    let user = store.users.find((item) => matchesQuery(item, query));

    if (!user && options.upsert) {
      user = { _id: newObjectId() };
      applyUpdate(user, query, { isInsert: true });
      applyUpdate(user, update, { isInsert: true });
      store.users.push(user);
      return user;
    }

    if (!user) {
      return null;
    }

    applyUpdate(user, update);
    return user;
  };
  User.findByIdAndUpdate = async (id, update) => {
    if (store.nextUserFindByIdAndUpdateError) {
      const error = store.nextUserFindByIdAndUpdateError;
      store.nextUserFindByIdAndUpdateError = null;
      throw error;
    }

    const user = findUserById(id);

    if (!user) {
      return null;
    }

    applyUpdate(user, update);
    return user;
  };
  User.updateMany = async (query, update) => {
    const users = store.users.filter((item) => matchesQuery(item, query));

    for (const user of users) {
      applyUpdate(user, update);
    }

    return {
      matchedCount: users.length,
      modifiedCount: users.length,
    };
  };

  Course.create = async (payload) => {
    const course = {
      _id: payload._id || newObjectId(),
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...payload,
    };
    store.courses.push(course);
    return course;
  };
  Course.findOneAndUpdate = async (query, update, options = {}) => findOneAndUpdateInStore(
    store.courses,
    query,
    update,
    options,
  );
  Course.deleteMany = async (query = {}) => deleteManyInStore(store.courses, query);
  Course.deleteOne = async (query = {}) => {
    const index = store.courses.findIndex((item) => matchesQuery(item, query));
    if (index === -1) return { deletedCount: 0 };
    store.courses.splice(index, 1);
    return { deletedCount: 1 };
  };
  Course.find = (query = {}) => createQuery(
    store.courses.filter((item) => matchesQuery(item, query)),
    {
      populateMap: {
        teacherId(value) {
          return mapValue(value, (course) => ({
            ...course,
            teacherId: findUserById(course.teacherId) || null,
          }));
        },
      },
    },
  );
  Course.findById = (id) => createQuery(
    findCourseById(id),
    {
      populateMap: {
        teacherId(value) {
          return mapValue(value, (course) => ({
            ...course,
            teacherId: findUserById(course.teacherId) || null,
          }));
        },
      },
    },
  );
  Course.findByIdAndUpdate = async (id, update) => {
    const course = findCourseById(id);

    if (!course) {
      return null;
    }

    applyUpdate(course, update);
    course.updatedAt = new Date().toISOString();
    return course;
  };
  Course.updateMany = async (query, update) => {
    const courses = store.courses.filter((item) => matchesQuery(item, query));

    for (const course of courses) {
      applyUpdate(course, update);
      course.updatedAt = new Date().toISOString();
    }

    return {
      matchedCount: courses.length,
      modifiedCount: courses.length,
    };
  };

  Video.create = async (payload) => {
    const video = {
      _id: payload._id || newObjectId(),
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...payload,
    };
    store.videos.push(video);
    return video;
  };
  Video.findOneAndUpdate = async (query, update, options = {}) => findOneAndUpdateInStore(
    store.videos,
    query,
    update,
    options,
  );
  Video.deleteMany = async (query = {}) => deleteManyInStore(store.videos, query);
  Video.deleteOne = async (query = {}) => {
    const index = store.videos.findIndex((item) => matchesQuery(item, query));

    if (index === -1) {
      return { deletedCount: 0 };
    }

    store.videos.splice(index, 1);
    return { deletedCount: 1 };
  };
  Video.find = (query = {}) => createQuery(
    store.videos.filter((item) => matchesQuery(item, query)),
    {
      populateMap: {
        courseId(value) {
          return mapValue(value, (video) => ({
            ...video,
            courseId: findCourseById(video.courseId) || null,
          }));
        },
        uploadedBy(value) {
          return mapValue(value, (video) => ({
            ...video,
            uploadedBy: findUserById(video.uploadedBy) || null,
          }));
        },
      },
    },
  );
  Video.findOne = async (query = {}) => store.videos.find((item) => matchesQuery(item, query)) || null;
  Video.findById = (id) => createQuery(
    store.videos.find((item) => normalizeValue(item._id) === normalizeValue(id)) || null,
    {
      populateMap: {
        courseId(value) {
          return mapValue(value, (video) => ({
            ...video,
            courseId: findCourseById(video.courseId) || null,
          }));
        },
        uploadedBy(value) {
          return mapValue(value, (video) => ({
            ...video,
            uploadedBy: findUserById(video.uploadedBy) || null,
          }));
        },
      },
    },
  );
  Video.findByIdAndUpdate = async (id, update) => {
    const video = store.videos.find((item) => normalizeValue(item._id) === normalizeValue(id));

    if (!video) {
      return null;
    }

    applyUpdate(video, update);
    video.updatedAt = new Date().toISOString();
    return video;
  };

  VideoBatch.create = async (payload) => {
    const batch = {
      _id: payload._id || newObjectId(),
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...payload,
    };
    store.videoBatches.push(batch);
    return batch;
  };
  VideoBatch.findOne = async (query = {}) => store.videoBatches.find((item) => matchesQuery(item, query)) || null;
  VideoBatch.findOneAndUpdate = async (query, update, options = {}) => findOneAndUpdateInStore(
    store.videoBatches,
    query,
    update,
    options,
  );
  VideoBatch.find = (query = {}) => createQuery(
    store.videoBatches.filter((item) => matchesQuery(item, query)),
  );

  Enrollment.find = (query = {}) => createQuery(
    store.enrollments.filter((item) => matchesQuery(item, query)),
    {
      populateMap: {
        courseId(value) {
          return mapValue(value, (enrollment) => ({
            ...enrollment,
            courseId: findCourseById(enrollment.courseId) || null,
          }));
        },
      },
    },
  );
  Enrollment.findOne = async (query = {}) => store.enrollments.find((item) => matchesQuery(item, query)) || null;
  Enrollment.findOneAndUpdate = async (query, update, options = {}) => {
    let enrollment = store.enrollments.find((item) => matchesQuery(item, query));

    if (!enrollment && options.upsert) {
      enrollment = { _id: newObjectId() };
      applyUpdate(enrollment, query, { isInsert: true });
      applyUpdate(enrollment, update, { isInsert: true });
      store.enrollments.push(enrollment);
      return enrollment;
    }

    if (!enrollment) {
      return null;
    }

    applyUpdate(enrollment, update);
    return enrollment;
  };
  Enrollment.aggregate = async (pipeline = []) => {
    const match = pipeline.find((stage) => stage.$match)?.$match;
    const group = pipeline.find((stage) => stage.$group)?.$group;
    const source = match
      ? store.enrollments.filter((item) => matchesQuery(item, match))
      : store.enrollments;
    if (!group) return [...source];

    const grouped = new Map();
    const groupPath = String(group._id || '').replace(/^\$/, '');
    for (const enrollment of source) {
      const key = getNested(enrollment, groupPath);
      const normalizedKey = normalizeValue(key);
      const current = grouped.get(normalizedKey) || { _id: key };
      for (const [field, expression] of Object.entries(group)) {
        if (field !== '_id' && expression?.$sum === 1) {
          current[field] = (current[field] || 0) + 1;
        }
      }
      grouped.set(normalizedKey, current);
    }
    return [...grouped.values()];
  };
  Enrollment.deleteMany = async (query = {}) => deleteManyInStore(store.enrollments, query);

  VideoSegment.find = (query = {}) => createQuery(store.videoSegments.filter((item) => matchesQuery(item, query)));
  VideoSegment.findOne = async (query = {}) => store.videoSegments.find((item) => matchesQuery(item, query)) || null;
  VideoSegment.countDocuments = async (query = {}) => store.videoSegments.filter((item) => matchesQuery(item, query)).length;
  VideoSegment.findOneAndUpdate = async (query, update, options = {}) => findOneAndUpdateInStore(
    store.videoSegments,
    query,
    update,
    options,
  );
  VideoSegment.deleteMany = async (query = {}) => deleteManyInStore(store.videoSegments, query);
  VideoSegment.aggregate = async () => [];

  VideoSegmentVideo.find = (query = {}) => createQuery(store.videoSegmentVideos.filter((item) => matchesQuery(item, query)));
  VideoSegmentVideo.findOne = async (query = {}) => store.videoSegmentVideos.find((item) => matchesQuery(item, query)) || null;
  VideoSegmentVideo.countDocuments = async (query = {}) => store.videoSegmentVideos.filter((item) => matchesQuery(item, query)).length;
  VideoSegmentVideo.deleteMany = async (query = {}) => deleteManyInStore(store.videoSegmentVideos, query);
  VideoSegmentVideo.aggregate = async (pipeline = []) => {
    const vectorStage = pipeline.find((stage) => stage.$vectorSearch)?.$vectorSearch;
    const allowedVideoIds = vectorStage?.filter?.video_id?.$in || [];
    const limit = vectorStage?.limit || store.videoSegmentVideos.length;

    return store.videoSegmentVideos
      .filter((item) => !allowedVideoIds.length || allowedVideoIds.includes(item.video_id))
      .slice(0, limit)
      .map((item, index) => ({
        ...item,
        score: item.score ?? Math.max(0.1, 0.95 - (index * 0.05)),
      }));
  };

  Clip.findOneAndUpdate = async (query, update, options = {}) => findOneAndUpdateInStore(
    store.clips,
    query,
    update,
    options,
  );
  Clip.deleteMany = async (query = {}) => deleteManyInStore(store.clips, query);

  UsageLog.create = async (payload) => {
    const usageLog = {
      _id: newObjectId(),
      ...payload,
    };
    store.usageLogs.push(usageLog);
    return usageLog;
  };
  UsageLog.countDocuments = async (query = {}) => store.usageLogs.filter((item) => matchesQuery(item, query)).length;
  UsageLog.aggregate = async (pipeline = []) => {
    let items = [...store.usageLogs];

    for (const stage of pipeline) {
      if (stage.$match) {
        items = items.filter((item) => matchesQuery(item, stage.$match));
      } else if (stage.$group) {
        const grouped = new Map();
        const groupPath = String(stage.$group._id || '').replace(/^\$/, '');

        for (const item of items) {
          const key = getNested(item, groupPath);
          if (!grouped.has(key)) {
            grouped.set(key, { _id: key });
          }

          const target = grouped.get(key);
          for (const [field, expression] of Object.entries(stage.$group)) {
            if (field === '_id') continue;
            if (expression?.$sum === 1) {
              target[field] = (target[field] || 0) + 1;
            } else if (expression?.$first) {
              const firstPath = String(expression.$first).replace(/^\$/, '');
              if (target[field] === undefined) target[field] = getNested(item, firstPath);
            }
          }
        }

        items = [...grouped.values()];
      } else if (stage.$sort) {
        items = sortItems(items, stage.$sort);
      } else if (stage.$limit) {
        items = items.slice(0, stage.$limit);
      }
    }

    return items;
  };
  UsageLog.deleteMany = async (query = {}) => deleteManyInStore(store.usageLogs, query);

  Notification.create = async (payload) => {
    const now = new Date().toISOString();
    const notification = {
      _id: payload._id || newObjectId(),
      urgent: false,
      readAt: null,
      createdBy: null,
      courseIds: [],
      videoId: null,
      createdAt: payload.createdAt || now,
      updatedAt: now,
      ...payload,
    };
    store.notifications.push(notification);
    return notification;
  };
  Notification.insertMany = async (payloads = []) => Promise.all(
    payloads.map((payload) => Notification.create(payload)),
  );
  Notification.find = (query = {}) => createQuery(
    store.notifications.filter((item) => matchesQuery(item, query)),
  );
  Notification.findOne = async (query = {}) => (
    store.notifications.find((item) => matchesQuery(item, query)) || null
  );
  Notification.findOneAndUpdate = async (query, update) => {
    const notification = store.notifications.find((item) => matchesQuery(item, query));
    if (!notification) return null;
    applyUpdate(notification, update);
    notification.updatedAt = new Date().toISOString();
    return notification;
  };
  Notification.updateMany = async (query, update) => {
    const notifications = store.notifications.filter((item) => matchesQuery(item, query));
    for (const notification of notifications) {
      applyUpdate(notification, update);
      notification.updatedAt = new Date().toISOString();
    }
    return {
      matchedCount: notifications.length,
      modifiedCount: notifications.length,
    };
  };
  Notification.countDocuments = async (query = {}) => (
    store.notifications.filter((item) => matchesQuery(item, query)).length
  );
  Notification.deleteMany = async (query = {}) => deleteManyInStore(
    store.notifications,
    query,
  );
  const applyNotificationBulkOperation = (operation) => {
    const { filter = {}, update = {}, upsert = false } = operation.updateOne || {};
    let notification = store.notifications.find((item) => matchesQuery(item, filter));

    if (notification) {
      applyUpdate(notification, update);
      notification.updatedAt = new Date().toISOString();
      return { matchedCount: 1, upsertedCount: 0 };
    }

    if (!upsert) {
      return { matchedCount: 0, upsertedCount: 0 };
    }

    const now = new Date().toISOString();
    notification = {
      _id: newObjectId(),
      urgent: false,
      readAt: null,
      createdBy: null,
      courseIds: [],
      videoId: null,
      createdAt: now,
      updatedAt: now,
    };
    applyUpdate(notification, filter, { isInsert: true });
    applyUpdate(notification, update, { isInsert: true });
    store.notifications.push(notification);
    return { matchedCount: 0, upsertedCount: 1 };
  };
  Notification.bulkWrite = async (operations = []) => {
    if (store.nextNotificationBulkWriteError) {
      const error = store.nextNotificationBulkWriteError;
      store.nextNotificationBulkWriteError = null;
      for (const index of error.appliedOperationIndexes || []) {
        if (operations[index]) {
          applyNotificationBulkOperation(operations[index]);
        }
      }
      throw error;
    }

    return operations.reduce(
      (totals, operation) => {
        const result = applyNotificationBulkOperation(operation);
        return {
          matchedCount: totals.matchedCount + result.matchedCount,
          upsertedCount: totals.upsertedCount + result.upsertedCount,
        };
      },
      { matchedCount: 0, upsertedCount: 0 },
    );
  };

  Question.create = async (payload) => {
    store.questions.push({
      _id: newObjectId(),
      ...payload,
    });
  };
  Question.find = (query = {}) => createQuery(store.questions.filter((item) => matchesQuery(item, query)));
  Question.countDocuments = async (query = {}) => store.questions.filter((item) => matchesQuery(item, query)).length;
  Question.deleteMany = async (query = {}) => deleteManyInStore(store.questions, query);

  Conversation.create = async (payload) => {
    const now = new Date().toISOString();
    const document = { _id: newObjectId(), createdAt: now, updatedAt: now, ...payload };
    store.conversations.push(document);
    return document;
  };
  Conversation.findById = (id) => createQuery(
    store.conversations.find((item) => normalizeValue(item._id) === normalizeValue(id)) || null,
  );
  Conversation.findByIdAndUpdate = async (id, update) => {
    const document = store.conversations.find((item) => normalizeValue(item._id) === normalizeValue(id));
    if (!document) return null;
    applyUpdate(document, update);
    document.updatedAt = new Date().toISOString();
    return document;
  };
  Message.create = async (payload) => {
    const now = new Date().toISOString();
    const document = { _id: newObjectId(), createdAt: now, updatedAt: now, sources: [], ...payload };
    store.messages.push(document);
    return document;
  };
  Message.find = (query = {}) => createQuery(store.messages.filter((item) => matchesQuery(item, query)));

  Faq.find = (query = {}) => createQuery(store.faqs.filter((item) => matchesQuery(item, query)));
  Faq.findOne = async (query = {}) => store.faqs.find((item) => matchesQuery(item, query)) || null;
  Faq.findOneAndUpdate = async (query, update, options = {}) => findOneAndUpdateInStore(
    store.faqs,
    query,
    update,
    options,
  );
  Faq.countDocuments = async (query = {}) => store.faqs.filter((item) => matchesQuery(item, query)).length;
  Faq.deleteMany = async (query = {}) => {
    if (store.nextFaqDeleteManyError) {
      const error = store.nextFaqDeleteManyError;
      store.nextFaqDeleteManyError = null;
      throw error;
    }
    return deleteManyInStore(store.faqs, query);
  };

  ShortAsset.create = async (payload) => {
    const asset = {
      _id: payload._id || newObjectId(),
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      youtubeAvailability: 'pending',
      youtubePrivacyStatus: 'unknown',
      ...payload,
    };
    store.shortAssets.push(asset);
    return asset;
  };
  ShortAsset.find = (query = {}) => createQuery(store.shortAssets.filter((item) => matchesQuery(item, query)));
  ShortAsset.findById = (id) => createQuery(
    store.shortAssets.find((item) => normalizeValue(item._id) === normalizeValue(id)) || null,
  );
  ShortAsset.findByIdAndUpdate = async (id, update) => {
    const asset = store.shortAssets.find((item) => normalizeValue(item._id) === normalizeValue(id));
    if (!asset) return null;
    applyUpdate(asset, update);
    asset.updatedAt = new Date().toISOString();
    return asset;
  };
  ShortAsset.bulkWrite = async (operations = []) => bulkWriteInStore(store.shortAssets, operations);

  LineBindToken.create = async (payload) => {
    const token = {
      _id: newObjectId(),
      ...payload,
    };
    store.lineBindTokens.push(token);
    return token;
  };
  LineBindToken.findOne = async (query = {}) => store.lineBindTokens.find((item) => matchesQuery(item, query)) || null;
  LineBindToken.deleteMany = async (query = {}) => deleteManyInStore(store.lineBindTokens, query);
  LineBindToken.deleteOne = async (query = {}) => {
    const index = store.lineBindTokens.findIndex((item) => matchesQuery(item, query));

    if (index >= 0) {
      store.lineBindTokens.splice(index, 1);
    }
  };

  installModelStubs.installed = true;
}

function resetStore() {
  // Rehydrate the baseline fixtures before each test to keep suites isolated.
  cleanupTestAvatars();
  store.users.length = 0;
  store.courses.length = 0;
  store.videos.length = 0;
  store.videoBatches.length = 0;
  store.enrollments.length = 0;
  store.videoSegments.length = 0;
  store.videoSegmentVideos.length = 0;
  store.clips.length = 0;
  store.usageLogs.length = 0;
  store.questions.length = 0;
  store.lineBindTokens.length = 0;
  store.faqs.length = 0;
  store.shortAssets.length = 0;
  store.notifications.length = 0;
  store.conversations.length = 0;
  store.messages.length = 0;
  store.nextUserCreateError = null;
  store.nextUserFindByIdAndUpdateError = null;
  store.beforeUserAvatarCompareAndSwap = null;
  store.nextNotificationBulkWriteError = null;
  store.nextFaqDeleteManyError = null;

  store.users.push(
    {
      _id: ids.teacher,
      name: 'Demo Teacher',
      email: 'teacher@focusflow.local',
      passwordHash: bcrypt.hashSync('Teacher123!', 10),
      role: 'teacher',
      isActive: true,
      avatar: null,
      lineUserId: null,
      lineBindAt: null,
      activeCourseId: null,
      lineConversationState: 'idle',
    },
    {
      _id: ids.student,
      name: 'Demo Student',
      email: 'student@focusflow.local',
      passwordHash: bcrypt.hashSync('Student123!', 10),
      role: 'student',
      isActive: true,
      avatar: null,
      lineUserId: 'line-student-001',
      lineBindAt: null,
      activeCourseId: null,
      lineConversationState: 'idle',
    },
    {
      _id: ids.admin,
      name: 'Demo Admin',
      email: 'admin@focusflow.local',
      passwordHash: bcrypt.hashSync('Admin123!', 10),
      role: 'admin',
      isActive: true,
      avatar: null,
      lineUserId: null,
      lineBindAt: null,
      activeCourseId: null,
      lineConversationState: 'idle',
    },
    {
      _id: ids.otherTeacher,
      name: 'Other Teacher',
      email: 'teacher2@focusflow.local',
      passwordHash: bcrypt.hashSync('Teacher123!', 10),
      role: 'teacher',
      isActive: true,
      avatar: null,
      lineUserId: null,
      lineBindAt: null,
      activeCourseId: null,
      lineConversationState: 'idle',
    },
  );

  store.courses.push(
    {
      _id: ids.teacherCourse,
      title: 'Teacher Draft Course',
      description: 'Draft course',
      teacherId: ids.teacher,
      videoIds: [ids.teacherVideo],
      status: 'draft',
      createdAt: '2026-04-06T09:00:00.000Z',
    },
    {
      _id: ids.publishedCourse,
      title: 'Published AI Course',
      description: 'Published course',
      teacherId: ids.teacher,
      videoIds: [ids.publishedVideo],
      status: 'published',
      createdAt: '2026-04-06T10:00:00.000Z',
    },
    {
      _id: ids.enrolledDraftCourse,
      title: 'Enrolled Draft Course',
      description: 'Draft course with enrollment',
      teacherId: ids.otherTeacher,
      videoIds: [],
      status: 'draft',
      createdAt: '2026-04-06T10:30:00.000Z',
    },
    {
      _id: ids.foreignDraftCourse,
      title: 'Foreign Draft Course',
      description: 'Draft course without enrollment',
      teacherId: ids.otherTeacher,
      videoIds: [],
      status: 'draft',
      createdAt: '2026-04-06T11:00:00.000Z',
    },
  );

  store.videos.push(
    {
      _id: ids.teacherVideo,
      courseId: ids.teacherCourse,
      title: 'Draft Video',
      sourceType: 'upload',
      sourceUrl: '/uploads/draft.mp4',
      video_id: ids.teacherVideoExternal,
      file_name: 'draft.mp4',
      file_path: path.join(uploadsDir, 'draft.mp4'),
      durationSec: null,
      duration_sec: null,
      video_source: 'upload',
      video_url: '/uploads/draft.mp4',
      uploadedBy: ids.teacher,
      processing: createProcessingState({
        status: 'queued',
        queuedAt: '2026-04-06T11:00:00.000Z',
      }),
      createdAt: '2026-04-06T11:00:00.000Z',
      updatedAt: '2026-04-06T11:00:00.000Z',
    },
    {
      _id: ids.publishedVideo,
      courseId: ids.publishedCourse,
      status: 'active',
      title: 'Published Video',
      sourceType: 'upload',
      sourceUrl: '/uploads/published.mp4',
      video_id: ids.publishedVideoExternal,
      file_name: 'published.mp4',
      file_path: path.join(uploadsDir, 'published.mp4'),
      durationSec: null,
      duration_sec: null,
      video_source: 'upload',
      video_url: '/uploads/published.mp4',
      uploadedBy: ids.teacher,
      processing: createProcessingState({
        status: 'completed',
        queuedAt: '2026-04-06T12:00:00.000Z',
        startedAt: '2026-04-06T12:01:00.000Z',
        completedAt: '2026-04-06T12:03:00.000Z',
        attemptCount: 1,
      }),
      createdAt: '2026-04-06T12:00:00.000Z',
      updatedAt: '2026-04-06T12:00:00.000Z',
    },
  );

  store.enrollments.push(
    {
      _id: newObjectId(),
      studentId: ids.student,
      courseId: ids.publishedCourse,
      progress: 25,
      lineNotify: false,
    },
    {
      _id: newObjectId(),
      studentId: ids.student,
      courseId: ids.enrolledDraftCourse,
      status: 'active',
      progress: 5,
      lineNotify: false,
    },
  );

  store.videoSegments.push(
    {
      _id: newObjectId(),
      segmentId: ids.segmentOne,
      chunkId: ids.segmentOne,
      courseId: ids.publishedCourse,
      videoId: ids.publishedVideoExternal,
      startSec: 12,
      endSec: 32,
      text: 'Node.js backend course explains JWT authentication and role based access control.',
      embedding: [],
    },
    {
      _id: newObjectId(),
      segmentId: ids.segmentTwo,
      chunkId: ids.segmentTwo,
      courseId: ids.publishedCourse,
      videoId: ids.publishedVideoExternal,
      startSec: 40,
      endSec: 58,
      text: 'This segment describes Express middleware and video upload processing status.',
      embedding: [],
    },
  );

  store.clips.push({
    _id: newObjectId(),
    segmentId: ids.segmentOne,
    courseId: ids.publishedCourse,
    clipUrl: 'https://clips.local/segment-one.mp4',
    jumpUrl: `https://videos.local/watch?v=${ids.publishedVideoExternal}&t=12`,
    keyPoints: ['JWT auth', 'RBAC'],
    hitCount: 0,
  });
}

async function startServer() {
  // Route tests boot the real Express app, but it talks only to stubbed models.
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

function createLineSignature(body) {
  return crypto
    .createHmac('sha256', env.lineChannelSecret)
    .update(body)
    .digest('base64');
}

async function jsonRequest(baseUrl, pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  let requestBody = body;

  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: requestHeaders,
    body: requestBody,
  });

  return {
    response,
    status: response.status,
    body: await response.json(),
  };
}

async function loginAs(baseUrl, email, password, role) {
  const requestedRole = role || store.users.find((user) => user.email === email)?.role;
  const result = await jsonRequest(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { email, password, role: requestedRole },
  });

  if (result.status !== 200) {
    throw new Error(`Login failed for ${email}: ${result.status}`);
  }

  return result.body.data.token;
}

async function postLineWebhook(baseUrl, payload, headers = {}) {
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);

  const response = await fetch(`${baseUrl}/api/v1/line/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: rawBody,
  });

  return {
    response,
    status: response.status,
    body: await response.json(),
    rawBody,
  };
}

function createVideoUploadForm({
  title = 'Test Upload Video',
  filename = `${TEST_UPLOAD_PREFIX}video.mp4`,
  type = 'video/mp4',
  contents = 'test video binary',
} = {}) {
  const formData = new FormData();
  formData.append('title', title);
  formData.append('video', new Blob([contents], { type }), filename);
  return formData;
}

function createVideoBatchUploadForm({ files, titles } = {}) {
  const entries = files || [
    { filename: `${TEST_UPLOAD_PREFIX}batch-1.mp4`, contents: 'batch video one' },
    { filename: `${TEST_UPLOAD_PREFIX}batch-2.mp4`, contents: 'batch video two' },
  ];
  const formData = new FormData();
  const normalizedTitles = titles || entries.map((entry, index) => entry.title || `Batch video ${index + 1}`);
  formData.append('titles', JSON.stringify(normalizedTitles));
  for (const entry of entries) {
    formData.append(
      'videos',
      new Blob([entry.contents || 'test video binary'], { type: entry.type || 'video/mp4' }),
      entry.filename,
    );
  }
  return formData;
}

function cleanupTestUploads() {
  if (!fs.existsSync(uploadsDir)) {
    return;
  }

  // Multer writes to disk during integration tests, so only remove test-tagged files.
  for (const entry of fs.readdirSync(uploadsDir)) {
    if (entry.includes(TEST_UPLOAD_PREFIX)) {
      fs.rmSync(path.join(uploadsDir, entry), { force: true });
    }
  }
}

function cleanupTestAvatars() {
  fs.rmSync(env.avatarUploadDir, {
    recursive: true,
    force: true,
  });
  fs.mkdirSync(env.avatarUploadDir, { recursive: true });
}

process.once('exit', () => {
  fs.rmSync(avatarTestRoot, {
    recursive: true,
    force: true,
  });
});

installModelStubs();
resetStore();
cleanupTestUploads();

module.exports = {
  env,
  ids,
  store,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  createLineSignature,
  jsonRequest,
  loginAs,
  postLineWebhook,
  createVideoUploadForm,
  createVideoBatchUploadForm,
  cleanupTestUploads,
  cleanupTestAvatars,
  createProcessingState,
};
