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
  DUPLICATE: 'duplicate',
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

// 短影片腳本的生命週期（規格書附錄 F）。
// dismissed 有兩個入口：教師在候選階段直接否決，或系統判定證據包無轉折句不適用 8 拍弧線。
// 兩者都必須留痕，否則同一個主題會一再被自動選中。
const SHORT_SCRIPT_STATUSES = {
  EVIDENCE_READY: 'evidence_ready',
  GENERATED: 'generated',
  CHANGES_REQUESTED: 'changes_requested',
  APPROVED: 'approved',
  DISMISSED: 'dismissed',
};

const SHORT_SCRIPT_FEEDBACK_TYPES = {
  RETRIEVAL: 'retrieval',
  NARRATIVE: 'narrative',
};

const SHORT_ASSET_REVIEW_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

const SHORT_ASSET_REVIEW_REASON_CODES = {
  CONTENT_INCORRECT: 'contentIncorrect',
  AUDIO_ISSUE: 'audioIssue',
  VISUAL_QUALITY: 'visualQuality',
  SUBTITLE_ISSUE: 'subtitleIssue',
  INCOMPLETE: 'incomplete',
  OTHER: 'other',
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
  // WATCH = 看到 80% 的首次完成（進度用）；VIDEO_OPEN = 每次點開播放（管理員統計用）。
  WATCH: 'watch',
  VIDEO_OPEN: 'video_open',
  ASK: 'ask',
  CLIP_VIEW: 'clip_view',
  // 短影片腳本生成的成本紀錄（規格書 DR-06）。刻意與 ASK 分開：
  // teacherStats 的 queriesCount 只數 ASK，混用會讓教師儀表板的「問答次數」
  // 被腳本生成次數污染。
  SHORT_SCRIPT_GENERATE: 'short_script_generate',
};

const NOTIFICATION_SOURCES = {
  VIDEO_COMPLETED: 'video_completed',
  SYSTEM_MAINTENANCE: 'system_maintenance',
  // Sent to the script owner when a generated short is rejected; links back to the script.
  SHORT_ASSET_REJECTED: 'short_asset_rejected',
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
  SHORT_SCRIPT_STATUSES,
  SHORT_SCRIPT_STATUS_VALUES: Object.values(SHORT_SCRIPT_STATUSES),
  SHORT_SCRIPT_FEEDBACK_TYPES,
  SHORT_SCRIPT_FEEDBACK_TYPE_VALUES: Object.values(SHORT_SCRIPT_FEEDBACK_TYPES),
  SHORT_ASSET_REVIEW_STATUSES,
  SHORT_ASSET_REVIEW_STATUS_VALUES: Object.values(SHORT_ASSET_REVIEW_STATUSES),
  SHORT_ASSET_REVIEW_REASON_CODES,
  SHORT_ASSET_REVIEW_REASON_CODE_VALUES: Object.values(SHORT_ASSET_REVIEW_REASON_CODES),
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
