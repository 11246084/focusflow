const mongoose = require('mongoose');
const Course = require('../models/course.model');
const Enrollment = require('../models/enrollment.model');
const ShortAsset = require('../models/shortAsset.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const {
  COURSE_STATUSES,
  SHORT_ASSET_STATUSES,
  YOUTUBE_AVAILABILITIES,
} = require('../constants/enums');

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

const CREATE_FIELDS = [
  'courseId',
  'sourceVideoId',
  'jobId',
  'title',
  'description',
  'status',
  'youtubeVideoId',
  'youtubeUrl',
  'thumbnail',
  'publishedAt',
  'youtubeAvailability',
  'youtubePrivacyStatus',
  'lastCheckedAt',
];

const UPDATE_FIELDS = CREATE_FIELDS.filter((field) => field !== 'courseId');

function pickFields(source, allowedFields) {
  return allowedFields.reduce((result, field) => {
    if (source[field] !== undefined) result[field] = source[field];
    return result;
  }, {});
}

function normalizeLimit(rawLimit) {
  if (rawLimit === undefined || rawLimit === '') return DEFAULT_PAGE_LIMIT;
  const value = String(rawLimit);
  if (!/^\d+$/.test(value)) {
    throw new AppError('limit must be an integer between 1 and 50.', 400, 'VALIDATION_ERROR');
  }

  const limit = Number(value);
  if (limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new AppError('limit must be an integer between 1 and 50.', 400, 'VALIDATION_ERROR');
  }
  return limit;
}

function encodePageToken(asset) {
  return Buffer.from(JSON.stringify({
    publishedAt: new Date(asset.publishedAt).toISOString(),
    id: String(asset._id),
  })).toString('base64url');
}

function decodePageToken(pageToken) {
  if (pageToken === undefined || pageToken === '') return null;
  if (typeof pageToken !== 'string') {
    throw new AppError('Invalid pageToken.', 400, 'INVALID_PAGE_TOKEN');
  }

  try {
    const decoded = JSON.parse(Buffer.from(pageToken, 'base64url').toString('utf8'));
    const publishedAt = new Date(decoded.publishedAt);
    if (
      Object.keys(decoded).sort().join(',') !== 'id,publishedAt'
      || Number.isNaN(publishedAt.getTime())
      || !mongoose.isValidObjectId(decoded.id)
    ) {
      throw new Error('Invalid cursor payload.');
    }
    return { publishedAt, id: new mongoose.Types.ObjectId(decoded.id) };
  } catch {
    throw new AppError('Invalid pageToken.', 400, 'INVALID_PAGE_TOKEN');
  }
}

function assertPublishedPlayableMetadata(asset) {
  if (
    asset.status !== SHORT_ASSET_STATUSES.PUBLISHED
    || asset.youtubeAvailability !== YOUTUBE_AVAILABILITIES.PLAYABLE
  ) {
    return;
  }

  if (typeof asset.youtubeVideoId !== 'string' || !asset.youtubeVideoId.trim()) {
    throw new AppError(
      'Published playable Shorts require youtubeVideoId.',
      400,
      'VALIDATION_ERROR',
    );
  }

  if (asset.publishedAt == null || Number.isNaN(new Date(asset.publishedAt).getTime())) {
    throw new AppError(
      'Published playable Shorts require a valid publishedAt.',
      400,
      'VALIDATION_ERROR',
    );
  }
}

async function createShortAsset(payload) {
  assertObjectId(payload.courseId, 'course');
  if (payload.sourceVideoId != null) assertObjectId(payload.sourceVideoId, 'source video');
  const fields = pickFields(payload, CREATE_FIELDS);
  if (fields.youtubeVideoId == null) delete fields.youtubeVideoId;
  assertPublishedPlayableMetadata(fields);
  return ShortAsset.create(fields);
}

async function updateShortAsset(assetId, patch) {
  assertObjectId(assetId, 'short asset');
  if (patch.sourceVideoId != null) assertObjectId(patch.sourceVideoId, 'source video');

  const existing = await ShortAsset.findById(assetId).lean();
  if (!existing) throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');
  const fields = pickFields(patch, UPDATE_FIELDS);
  assertPublishedPlayableMetadata({ ...existing, ...fields });
  const update = { $set: fields };
  if (fields.youtubeVideoId === null) {
    delete fields.youtubeVideoId;
    update.$unset = { youtubeVideoId: 1 };
  }
  const asset = await ShortAsset.findByIdAndUpdate(
    assetId,
    update,
    { new: true, runValidators: true },
  );
  if (!asset) throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');
  return asset;
}

