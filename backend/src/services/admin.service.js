const User = require('../models/user.model');
const Course = require('../models/course.model');
const Video = require('../models/video.model');
const VideoSegment = require('../models/videoSegment.model');
const UsageLog = require('../models/usageLog.model');
const Enrollment = require('../models/enrollment.model');
const env = require('../config/env');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { isLocalVideoSourceAvailable } = require('../utils/localVideoSource');
const { USER_ROLES, USER_ROLE_VALUES } = require('../constants/enums');
const videoService = require('./video.service');
const { buildActiveEnrollmentFilter } = require('./courseAccess.service');

async function getStats() {
  const [
    totalUsers, totalVideos, totalSegments, totalQueries,
    studentCount, teacherCount, adminCount, lineBindCount,
  ] = await Promise.all([
    User.countDocuments({}),
    Video.countDocuments({ deletedAt: null }),
    VideoSegment.countDocuments({}),
    UsageLog.countDocuments({ event: 'ask' }),
    User.countDocuments({ role: USER_ROLES.STUDENT }),
    User.countDocuments({ role: USER_ROLES.TEACHER }),
    User.countDocuments({ role: USER_ROLES.ADMIN }),
    User.countDocuments({ lineUserId: { $ne: null } }),
  ]);

  return {
    totalUsers,
    totalVideos,
    totalSegments,
    totalQueries,
    studentCount,
    teacherCount,
    adminCount,
    lineBindCount,
    lineBindRate: totalUsers > 0 ? Math.round((lineBindCount / totalUsers) * 100) : 0,
  };
}

async function listUsers() {
  const users = await User.find({}).sort({ createdAt: -1 }).lean();

  const [enrollCounts, queryCounts] = await Promise.all([
    // Enrollment ownership is stored in studentId; userId belongs to usage records.
    Enrollment.aggregate([
      { $match: buildActiveEnrollmentFilter() },
      { $group: { _id: '$studentId', count: { $sum: 1 } } },
    ]),
    UsageLog.aggregate([{ $match: { event: 'ask' } }, { $group: { _id: '$userId', count: { $sum: 1 } } }]),
  ]);

  const enrollMap = {};
  for (const e of enrollCounts) enrollMap[String(e._id)] = e.count;
  const queryMap = {};
  for (const q of queryCounts) queryMap[String(q._id)] = q.count;

  return users.map(u => ({
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive !== false,
    isLineBound: Boolean(u.lineUserId),
    dailyAskLimitOverride: toDailyAskLimitOverride(u.dailyAskLimitOverride),
    courses: enrollMap[String(u._id)] || 0,
    queries: queryMap[String(u._id)] || 0,
    createdAt: u.createdAt,
  }));
}

const MAX_DAILY_ASK_LIMIT_OVERRIDE = 1000;

function toDailyAskLimitOverride(value) {
  return Number.isInteger(value) ? value : null;
}

function getDefaultDailyAskLimit() {
  return env.qaDailyAskLimitPerStudent;
}

// null = 跟隨全站預設；0 = 不限；1..MAX = 自訂每日次數。
function parseDailyAskLimitOverride(value) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > MAX_DAILY_ASK_LIMIT_OVERRIDE) {
    throw new AppError(
      `dailyAskLimitOverride must be null or an integer between 0 and ${MAX_DAILY_ASK_LIMIT_OVERRIDE}.`,
      400,
      'VALIDATION_ERROR',
    );
  }
  return value;
}

