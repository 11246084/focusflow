const Course = require('../models/course.model');
const Video = require('../models/video.model');
const VideoSegment = require('../models/videoSegment.model');
const UsageLog = require('../models/usageLog.model');
const { USAGE_LOG_EVENTS } = require('../constants/enums');

async function getTeacherDashboardStats(user) {
  const courses = await Course.find({ teacherId: user.id });
  const courseIds = courses.map((c) => c._id);
  const courseMap = Object.fromEntries(courses.map((c) => [String(c._id), c.title]));

  const videos = await Video.find({ courseId: { $in: courseIds } }).sort({ updatedAt: -1 });

  const [segmentsCount, queriesCount] = await Promise.all([
    VideoSegment.countDocuments(),
    UsageLog.countDocuments({ event: USAGE_LOG_EVENTS.ASK, courseId: { $in: courseIds } }),
  ]);

  const recentVideos = videos.slice(0, 4).map((v) => ({
    id: String(v._id),
    title: v.title || v.file_name || '未命名',
    courseName: courseMap[String(v.courseId)] || '—',
    status: v.processing?.status || null,
    updatedAt: v.updatedAt,
  }));

  const topSegmentsAgg = await UsageLog.aggregate([
    {
      $match: {
        event: USAGE_LOG_EVENTS.ASK,
        courseId: { $in: courseIds },
        'metadata.topSegmentId': { $exists: true, $ne: null },
      },
    },
    { $group: { _id: '$metadata.topSegmentId', count: { $sum: 1 }, courseId: { $first: '$courseId' } } },
    { $sort: { count: -1 } },
    { $limit: 4 },
  ]);

  const topSegments = await Promise.all(
    topSegmentsAgg.map(async (item) => {
      const seg = await VideoSegment.findOne({ segmentId: item._id });
      return {
        segmentId: item._id,
        text: seg?.text ? seg.text.slice(0, 60) : item._id,
        courseName: courseMap[String(item.courseId)] || '—',
        count: item.count,
      };
    }),
  );

  return {
    coursesCount: courses.length,
    videosCount: videos.length,
    segmentsCount,
    queriesCount,
    recentVideos,
    topSegments,
  };
}

async function getStudentDashboardStats(user) {
  const mongoose = require('mongoose');
  const { COURSE_STATUSES } = require('../constants/enums');
  const Enrollment = require('../models/enrollment.model');

  // Get accessible courses (published + enrolled)
  const enrolledIds = await Enrollment.find({ userId: user.id }).distinct('courseId');
  const courses = await Course.find({
    $or: [{ status: COURSE_STATUSES.PUBLISHED }, { _id: { $in: enrolledIds } }],
  });
  const courseIds = courses.map((c) => c._id);
  const courseMap = Object.fromEntries(courses.map((c) => [String(c._id), c.title]));

  // Videos per course
  const allVideos = await Video.find({ courseId: { $in: courseIds } });
  const videosByCourse = {};
  for (const v of allVideos) {
    const key = String(v.courseId);
    if (!videosByCourse[key]) videosByCourse[key] = { total: 0, completed: 0 };
    videosByCourse[key].total += 1;
    if (v.processing?.status === 'completed') videosByCourse[key].completed += 1;
  }

  const courseList = courses.slice(0, 6).map((c) => {
    const counts = videosByCourse[String(c._id)] || { total: 0, completed: 0 };
    const prog = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
    return { id: String(c._id), title: c.title, videoCount: counts.total, completedVideos: counts.completed, progress: prog };
  });

  // Queries
  const userId = new mongoose.Types.ObjectId(user.id);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [totalQueries, weeklyQueries] = await Promise.all([
    UsageLog.countDocuments({ userId, event: USAGE_LOG_EVENTS.ASK }),
    UsageLog.countDocuments({ userId, event: USAGE_LOG_EVENTS.ASK, timestamp: { $gte: weekAgo } }),
  ]);

  // Recent queries
  const recentLogs = await UsageLog.find({ userId, event: USAGE_LOG_EVENTS.ASK })
    .sort({ timestamp: -1 })
    .limit(4);

  const recentQueries = recentLogs.map((log) => ({
    question: log.metadata?.question || '—',
    courseName: courseMap[String(log.courseId)] || '—',
    timestamp: log.timestamp,
    matched: (log.metadata?.matchCount || 0) > 0,
  }));

  return {
    coursesCount: courses.length,
    videosCount: allVideos.length,
    totalQueries,
    weeklyQueries,
    courseList,
    recentQueries,
  };
}

module.exports = { getTeacherDashboardStats, getStudentDashboardStats };