async function listStudentShorts({ studentId, pageToken, limit }) {
  const pageSize = normalizeLimit(limit);
  const cursor = decodePageToken(pageToken);
  const enrollments = await Enrollment.find({ studentId }).select('courseId').lean();
  const enrolledCourseIds = enrollments.map((item) => item.courseId?._id || item.courseId);

  if (!enrolledCourseIds.length) {
    return { items: [], nextPageToken: null };
  }

  const courses = await Course.find({
    _id: { $in: enrolledCourseIds },
    status: COURSE_STATUSES.PUBLISHED,
  }).select('_id title').lean();
  const courseMap = new Map(courses.map((course) => [String(course._id), course]));
  const publishedCourseIds = courses.map((course) => course._id);

  if (!publishedCourseIds.length) {
    return { items: [], nextPageToken: null };
  }

  const query = {
    courseId: { $in: publishedCourseIds },
    status: SHORT_ASSET_STATUSES.PUBLISHED,
    youtubeAvailability: YOUTUBE_AVAILABILITIES.PLAYABLE,
    youtubeVideoId: { $exists: true, $nin: [null, ''] },
    publishedAt: { $ne: null },
  };
  if (cursor) {
    query.$or = [
      { publishedAt: { $lt: cursor.publishedAt } },
      { publishedAt: cursor.publishedAt, _id: { $lt: cursor.id } },
    ];
  }

  const assets = await ShortAsset.find(query)
    .sort({ publishedAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .lean();
  const pageItems = assets.slice(0, pageSize);

  return {
    items: pageItems.map((asset) => {
      const course = courseMap.get(String(asset.courseId));
      return {
        videoId: asset.youtubeVideoId,
        title: asset.title,
        thumbnail: asset.thumbnail || null,
        publishedAt: new Date(asset.publishedAt).toISOString(),
        assetId: String(asset._id),
        course: {
          courseId: String(course._id),
          title: course.title,
        },
        youtubeUrl: asset.youtubeUrl,
      };
    }),
    nextPageToken: assets.length > pageSize
      ? encodePageToken(pageItems[pageItems.length - 1])
      : null,
  };
}

async function archiveForCourseDeletion(course, { now = new Date() } = {}) {
  const assets = await ShortAsset.find({
    courseId: course._id,
    status: { $ne: SHORT_ASSET_STATUSES.ARCHIVED },
  }).select('_id status').lean();

  if (!assets.length) return [];
  const archivedAssets = assets.map((asset) => ({
    assetId: asset._id,
    status: asset.status,
    archivedAt: now,
  }));

  const courseSnapshot = {
    courseId: course._id,
    title: course.title,
    teacherId: course.teacherId,
    status: course.status,
  };
  await ShortAsset.bulkWrite(assets.map((asset) => ({
    updateOne: {
      filter: { _id: asset._id, status: { $ne: SHORT_ASSET_STATUSES.ARCHIVED } },
      update: {
        $set: {
          status: SHORT_ASSET_STATUSES.ARCHIVED,
          archivedAt: now,
          archivedBy: null,
          archiveReason: 'course_deleted',
          statusBeforeArchive: asset.status,
          courseSnapshot,
        },
      },
    },
  })), { ordered: false });

  return archivedAssets;
}

async function rollbackCourseDeletionArchive(archivedAssets) {
  if (!archivedAssets.length) return;

  await ShortAsset.bulkWrite(archivedAssets.map((asset) => ({
    updateOne: {
      filter: {
        _id: asset.assetId,
        status: SHORT_ASSET_STATUSES.ARCHIVED,
        archiveReason: 'course_deleted',
        archivedAt: asset.archivedAt,
      },
      update: {
        $set: { status: asset.status },
        $unset: {
          archivedAt: 1,
          archivedBy: 1,
          archiveReason: 1,
          statusBeforeArchive: 1,
          courseSnapshot: 1,
        },
      },
    },
  })), { ordered: false });
}

module.exports = {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  archiveForCourseDeletion,
  assertPublishedPlayableMetadata,
  createShortAsset,
  decodePageToken,
  encodePageToken,
  listStudentShorts,
  normalizeLimit,
  rollbackCourseDeletionArchive,
  updateShortAsset,
};
