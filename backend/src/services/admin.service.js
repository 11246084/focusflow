const mongoose = require('mongoose');
const User = require('../models/user.model');
const Course = require('../models/course.model');
const Video = require('../models/video.model');
const VideoSegment = require('../models/videoSegment.model');
const UsageLog = require('../models/usageLog.model');
const Enrollment = require('../models/enrollment.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { USER_ROLES, USER_ROLE_VALUES } = require('../constants/enums');

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
    Enrollment.aggregate([{ $group: { _id: '$userId', count: { $sum: 1 } } }]),
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
    lineUserId: u.lineUserId || null,
    courses: enrollMap[String(u._id)] || 0,
    queries: queryMap[String(u._id)] || 0,
    createdAt: u.createdAt,
  }));
}

async function updateUser(userId, { name, role, isActive }) {
  assertObjectId(userId, 'user');

  const update = {};
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) throw new AppError('Name cannot be empty.', 400, 'VALIDATION_ERROR');
    update.name = trimmed;
  }
  if (role !== undefined) {
    if (!USER_ROLE_VALUES.includes(role)) throw new AppError('Invalid role.', 400, 'VALIDATION_ERROR');
    update.role = role;
  }
  if (isActive !== undefined) update.isActive = Boolean(isActive);

  if (Object.keys(update).length === 0) {
    throw new AppError('No fields to update.', 400, 'VALIDATION_ERROR');
  }

  const user = await User.findByIdAndUpdate(userId, update, { new: true }).lean();
  if (!user) throw new AppError('User not found.', 404, 'NOT_FOUND');

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive !== false,
    lineUserId: user.lineUserId || null,
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
    return {
      id: String(v._id),
      title: v.title || v.fileName || 'Untitled',
      course: course?.title || '—',
      teacher: teacher?.name || '—',
      status: v.processing?.status || 'pending',
      segments: segMap[segKey] || 0,
      createdAt: v.createdAt,
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
  assertObjectId(videoId, 'video');

  const video = await Video.findById(videoId).lean();
  if (!video) throw new AppError('Video not found.', 404, 'VIDEO_NOT_FOUND');

  // 設計決策：UsageLog / Question 屬於歷史紀錄，不隨影片刪除一起清。
  const segmentKey = video.videoId || String(video._id);
  await VideoSegment.deleteMany({ videoId: segmentKey });
  await mongoose.connection.db.collection('transcripts_normalized').deleteMany({ video_id: segmentKey });
  await Video.deleteOne({ _id: videoId });
  if (video.courseId) {
    await Course.findByIdAndUpdate(video.courseId, { $pull: { videoIds: video._id } });
  }

  return { deletedVideoId: videoId, segmentKey };
}

module.exports = { getStats, listUsers, updateUser, listVideos, getRecentEvents, getEventStats, deleteVideo };
