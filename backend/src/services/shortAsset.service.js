const mongoose = require('mongoose');
const Course = require('../models/course.model');
const Enrollment = require('../models/enrollment.model');
const ShortAsset = require('../models/shortAsset.model');
const AppError = require('../utils/appError');
const { buildActiveEnrollmentFilter } = require('./courseAccess.service');
const { assertObjectId } = require('../utils/objectId');
const {
  COURSE_STATUSES,
  SHORT_ASSET_REVIEW_REASON_CODES,
  SHORT_ASSET_REVIEW_REASON_CODE_VALUES,
  SHORT_ASSET_REVIEW_STATUSES,
  SHORT_ASSET_REVIEW_STATUS_VALUES,
  SHORT_ASSET_STATUSES,
  USER_ROLES,
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
const REGENERATION_FIELDS = UPDATE_FIELDS.filter((field) => ![
  'status',
  'publishedAt',
].includes(field));

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

function normalizeGenerationVersion(value) {
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

function normalizeReviewReasons(status, rawReasons) {
  if (rawReasons !== undefined && !Array.isArray(rawReasons)) {
    throw new AppError('reasons must be an array.', 400, 'VALIDATION_ERROR');
  }

  const reasons = (rawReasons || []).map((reason) => {
    if (!reason || typeof reason !== 'object' || Array.isArray(reason)) {
      throw new AppError('Each review reason must be an object.', 400, 'VALIDATION_ERROR');
    }
    if (!SHORT_ASSET_REVIEW_REASON_CODE_VALUES.includes(reason.code)) {
      throw new AppError('Invalid review reason code.', 400, 'VALIDATION_ERROR');
    }
    if (reason.note !== undefined && typeof reason.note !== 'string') {
      throw new AppError('Review reason note must be a string.', 400, 'VALIDATION_ERROR');
    }

    const note = String(reason.note || '').trim();
    if (note.length > 500) {
      throw new AppError('Review reason note must not exceed 500 characters.', 400, 'VALIDATION_ERROR');
    }
    if (reason.code === SHORT_ASSET_REVIEW_REASON_CODES.OTHER && !note) {
      throw new AppError('The other review reason requires a note.', 400, 'VALIDATION_ERROR');
    }
    return { code: reason.code, note };
  });

  if (status === SHORT_ASSET_REVIEW_STATUSES.REJECTED && !reasons.length) {
    throw new AppError('Rejected reviews require at least one reason.', 400, 'VALIDATION_ERROR');
  }
  if (status === SHORT_ASSET_REVIEW_STATUSES.APPROVED && reasons.length) {
    throw new AppError('Approved reviews must not include rejection reasons.', 400, 'VALIDATION_ERROR');
  }

  return reasons;
}

function assertReviewRequest({ status, expectedGenerationVersion, reasons }) {
  if (![SHORT_ASSET_REVIEW_STATUSES.APPROVED, SHORT_ASSET_REVIEW_STATUSES.REJECTED]
    .includes(status)) {
    throw new AppError('status must be approved or rejected.', 400, 'VALIDATION_ERROR');
  }
  if (!Number.isInteger(expectedGenerationVersion) || expectedGenerationVersion < 1) {
    throw new AppError(
      'expectedGenerationVersion must be a positive integer.',
      400,
      'VALIDATION_ERROR',
    );
  }
  return normalizeReviewReasons(status, reasons);
}

function assertPublicationApproved(asset) {
  const generationVersion = normalizeGenerationVersion(asset.generationVersion);
  if (
    asset.reviewStatus !== SHORT_ASSET_REVIEW_STATUSES.APPROVED
    || asset.reviewedGenerationVersion !== generationVersion
  ) {
    throw new AppError(
      'Short asset must be approved for its current generation before publication.',
      409,
      'SHORT_ASSET_NOT_APPROVED',
    );
  }
}

function buildLegacyAwareReviewCasFilter(assetId, expectedGenerationVersion) {
  const generationFilter = expectedGenerationVersion === 1
    ? {
      $or: [
        { generationVersion: expectedGenerationVersion },
        { generationVersion: { $exists: false } },
        { generationVersion: null },
      ],
    }
    : { generationVersion: expectedGenerationVersion };

  return {
    _id: assetId,
    $and: [
      generationFilter,
      {
        $or: [
          { reviewStatus: SHORT_ASSET_REVIEW_STATUSES.PENDING },
          { reviewStatus: { $exists: false } },
          { reviewStatus: null },
        ],
      },
    ],
  };
}

function toIsoOrNull(value) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toReviewReasons(reasons) {
  return Array.isArray(reasons)
    ? reasons.map((reason) => ({ code: reason.code, note: reason.note || '' }))
    : [];
}

function toReviewAsset(asset, course = null) {
  const generationVersion = normalizeGenerationVersion(asset.generationVersion);
  return {
    id: String(asset._id),
    course: {
      courseId: String(asset.courseId),
      title: course?.title || asset.courseSnapshot?.title || null,
    },
    sourceVideoId: asset.sourceVideoId ? String(asset.sourceVideoId) : null,
    jobId: asset.jobId || null,
    title: asset.title,
    description: asset.description || '',
    status: asset.status,
    reviewStatus: asset.reviewStatus || SHORT_ASSET_REVIEW_STATUSES.PENDING,
    reviewedBy: asset.reviewedBy ? String(asset.reviewedBy) : null,
    reviewedAt: toIsoOrNull(asset.reviewedAt),
    reviewReasons: toReviewReasons(asset.reviewReasons),
    generationVersion,
    reviewedGenerationVersion: asset.reviewedGenerationVersion ?? null,
    reviewHistory: Array.isArray(asset.reviewHistory)
      ? asset.reviewHistory.map((review) => ({
        generationVersion: review.generationVersion,
        status: review.status,
        reviewedBy: String(review.reviewedBy),
        reviewedAt: toIsoOrNull(review.reviewedAt),
        reasons: toReviewReasons(review.reasons),
      }))
      : [],
    youtubeVideoId: asset.youtubeVideoId || null,
    youtubeUrl: asset.youtubeUrl || null,
    thumbnail: asset.thumbnail || null,
    createdAt: toIsoOrNull(asset.createdAt),
    updatedAt: toIsoOrNull(asset.updatedAt),
  };
}

async function assertReviewAccess(asset, user) {
  if (user?.role === USER_ROLES.ADMIN) {
    const course = await Course.findById(asset.courseId).lean();
    return course;
  }

  const course = await Course.findById(asset.courseId).lean();
  if (
    user?.role !== USER_ROLES.TEACHER
    || !course
    || String(course.teacherId) !== String(user.id)
  ) {
    throw new AppError(
      'You do not have permission to review this short asset.',
      403,
      'SHORT_ASSET_ACCESS_DENIED',
    );
  }
  return course;
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
  if (fields.status === SHORT_ASSET_STATUSES.PUBLISHED) {
    assertPublicationApproved(fields);
  }
  assertPublishedPlayableMetadata(fields);
  return ShortAsset.create(fields);
}

async function updateShortAsset(assetId, patch) {
  assertObjectId(assetId, 'short asset');
  if (patch.sourceVideoId != null) assertObjectId(patch.sourceVideoId, 'source video');

  const existing = await ShortAsset.findById(assetId).lean();
  if (!existing) throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');
  const fields = pickFields(patch, UPDATE_FIELDS);
  const isPublishTransition = (
    fields.status === SHORT_ASSET_STATUSES.PUBLISHED
    && existing.status !== SHORT_ASSET_STATUSES.PUBLISHED
  );
  if (isPublishTransition) {
    assertPublicationApproved(existing);
  }
  assertPublishedPlayableMetadata({ ...existing, ...fields });
  const update = { $set: fields };
  if (fields.youtubeVideoId === null) {
    delete fields.youtubeVideoId;
    update.$unset = { youtubeVideoId: 1 };
  }
  const publicationGenerationVersion = normalizeGenerationVersion(existing.generationVersion);
  const asset = await (isPublishTransition ? ShortAsset.findOneAndUpdate : ShortAsset.findByIdAndUpdate)(
    isPublishTransition
      ? {
        _id: assetId,
        status: existing.status,
        reviewStatus: SHORT_ASSET_REVIEW_STATUSES.APPROVED,
        generationVersion: publicationGenerationVersion,
        reviewedGenerationVersion: publicationGenerationVersion,
      }
      : assetId,
    update,
    { new: true, runValidators: true },
  );
  if (!asset) {
    if (isPublishTransition) {
      throw new AppError(
        'Short asset review or lifecycle changed before publication.',
        409,
        'SHORT_ASSET_NOT_APPROVED',
      );
    }
    throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');
  }
  return asset;
}

async function listReviewShortAssets({ user, reviewStatus, limit }) {
  const pageSize = normalizeLimit(limit);
  const selectedStatus = reviewStatus === undefined || reviewStatus === ''
    ? SHORT_ASSET_REVIEW_STATUSES.PENDING
    : reviewStatus;
  if (!SHORT_ASSET_REVIEW_STATUS_VALUES.includes(selectedStatus)) {
    throw new AppError('Invalid reviewStatus.', 400, 'VALIDATION_ERROR');
  }

  let ownedCourseIds = null;
  if (user?.role === USER_ROLES.TEACHER) {
    const ownedCourses = await Course.find({ teacherId: user.id }).select('_id title').lean();
    ownedCourseIds = ownedCourses.map((course) => course._id);
    if (!ownedCourseIds.length) return { items: [] };
  } else if (user?.role !== USER_ROLES.ADMIN) {
    throw new AppError(
      'You do not have permission to review short assets.',
      403,
      'SHORT_ASSET_ACCESS_DENIED',
    );
  }

  const query = {
    ...(ownedCourseIds ? { courseId: { $in: ownedCourseIds } } : {}),
    ...(selectedStatus === SHORT_ASSET_REVIEW_STATUSES.PENDING
      ? {
        $or: [
          { reviewStatus: selectedStatus },
          { reviewStatus: { $exists: false } },
          { reviewStatus: null },
        ],
      }
      : { reviewStatus: selectedStatus }),
  };
  const assets = await ShortAsset.find(query).sort({ updatedAt: -1, _id: -1 }).limit(pageSize).lean();
  const courseIds = [...new Set(assets.map((asset) => String(asset.courseId)))];
  const courses = courseIds.length
    ? await Course.find({ _id: { $in: courseIds } }).select('_id title').lean()
    : [];
  const courseMap = new Map(courses.map((course) => [String(course._id), course]));

  return {
    items: assets.map((asset) => toReviewAsset(asset, courseMap.get(String(asset.courseId)))),
  };
}

async function getReviewShortAsset({ assetId, user }) {
  assertObjectId(assetId, 'short asset');
  const asset = await ShortAsset.findById(assetId).lean();
  if (!asset) throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');
  const course = await assertReviewAccess(asset, user);
  return toReviewAsset(asset, course);
}

async function reviewShortAsset({
  assetId,
  user,
  status,
  expectedGenerationVersion,
  reasons,
  now = new Date(),
}) {
  assertObjectId(assetId, 'short asset');
  const existing = await ShortAsset.findById(assetId).lean();
  if (!existing) throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');
  const course = await assertReviewAccess(existing, user);
  const normalizedReasons = assertReviewRequest({ status, expectedGenerationVersion, reasons });
  const currentGenerationVersion = normalizeGenerationVersion(existing.generationVersion);

  if (expectedGenerationVersion !== currentGenerationVersion) {
    throw new AppError(
      'The short asset generation changed. Reload before reviewing.',
      409,
      'SHORT_ASSET_REVIEW_STALE',
    );
  }
  if (
    existing.reviewStatus !== undefined
    && existing.reviewStatus !== null
    && existing.reviewStatus !== SHORT_ASSET_REVIEW_STATUSES.PENDING
  ) {
    throw new AppError(
      'This short asset generation already has a review.',
      409,
      'SHORT_ASSET_REVIEW_CONFLICT',
    );
  }
  if (Array.isArray(existing.reviewHistory) && existing.reviewHistory.some(
    (review) => review.generationVersion === expectedGenerationVersion,
  )) {
    throw new AppError(
      'This short asset generation already has a review.',
      409,
      'SHORT_ASSET_REVIEW_CONFLICT',
    );
  }

  const review = {
    generationVersion: expectedGenerationVersion,
    status,
    reviewedBy: user.id,
    reviewedAt: now,
    reasons: normalizedReasons,
  };
  const updated = await ShortAsset.findOneAndUpdate(
    buildLegacyAwareReviewCasFilter(assetId, expectedGenerationVersion),
    {
      $set: {
        reviewStatus: status,
        generationVersion: expectedGenerationVersion,
        reviewedBy: user.id,
        reviewedAt: now,
        reviewReasons: normalizedReasons,
        reviewedGenerationVersion: expectedGenerationVersion,
        ...(status === SHORT_ASSET_REVIEW_STATUSES.REJECTED
          ? { status: SHORT_ASSET_STATUSES.DRAFT }
          : {}),
      },
      $push: { reviewHistory: review },
    },
    { new: true, runValidators: true },
  );

  if (!updated) {
    const current = await ShortAsset.findById(assetId).lean();
    if (!current) throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');
    await assertReviewAccess(current, user);
    if (normalizeGenerationVersion(current.generationVersion) !== expectedGenerationVersion) {
      throw new AppError(
        'The short asset generation changed. Reload before reviewing.',
        409,
        'SHORT_ASSET_REVIEW_STALE',
      );
    }
    throw new AppError(
      'This short asset generation already has a review.',
      409,
      'SHORT_ASSET_REVIEW_CONFLICT',
    );
  }

  return toReviewAsset(updated, course);
}

async function recordShortAssetRegeneration(assetId, patch = {}) {
  assertObjectId(assetId, 'short asset');
  if (patch.sourceVideoId != null) assertObjectId(patch.sourceVideoId, 'source video');
  const existing = await ShortAsset.findById(assetId).lean();
  if (!existing) throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');

  const fields = pickFields(patch, REGENERATION_FIELDS);
  const nextGenerationVersion = normalizeGenerationVersion(existing.generationVersion) + 1;
  const update = {
    $set: {
      ...fields,
      generationVersion: nextGenerationVersion,
      status: SHORT_ASSET_STATUSES.DRAFT,
      publishedAt: null,
      reviewStatus: SHORT_ASSET_REVIEW_STATUSES.PENDING,
      reviewedBy: null,
      reviewedAt: null,
      reviewReasons: [],
      reviewedGenerationVersion: null,
    },
  };
  if (fields.youtubeVideoId === null) {
    delete fields.youtubeVideoId;
    delete update.$set.youtubeVideoId;
    update.$unset = { youtubeVideoId: 1 };
  }

  const updated = await ShortAsset.findByIdAndUpdate(
    assetId,
    update,
    { new: true, runValidators: true },
  );
  if (!updated) throw new AppError('Short asset not found.', 404, 'SHORT_ASSET_NOT_FOUND');
  return updated;
}

async function listStudentShorts({ studentId, pageToken, limit }) {
  const pageSize = normalizeLimit(limit);
  const cursor = decodePageToken(pageToken);
  // Revoked enrollment removes feed authorization immediately even though the
  // historical Enrollment row remains available for audit/reactivation.
  const enrollments = await Enrollment.find(buildActiveEnrollmentFilter({ studentId }))
    .select('courseId')
    .lean();
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
  getReviewShortAsset,
  listReviewShortAssets,
  listStudentShorts,
  normalizeLimit,
  normalizeReviewReasons,
  recordShortAssetRegeneration,
  reviewShortAsset,
  rollbackCourseDeletionArchive,
  updateShortAsset,
};
