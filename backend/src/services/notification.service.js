const mongoose = require('mongoose');
const Notification = require('../models/notification.model');
const Course = require('../models/course.model');
const Enrollment = require('../models/enrollment.model');
const { buildActiveEnrollmentFilter } = require('./courseAccess.service');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { NOTIFICATION_SOURCES, USER_ROLES } = require('../constants/enums');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function toPublicNotification(notification) {
  const source = typeof notification?.toObject === 'function'
    ? notification.toObject()
    : notification;

  return {
    id: String(source._id),
    source: source.source,
    title: source.title,
    content: source.content,
    urgent: Boolean(source.urgent),
    read: Boolean(source.readAt),
    readAt: source.readAt || null,
    courseIds: (source.courseIds || []).map(String),
    videoId: source.videoId ? String(source.videoId) : null,
    scriptId: source.scriptId ? String(source.scriptId) : null,
    createdAt: source.createdAt,
  };
}

function encodeCursor(notification) {
  // The _id tie-breaker keeps pagination stable when multiple notifications share a timestamp.
  return Buffer.from(JSON.stringify({
    createdAt: new Date(notification.createdAt).toISOString(),
    id: String(notification._id),
  })).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const createdAt = new Date(parsed.createdAt);

    if (
      !parsed.id
      || !mongoose.isValidObjectId(parsed.id)
      || Number.isNaN(createdAt.getTime())
    ) {
      throw new Error('Invalid cursor payload.');
    }

    return {
      createdAt,
      id: parsed.id,
    };
  } catch {
    throw new AppError('Invalid notification cursor.', 400, 'VALIDATION_ERROR');
  }
}

async function listNotifications({
  recipientId,
  limit = DEFAULT_LIMIT,
  cursor,
  unreadOnly = false,
}) {
  assertObjectId(recipientId, 'recipient');

  const query = { recipientId };
  if (unreadOnly) {
    query.readAt = null;
  }

  if (cursor) {
    const decoded = decodeCursor(cursor);
    query.$or = [
      { createdAt: { $lt: decoded.createdAt } },
      {
        createdAt: decoded.createdAt,
        _id: { $lt: decoded.id },
      },
    ];
  }

  const [items, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    Notification.countDocuments({
      recipientId,
      readAt: null,
    }),
  ]);

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  return {
    notifications: page.map(toPublicNotification),
    unreadCount,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  };
}

async function markNotificationRead({ notificationId, recipientId }) {
  assertObjectId(notificationId, 'notification');
  assertObjectId(recipientId, 'recipient');

  // Scope the write to its recipient and unread state for ownership safety and idempotency.
  let notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      recipientId,
      readAt: null,
    },
    {
      $set: {
        readAt: new Date(),
      },
    },
    { new: true },
  );

  if (!notification) {
    notification = await Notification.findOne({
      _id: notificationId,
      recipientId,
    });
  }

  if (!notification) {
    throw new AppError('Notification not found.', 404, 'NOTIFICATION_NOT_FOUND');
  }

  return toPublicNotification(notification);
}

async function markAllNotificationsRead(recipientId) {
  assertObjectId(recipientId, 'recipient');

  const result = await Notification.updateMany(
    {
      recipientId,
      readAt: null,
    },
    {
      $set: {
        readAt: new Date(),
      },
    },
  );

  return {
    updatedCount: result.modifiedCount ?? result.nModified ?? 0,
  };
}

async function broadcastSystemNotification({
  createdBy,
  title,
  content,
  urgent = false,
}) {
  assertObjectId(createdBy, 'creator');

  // System broadcasts intentionally target active students only.
  const recipients = await User.find({
    role: USER_ROLES.STUDENT,
    isActive: true,
  })
    .select('_id')
    .lean();

  if (recipients.length) {
    await Notification.insertMany(recipients.map((recipient) => ({
      recipientId: recipient._id,
      source: NOTIFICATION_SOURCES.SYSTEM_MAINTENANCE,
      title,
      content,
      urgent,
      readAt: null,
      createdBy,
      courseIds: [],
      videoId: null,
    })));
  }

  return {
    recipientCount: recipients.length,
    summary: {
      source: NOTIFICATION_SOURCES.SYSTEM_MAINTENANCE,
      title,
      content,
      urgent,
    },
  };
}

function truncate(value, maximum) {
  return String(value || '').slice(0, maximum);
}

function hasWriteConcernError(error) {
  const result = error?.result;
  const candidates = [
    error,
    result,
    result?.result,
  ];

  for (const candidate of candidates) {
    if (candidate?.writeConcernError) {
      return true;
    }
    if (
      Array.isArray(candidate?.writeConcernErrors)
      && candidate.writeConcernErrors.length > 0
    ) {
      return true;
    }
  }

  if (typeof result?.getWriteConcernError === 'function') {
    try {
      return Boolean(result.getWriteConcernError());
    } catch {
      // An unreadable write-concern result cannot prove durable success.
      return true;
    }
  }

  return false;
}

