const mongoose = require('mongoose');
const Course = require('../models/course.model');
const Video = require('../models/video.model');
const VideoSegment = require('../models/videoSegment.model');
const UsageLog = require('../models/usageLog.model');
const Question = require('../models/question.model');
const Enrollment = require('../models/enrollment.model');
const { USAGE_LOG_EVENTS } = require('../constants/enums');
const { isLikelyEncodingDamaged } = require('../utils/textEncoding');

function presentQuestionText(text) {
  if (isLikelyEncodingDamaged(text)) return '(編碼異常)';
  return text || '未知問題';
}

function getVideoTitle(video) {
  return video?.title || video?.fileName || video?.videoId || String(video?._id || '');
}

function getVideoSortTime(video) {
  return Date.parse(video?.createdAt || video?.processing?.queuedAt || video?.updatedAt || 0) || 0;
}

function sortVideosByRecency(videos) {
  return [...videos].sort((left, right) => getVideoSortTime(right) - getVideoSortTime(left));
}

function getCourseFallbackVideo(videos, courseId) {
  const courseKey = String(courseId || '');
  if (!courseKey) return null;

  const courseVideos = videos.filter((video) => String(video.courseId) === courseKey);
  return [...courseVideos].sort((left, right) => {
    const leftIsYouTube = left.sourceType === 'youtube' || left.youtubeVideoId;
    const rightIsYouTube = right.sourceType === 'youtube' || right.youtubeVideoId;

    if (leftIsYouTube !== rightIsYouTube) {
      return leftIsYouTube ? -1 : 1;
    }

    return getVideoSortTime(right) - getVideoSortTime(left);
  })[0] || null;
}

function mergeTopSegmentsByDisplayVideo(topSegments) {
  const grouped = new Map();

  for (const item of topSegments) {
    const groupKey = `${item.courseName}:${item.videoId || item.videoTitle || item.segmentId}`;
    const current = grouped.get(groupKey);

    if (!current) {
      grouped.set(groupKey, { ...item, segmentIds: [item.segmentId] });
      continue;
    }

    current.count += item.count;
    current.segmentIds.push(item.segmentId);
  }

  return [...grouped.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 4);
}

function parseSegmentIdentifier(segmentIdentifier) {
  const match = String(segmentIdentifier || '').match(/^(.+)_(chunk|seg)_(\d+)$/i);

  if (!match) {
    return null;
  }

  return {
    videoId: match[1],
    kind: match[2].toLowerCase(),
    index: match[3],
    chunkId: `chunk_${match[3]}`,
    segmentId: `${match[1]}_seg_${match[3]}`,
  };
}

async function findSegmentByUsageIdentifier(segmentIdentifier) {
  const parsed = parseSegmentIdentifier(segmentIdentifier);
  const lookupConditions = [
    { segmentId: segmentIdentifier },
    { chunkId: segmentIdentifier },
  ];

  if (parsed) {
    lookupConditions.push(
      { videoId: parsed.videoId, chunkId: parsed.chunkId },
      { videoId: parsed.videoId, segmentId: parsed.segmentId },
      { segmentId: `${parsed.videoId}_chunk_${parsed.index}` },
    );
  }

  return VideoSegment.findOne({ $or: lookupConditions });
}

async function findVideoForSegment(segment, fallbackVideoId = null) {
  const videoId = segment?.videoId || fallbackVideoId;

  if (!videoId) {
    return null;
  }

  const lookupConditions = [{ videoId }];

  if (mongoose.isValidObjectId(videoId)) {
    lookupConditions.unshift({ _id: videoId });
  }

  try {
    return await Video.findOne({ $or: lookupConditions });
  } catch {
    return Video.findOne({ videoId });
  }
}

