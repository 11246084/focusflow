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
    // 已下架內容以課程為單位合併成一列，避免多個孤兒 segment 佔滿版面。
    const groupKey = item.contentMissing
      ? `${item.courseName}:__content_missing__`
      : `${item.courseName}:${item.videoId || item.videoTitle || item.segmentId}`;
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
  const courses = await Course.find({ teacherId: user.id }).lean();
  const courseIds = courses.map((course) => course._id);
  const courseMap = Object.fromEntries(courses.map((course) => [String(course._id), course.title]));

  // 平行抓 4 條互不相依的資料（皆只依賴 courseIds）
  const [rawVideos, segmentsCount, queriesCount, topSegmentsAgg] = await Promise.all([
    Video.find({ courseId: { $in: courseIds } }).lean(),
    VideoSegment.countDocuments(),
    UsageLog.countDocuments({ event: USAGE_LOG_EVENTS.ASK, courseId: { $in: courseIds } }),
    UsageLog.aggregate([
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
    ]),
  ]);
  const videos = sortVideosByRecency(rawVideos);

  const recentVideos = videos.slice(0, 4).map((video) => ({
    id: String(video._id),
    title: video.title || video.fileName || '未命名影片',
    courseName: courseMap[String(video.courseId)] || '未知課程',
    status: video.processing?.status || null,
    updatedAt: video.updatedAt,
  }));

  // Top Segments 是「該補強什麼」的 actionable 列表。
  // 指向已刪除影片的歷史紀錄優先 fallback 到該課程現存影片；課程已無現存影片時
  // 不能整列丟掉（會讓整個課程從統計消失），改標 contentMissing 讓前端顯示「內容已下架」。
  const rawTopSegments = await Promise.all(
    topSegmentsAgg.map(async (item) => {
      const parsed = parseSegmentIdentifier(item._id);
      const segment = await findSegmentByUsageIdentifier(item._id);
      const video = await findVideoForSegment(segment, parsed?.videoId);
      const displayVideo = video || getCourseFallbackVideo(videos, item.courseId);

      return {
        segmentId: item._id,
        text: segment?.text ? segment.text.slice(0, 120) : null,
        videoId: displayVideo ? String(displayVideo._id) : null,
        videoTitle: displayVideo ? getVideoTitle(displayVideo) : null,
        contentMissing: !displayVideo,
        startSec: segment?.startSec ?? null,
        endSec: segment?.endSec ?? null,
        courseName: courseMap[String(item.courseId)] || '未知課程',
        count: item.count,
      };
    }),
  );
  const topSegments = mergeTopSegmentsByDisplayVideo(rawTopSegments);

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
  const userId = new mongoose.Types.ObjectId(user.id);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const visibleQuestionFilter = {
    userId,
    source: { $in: ['api', 'line'] },
  };

  // Round 1: 平行抓 6 條互不相依的資料（原本散在 5 次 await，~700-900ms → ~150-200ms）
  const [enrollments, publishedCourses, totalQueries, weeklyQueries, answeredQueries, recentQuestions] = await Promise.all([
    Enrollment.find({ studentId: user.id }).lean(),
    Course.find({ status: 'published' }).lean(),
    Question.countDocuments(visibleQuestionFilter),
    Question.countDocuments({ ...visibleQuestionFilter, askedAt: { $gte: weekAgo } }),
    Question.countDocuments({ ...visibleQuestionFilter, status: 'answered' }),
    Question.find(visibleQuestionFilter).sort({ askedAt: -1 }).limit(4).lean(),
  ]);

  const enrolledCourseIds = new Set(enrollments.map((enrollment) => String(enrollment.courseId)));
  // Dashboard counters describe the student's enrolled learning activity, not the public catalog.
  const courses = publishedCourses.filter((course) => enrolledCourseIds.has(String(course._id)));
  const courseIds = courses.map((course) => course._id);
  const courseMap = Object.fromEntries(courses.map((course) => [String(course._id), course.title]));
  const enrollmentByCourse = Object.fromEntries(
    enrollments.map((enrollment) => [String(enrollment.courseId), enrollment]),
  );

  // Round 2: 平行抓 allVideos（依賴 courseIds）+ 查 recentQuestions 引用的 video 是否還存在
  const segmentRefVideoIds = recentQuestions
    .map((q) => parseSegmentIdentifier(q.topSegmentId)?.videoId)
    .filter(Boolean);
  const validObjectIds = segmentRefVideoIds.filter((vid) => mongoose.isValidObjectId(vid));

  const [allVideos, liveVideosForRecent] = await Promise.all([
    Video.find({ courseId: { $in: courseIds } }).lean(),
    validObjectIds.length
      ? Video.find({ _id: { $in: validObjectIds } }).select('_id').lean()
      : Promise.resolve([]),
  ]);

  const liveVideoIds = new Set(liveVideosForRecent.map((v) => String(v._id)));

  const videosByCourse = {};
  for (const video of allVideos) {
    const key = String(video.courseId);
    if (!videosByCourse[key]) videosByCourse[key] = { ids: [], completed: 0 };
    videosByCourse[key].ids.push(String(video._id));
    if (video.processing?.status === 'completed') videosByCourse[key].completed += 1;
  }

  const courseList = courses.slice(0, 6).map((course) => {
    const courseKey = String(course._id);
    const counts = videosByCourse[courseKey] || { ids: [], completed: 0 };
    // 影片集合 = 主課程影片 ∪ 掛載影片，與 markVideoWatched 的分母一致。
    const courseVideoIdSet = new Set([
      ...counts.ids,
      ...(course.videoIds || []).map(String),
    ]);
    const enrollment = enrollmentByCourse[courseKey];
    const watchedIds = (enrollment?.watchedVideoIds || []).map(String);

    let progress;
    if (enrollment) {
      // 有觀看紀錄就即時重算，避免舊資料存到過期的 progress 而顯示 0%；
      // 舊 enrollment 只有 progress 數值時沿用儲存值。
      progress = watchedIds.length && courseVideoIdSet.size
        ? Math.min(100, Math.round(
          (watchedIds.filter((id) => courseVideoIdSet.has(id)).length / courseVideoIdSet.size) * 100,
        ))
        : Math.round(enrollment.progress || 0);
    } else {
      progress = courseVideoIdSet.size > 0
        ? Math.round((counts.completed / courseVideoIdSet.size) * 100)
        : 0;
    }

    return {
      id: courseKey,
      title: course.title,
      videoCount: courseVideoIdSet.size,
      completedVideos: counts.completed,
      progress,
    };
  });

  const recentQueries = recentQuestions.map((item) => {
    const refVideoId = parseSegmentIdentifier(item.topSegmentId)?.videoId;
    const contentMissing = Boolean(refVideoId) && !liveVideoIds.has(refVideoId);
    const matched = !contentMissing && (item.status === 'answered' || item.matchCount > 0);

    return {
      id: String(item._id),
      question: presentQuestionText(item.question),
      courseName: courseMap[String(item.courseId)] || '未知課程',
      timestamp: item.askedAt,
      matched,
      contentMissing,
      source: item.source,
      status: item.status,
    };
  });

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
