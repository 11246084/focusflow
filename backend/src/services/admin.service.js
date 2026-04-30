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
    const segKey = v.video_id || String(v._id);
    return {
      id: String(v._id),
      title: v.title || v.file_name || 'Untitled',
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

  return logs.map(l => ({
    id: String(l._id),
    event: l.event,
    user: l.userId ? (userMap[String(l.userId)]?.name || '—') : '—',
    course: l.courseId ? (courseMap[String(l.courseId)]?.title || '—') : '—',
    durationSec: l.durationSec || null,
    timestamp: l.timestamp || l.createdAt,
  }));
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

  // Delete associated VideoSegments (linked by video_id string or _id string)
  const segmentKey = video.video_id || String(video._id);
  await VideoSegment.deleteMany({ videoId: segmentKey });
  await mongoose.connection.db.collection('transcripts_normalized').deleteMany({ video_id: segmentKey });

  // Hard delete the video document
  await Video.deleteOne({ _id: videoId });

  return { deletedVideoId: videoId, segmentKey };
}

module.exports = { getStats, listUsers, updateUser, listVideos, getRecentEvents, getEventStats, deleteVideo };