async function getTeacherDashboardStats(user) {
  const courses = await Course.find({ teacherId: user.id });
  const courseIds = courses.map((course) => course._id);
  const courseMap = Object.fromEntries(courses.map((course) => [String(course._id), course.title]));

  const videos = sortVideosByRecency(await Video.find({ courseId: { $in: courseIds } }));

  const [segmentsCount, queriesCount] = await Promise.all([
    VideoSegment.countDocuments(),
    UsageLog.countDocuments({ event: USAGE_LOG_EVENTS.ASK, courseId: { $in: courseIds } }),
  ]);

  const recentVideos = videos.slice(0, 4).map((video) => ({
    id: String(video._id),
    title: video.title || video.fileName || '未命名影片',
    courseName: courseMap[String(video.courseId)] || '未知課程',
    status: video.processing?.status || null,
    updatedAt: video.updatedAt,
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
    { $limit: 20 },
  ]);

  const topSegments = mergeTopSegmentsByDisplayVideo(await Promise.all(
    topSegmentsAgg.map(async (item) => {
      const parsed = parseSegmentIdentifier(item._id);
      const segment = await findSegmentByUsageIdentifier(item._id);
      const video = await findVideoForSegment(segment, parsed?.videoId);
      const displayVideo = video || getCourseFallbackVideo(videos, item.courseId);

      return {
        segmentId: item._id,
        text: segment?.text ? segment.text.slice(0, 120) : null,
        videoId: displayVideo?._id ? String(displayVideo._id) : (segment?.videoId || parsed?.videoId || null),
        videoTitle: getVideoTitle(displayVideo) || '(已刪除影片)',
        startSec: segment?.startSec ?? null,
        endSec: segment?.endSec ?? null,
        courseName: courseMap[String(item.courseId)] || '未知課程',
        count: item.count,
      };
    }),
  ));

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
  const enrollments = await Enrollment.find({ studentId: user.id });
  const enrollmentProgressByCourse = Object.fromEntries(
    enrollments.map((enrollment) => [String(enrollment.courseId), enrollment.progress || 0]),
  );
  const courses = await Course.find({ status: 'published' });
  const courseIds = courses.map((course) => course._id);
  const courseMap = Object.fromEntries(courses.map((course) => [String(course._id), course.title]));

  const allVideos = await Video.find({ courseId: { $in: courseIds } });
  const videosByCourse = {};

  for (const video of allVideos) {
    const key = String(video.courseId);
    if (!videosByCourse[key]) videosByCourse[key] = { total: 0, completed: 0 };
    videosByCourse[key].total += 1;
    if (video.processing?.status === 'completed') videosByCourse[key].completed += 1;
  }

  const courseList = courses.slice(0, 6).map((course) => {
    const counts = videosByCourse[String(course._id)] || { total: 0, completed: 0 };
    const storedProgress = enrollmentProgressByCourse[String(course._id)];
    const progress = storedProgress !== undefined
      ? Math.round(storedProgress)
      : (counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0);

    return {
      id: String(course._id),
      title: course.title,
      videoCount: counts.total,
      completedVideos: counts.completed,
      progress,
    };
  });

  const userId = new mongoose.Types.ObjectId(user.id);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const visibleQuestionFilter = {
    userId,
    source: { $in: ['api', 'line'] },
  };

  const [totalQueries, weeklyQueries, answeredQueries] = await Promise.all([
    Question.countDocuments(visibleQuestionFilter),
    Question.countDocuments({ ...visibleQuestionFilter, askedAt: { $gte: weekAgo } }),
    Question.countDocuments({ ...visibleQuestionFilter, status: 'answered' }),
  ]);

  const recentQuestions = await Question.find(visibleQuestionFilter)
    .sort({ askedAt: -1 })
    .limit(4);

  const recentQueries = recentQuestions.map((item) => ({
    id: String(item._id),
    question: presentQuestionText(item.question),
    courseName: courseMap[String(item.courseId)] || '未知課程',
    timestamp: item.askedAt,
    matched: item.status === 'answered' || item.matchCount > 0,
    source: item.source,
    status: item.status,
  }));

  const avgProgress = courseList.length
    ? Math.round(courseList.reduce((sum, course) => sum + course.progress, 0) / courseList.length)
    : 0;
  const answerRate = totalQueries > 0 ? Math.round((answeredQueries / totalQueries) * 100) : 0;

  return {
    coursesCount: courses.length,
    videosCount: allVideos.length,
    totalQueries,
    weeklyQueries,
    avgProgress,
    answerRate,
    courseList,
    recentQueries,
  };
}

module.exports = { getTeacherDashboardStats, getStudentDashboardStats };
