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

const USAGE_LOG_EVENTS = {
  LOGIN: 'login',
  WATCH: 'watch',
  ASK: 'ask',
  CLIP_VIEW: 'clip_view',
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
  VIDEO_SOURCE_TYPES,
  VIDEO_SOURCE_TYPE_VALUES: Object.values(VIDEO_SOURCE_TYPES),
  VIDEO_PROCESSING_STATUSES,
  VIDEO_PROCESSING_STATUS_VALUES: Object.values(VIDEO_PROCESSING_STATUSES),
  USAGE_LOG_EVENTS,
  USAGE_LOG_EVENT_VALUES: Object.values(USAGE_LOG_EVENTS),
  QUESTION_STATUSES,
  QUESTION_STATUS_VALUES: Object.values(QUESTION_STATUSES),
  QUESTION_SOURCES,
  QUESTION_SOURCE_VALUES: Object.values(QUESTION_SOURCES),
};