async function fanoutVideoCompletedNotifications(video) {
  const videoId = String(video?._id || '');
  assertObjectId(videoId, 'video');

  const primaryCourseId = video?.courseId?._id || video?.courseId;
  const courseQuery = {
    $or: [
      ...(primaryCourseId ? [{ _id: primaryCourseId }] : []),
      { videoIds: videoId },
    ],
  };
  const courses = await Course.find(courseQuery).select('_id').lean();
  // A shared video can reach the same student through several courses; fan out once per recipient.
  const courseIds = [...new Set(courses.map((course) => String(course._id)))];

  if (!courseIds.length) {
    return {
      recipientCount: 0,
      createdCount: 0,
    };
  }

  const enrollments = await Enrollment.find(buildActiveEnrollmentFilter({
    courseId: { $in: courseIds },
  }))
    .select('studentId courseId')
    .lean();
  const enrolledStudentIds = [...new Set(
    enrollments.map((enrollment) => String(enrollment.studentId)),
  )];

  if (!enrolledStudentIds.length) {
    return {
      recipientCount: 0,
      createdCount: 0,
    };
  }

  const activeStudents = await User.find({
    _id: { $in: enrolledStudentIds },
    role: USER_ROLES.STUDENT,
    isActive: true,
  })
    .select('_id')
    .lean();
  const activeStudentIds = new Set(activeStudents.map((student) => String(student._id)));
  const coursesByStudent = new Map();

  for (const enrollment of enrollments) {
    const studentId = String(enrollment.studentId);
    if (!activeStudentIds.has(studentId)) continue;

    if (!coursesByStudent.has(studentId)) {
      coursesByStudent.set(studentId, new Set());
    }
    coursesByStudent.get(studentId).add(String(enrollment.courseId));
  }

  const dedupeKey = `video_completed:${videoId}`;
  const videoTitle = String(video.title || '教學影片').trim() || '教學影片';
  const title = truncate(`影片處理完成：${videoTitle}`, 120);
  const content = truncate(`「${videoTitle}」已完成處理，現在可以觀看。`, 2000);
  const operations = [...coursesByStudent.entries()].map(([recipientId, recipientCourseIds]) => ({
    updateOne: {
      filter: {
        recipientId,
        dedupeKey,
      },
      update: {
        $setOnInsert: {
          recipientId,
          source: NOTIFICATION_SOURCES.VIDEO_COMPLETED,
          title,
          content,
          urgent: false,
          readAt: null,
          createdBy: null,
          courseIds: [...recipientCourseIds].sort(),
          videoId,
          dedupeKey,
        },
      },
      upsert: true,
    },
  }));

  if (!operations.length) {
    return {
      recipientCount: 0,
      createdCount: 0,
    };
  }

  let result;
  try {
    result = await Notification.bulkWrite(operations, { ordered: false });
  } catch (error) {
    const writeErrors = Array.isArray(error?.writeErrors) ? error.writeErrors : [];
    const writeErrorCode = (writeError) => writeError?.code ?? writeError?.err?.code;
    const duplicateOnly = writeErrors.length
      ? writeErrors.every((writeError) => writeErrorCode(writeError) === 11000)
      : error?.code === 11000;

    // Concurrent completed-webhook deliveries can both miss the document and
    // race on the unique dedupe index. If every write error is E11000, the
    // other writer already established the desired idempotent state.
    if (!duplicateOnly || hasWriteConcernError(error)) {
      const fanoutError = new AppError(
        'Notification fanout failed.',
        500,
        'NOTIFICATION_FANOUT_FAILED',
      );
      fanoutError.cause = error;
      throw fanoutError;
    }

    result = error?.result || {};
  }

  return {
    recipientCount: operations.length,
    createdCount: result.upsertedCount ?? 0,
  };
}

const REVIEW_REASON_LABELS = {
  contentIncorrect: '內容不正確',
  audioIssue: '聲音問題',
  visualQuality: '畫面品質問題',
  subtitleIssue: '字幕問題',
  incomplete: '內容不完整',
  other: '其他',
};

// Tell the script owner (falling back to the course owner) that a generated
// short was rejected, with a scriptId so the client can jump straight to it.
// Deduped per asset generation so a retried review cannot notify twice.
async function notifyShortAssetRejected({ asset, script, reasons = [] }) {
  const course = await Course.findById(asset.courseId).select('_id teacherId').lean();
  const recipientId = script?.createdBy || course?.teacherId;
  if (!recipientId) return null;

  const reasonText = reasons
    .map((reason) => (reason.note
      ? `${REVIEW_REASON_LABELS[reason.code] || reason.code}（${reason.note}）`
      : REVIEW_REASON_LABELS[reason.code] || reason.code))
    .join('、');
  const assetTitle = String(asset.title || script?.topic || '短影片').trim() || '短影片';
  const generationVersion = asset.generationVersion || 1;
  const dedupeKey = `short_asset_rejected:${asset._id}:${generationVersion}`;

  try {
    return await Notification.create({
      recipientId,
      source: NOTIFICATION_SOURCES.SHORT_ASSET_REJECTED,
      title: truncate(`短影片未通過審核：${assetTitle}`, 120),
      content: truncate(
        `不通過理由：${reasonText || '未提供'}。點擊前往腳本頁重新生成。`,
        2000,
      ),
      urgent: false,
      readAt: null,
      createdBy: null,
      courseIds: [asset.courseId],
      videoId: null,
      scriptId: script?._id || asset.sourceScriptId || null,
      dedupeKey,
    });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  notifyShortAssetRejected,
  toPublicNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  broadcastSystemNotification,
  fanoutVideoCompletedNotifications,
};
