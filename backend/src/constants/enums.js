const USER_ROLES = {
  ADMIN: 'admin',
  TEACHER: 'teacher',
  STUDENT: 'student',
};

const COURSE_STATUSES = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

// Revocation is retained as history instead of deleting the relationship.
const ENROLLMENT_STATUSES = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
};

const VIDEO_SOURCE_TYPES = {
  UPLOAD: 'upload',
  EXTERNAL_URL: 'external_url',
  YOUTUBE: 'youtube',
};

const VIDEO_PROCESSING_STATUSES = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// Batch state describes the aggregate; each item keeps its own upload and
// processing state so partial success remains observable and retryable.
const VIDEO_BATCH_STATUSES = {
  CREATING: 'creating',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  FAILED: 'failed',
};

const VIDEO_BATCH_UPLOAD_STATUSES = {
  UPLOADED: 'uploaded',
  FAILED: 'failed',
};

const YOUTUBE_UPLOAD_STATUSES = {
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  FAILED: 'failed',
};

const SHORT_ASSET_STATUSES = {
  DRAFT: 'draft',
  READY: 'ready',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

const YOUTUBE_AVAILABILITIES = {
  PENDING: 'pending',
  PLAYABLE: 'playable',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
};

const YOUTUBE_PRIVACY_STATUSES = {
  PUBLIC: 'public',
  UNLISTED: 'unlisted',
  PRIVATE: 'private',
  UNKNOWN: 'unknown',
};

const USAGE_LOG_EVENTS = {
  LOGIN: 'login',
  WATCH: 'watch',
  ASK: 'ask',
  CLIP_VIEW: 'clip_view',
};

const NOTIFICATION_SOURCES = {
  VIDEO_COMPLETED: 'video_completed',
  SYSTEM_MAINTENANCE: 'system_maintenance',
};

const QUESTION_STATUSES = {
  ANSWERED: 'answered',
  NO_MATCH: 'no_match',
  FAILED: 'failed',
};

const QUESTION_SOURCES = {
  API: 'api',
  LINE: 'line',
  DEBUG: 'debug',
};

module.exports = {
  USER_ROLES,
  USER_ROLE_VALUES: Object.values(USER_ROLES),
  COURSE_STATUSES,
  COURSE_STATUS_VALUES: Object.values(COURSE_STATUSES),
  ENROLLMENT_STATUSES,
  ENROLLMENT_STATUS_VALUES: Object.values(ENROLLMENT_STATUSES),
  VIDEO_SOURCE_TYPES,
  VIDEO_SOURCE_TYPE_VALUES: Object.values(VIDEO_SOURCE_TYPES),
  VIDEO_PROCESSING_STATUSES,
  VIDEO_PROCESSING_STATUS_VALUES: Object.values(VIDEO_PROCESSING_STATUSES),
  VIDEO_BATCH_STATUSES,
  VIDEO_BATCH_STATUS_VALUES: Object.values(VIDEO_BATCH_STATUSES),
  VIDEO_BATCH_UPLOAD_STATUSES,
  VIDEO_BATCH_UPLOAD_STATUS_VALUES: Object.values(VIDEO_BATCH_UPLOAD_STATUSES),
  YOUTUBE_UPLOAD_STATUSES,
  YOUTUBE_UPLOAD_STATUS_VALUES: Object.values(YOUTUBE_UPLOAD_STATUSES),
  SHORT_ASSET_STATUSES,
  SHORT_ASSET_STATUS_VALUES: Object.values(SHORT_ASSET_STATUSES),
  YOUTUBE_AVAILABILITIES,
  YOUTUBE_AVAILABILITY_VALUES: Object.values(YOUTUBE_AVAILABILITIES),
  YOUTUBE_PRIVACY_STATUSES,
  YOUTUBE_PRIVACY_STATUS_VALUES: Object.values(YOUTUBE_PRIVACY_STATUSES),
  USAGE_LOG_EVENTS,
  USAGE_LOG_EVENT_VALUES: Object.values(USAGE_LOG_EVENTS),
  NOTIFICATION_SOURCES,
  NOTIFICATION_SOURCE_VALUES: Object.values(NOTIFICATION_SOURCES),
  QUESTION_STATUSES,
  QUESTION_STATUS_VALUES: Object.values(QUESTION_STATUSES),
  QUESTION_SOURCES,
  QUESTION_SOURCE_VALUES: Object.values(QUESTION_SOURCES),
};
