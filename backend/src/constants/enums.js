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
};

const VIDEO_PROCESSING_STATUSES = {
  UPLOADED: 'uploaded',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
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
};