let userUpdateQueue = Promise.resolve();
// Single PM2 process: serialize role/activation edits and re-check the actor.
// Multi-process deployment requires a database-backed invariant/lock.
async function updateUser(userId, fields, actor, authorizePromotion) {
  const operation = userUpdateQueue.then(() => updateUserSerial(userId, fields, actor, authorizePromotion));
  userUpdateQueue = operation.catch(() => {});
  return operation;
}
async function updateUserSerial(userId, { name, role, isActive, dailyAskLimitOverride }, actor, authorizePromotion) {
  assertObjectId(userId, 'user');

  const update = {};
  if (name !== undefined) {
    if (typeof name !== 'string') throw new AppError('Name must be a string.', 400, 'VALIDATION_ERROR');
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('Name cannot be empty.', 400, 'VALIDATION_ERROR');
    update.name = trimmed;
  }
  if (role !== undefined) {
    if (!USER_ROLE_VALUES.includes(role)) throw new AppError('Invalid role.', 400, 'VALIDATION_ERROR');
    update.role = role;
  }
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') throw new AppError('isActive must be a boolean.', 400, 'VALIDATION_ERROR');
    update.isActive = isActive;
  }
  if (dailyAskLimitOverride !== undefined) {
    update.dailyAskLimitOverride = parseDailyAskLimitOverride(dailyAskLimitOverride);
  }

  if (Object.keys(update).length === 0) {
    throw new AppError('No fields to update.', 400, 'VALIDATION_ERROR');
  }

  const existing = await User.findById(userId);
  if (!existing) throw new AppError('User not found.', 404, 'NOT_FOUND');
  // Check the actual transition inside the serialized update. An unchanged
  // admin role (for example editing a name) is not an elevation of privilege.
  const promotingToAdmin = role === 'admin' && existing.role !== 'admin';
  if (promotingToAdmin) {
    if (typeof authorizePromotion !== 'function') throw new AppError('Please re-enter your password.', 403, 'STEP_UP_REQUIRED');
    authorizePromotion();
  }
  if (actor) {
    const currentActor = await User.findById(actor.id);
    if (!currentActor || currentActor.role !== 'admin' || currentActor.isActive === false) throw new AppError('Admin required.', 403, 'FORBIDDEN');
    if (String(actor.id) === String(userId) && (isActive === false || (role !== undefined && role !== 'admin'))) {
      throw new AppError('Cannot disable or demote yourself.', 400, 'SELF_ADMIN_CHANGE_FORBIDDEN');
    }
  }
  if (existing.role === 'admin' && existing.isActive !== false && (isActive === false || (role && role !== 'admin'))
    && await User.countDocuments({ role: 'admin', isActive: true }) <= 1) {
    throw new AppError('At least one active admin is required.', 409, 'LAST_ADMIN_REQUIRED');
  }
  const rank = { student: 0, teacher: 1, admin: 2 };
  // A former 7-day session must never inherit admin privileges or bypass MFA.
  // revokeAll persists the new role and version atomically before deleting sids.
  const revoke = promotingToAdmin || isActive === false || (role && rank[role] < rank[existing.role]);
  const user = revoke
    ? await require('./authTokens.service').revokeAll(userId, { $set: update })
    : await User.findByIdAndUpdate(userId, { $set: update }, { new: true });
  if (!user) throw new AppError('User not found.', 404, 'NOT_FOUND');

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive !== false,
    isLineBound: Boolean(user.lineUserId),
    dailyAskLimitOverride: toDailyAskLimitOverride(user.dailyAskLimitOverride),
    createdAt: user.createdAt,
  };
}

async function listVideos() {
  const videos = await Video.find({ deletedAt: null }).sort({ createdAt: -1 }).lean();

  const courseIds = [...new Set(videos.map(v => v.courseId).filter(Boolean).map(String))];
  const courses = await Course.find({ _id: { $in: courseIds } }).lean();
  const courseMap = {};
  for (const c of courses) courseMap[String(c._id)] = c;

  const teacherIds = [...new Set(courses.map(c => c.teacherId).filter(Boolean).map(String))];
  const teachers = await User.find({ _id: { $in: teacherIds } }).lean();
  const teacherMap = {};
  for (const t of teachers) teacherMap[String(t._id)] = t;

  const segCounts = await VideoSegment.aggregate([
    { $group: { _id: '$videoId', count: { $sum: 1 } } },
  ]);
  const segMap = {};
  for (const s of segCounts) segMap[String(s._id)] = s.count;

  return videos.map(v => {
    const course = v.courseId ? courseMap[String(v.courseId)] : null;
    const teacher = course?.teacherId ? teacherMap[String(course.teacherId)] : null;
    const segKey = v.videoId || String(v._id);
    const appOwned = Video.isAppOwnedRecord(v);
    return {
      id: String(v._id),
      title: v.title || v.fileName || 'Untitled',
      course: course?.title || '—',
      teacher: teacher?.name || '—',
      status: v.processing?.status || 'pending',
      segments: segMap[segKey] || 0,
      createdAt: v.createdAt,
      // 原片狀態（decisions.md #21、#23）：管理員影片頁據此標示「原片已清理」並提供補回原片，
      // 判斷與課程影片清單相同；只有 localCleanupAt 有值的才是清理流程刪掉的。
      metadataOnly: !appOwned,
      sourceAvailable: appOwned && isLocalVideoSourceAvailable(v.filePath),
      youtubeUpload: {
        status: v.youtubeUpload?.status || null,
        waitReason: v.youtubeUpload?.waitReason || null,
        nextRetryAt: v.youtubeUpload?.nextRetryAt || null,
        remoteState: v.youtubeUpload?.remoteState || null,
        blockedReason: v.youtubeUpload?.blockedReason || null,
        localCleanupAt: v.youtubeUpload?.localCleanupAt || null,
      },
    };
  });
}

async function getRecentEvents(limit = 20) {
  const logs = await UsageLog.find({}).sort({ timestamp: -1 }).limit(limit).lean();

  const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean).map(String))];
  const courseIds = [...new Set(logs.map(l => l.courseId).filter(Boolean).map(String))];

  const [users, courses] = await Promise.all([
    User.find({ _id: { $in: userIds } }).lean(),
    Course.find({ _id: { $in: courseIds } }).lean(),
  ]);

  const userMap = {};
  for (const u of users) userMap[String(u._id)] = u;
  const courseMap = {};
  for (const c of courses) courseMap[String(c._id)] = c;

  // 解析 segmentId 中的 videoId pattern，批次查 Video 是否還存在 → 標記「內容已下架」
  const SEGMENT_PATTERN = /^([a-f0-9]{24})_(chunk|seg)_\d+$/i;
  const referencedVideoIds = new Set();
  for (const l of logs) {
    for (const sid of [l.metadata?.topSegmentId, l.metadata?.segmentId]) {
      const m = String(sid || '').match(SEGMENT_PATTERN);
      if (m) referencedVideoIds.add(m[1]);
    }
  }
  const liveVideoIds = new Set();
  if (referencedVideoIds.size) {
    const liveVideos = await Video.find({ _id: { $in: [...referencedVideoIds] } }).select('_id').lean();
    for (const v of liveVideos) liveVideoIds.add(String(v._id));
  }
  const isContentMissing = (log) => {
    for (const sid of [log.metadata?.topSegmentId, log.metadata?.segmentId]) {
      const m = String(sid || '').match(SEGMENT_PATTERN);
      if (m && !liveVideoIds.has(m[1])) return true;
    }
    return false;
  };

  return logs.map(l => {
    const courseExists = l.courseId ? Boolean(courseMap[String(l.courseId)]) : true;
    return {
      id: String(l._id),
      event: l.event,
      user: l.userId ? (userMap[String(l.userId)]?.name || '—') : '—',
      course: l.courseId ? (courseMap[String(l.courseId)]?.title || '(已刪除課程)') : '—',
      courseDeleted: !courseExists,
      contentMissing: isContentMissing(l),
      durationSec: l.durationSec || null,
      timestamp: l.timestamp || l.createdAt,
    };
  });
}

async function getEventStats() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const counts = await UsageLog.aggregate([
    { $match: { timestamp: { $gte: startOfMonth } } },
    { $group: { _id: '$event', count: { $sum: 1 } } },
  ]);

  const result = {};
  for (const c of counts) result[c._id] = c.count;
  return result;
}

async function deleteVideo(videoId) {
  return videoService.deleteVideo(videoId, {
    id: null,
    role: USER_ROLES.ADMIN,
  });
}

module.exports = { getStats, listUsers, updateUser, getDefaultDailyAskLimit, listVideos, getRecentEvents, getEventStats, deleteVideo };
